const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('unlimited redraws retain one reward per day; confirmed replacement, persistence and exactly-once redemption',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-rewards-'));
  for(const file of ['server.js','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  const outcomeFile=path.join(temp,'outcome.txt');fs.writeFileSync(outcomeFile,'retry');
  fs.appendFileSync(path.join(temp,'game-rules.js'),"\nmodule.exports.pick=drinks=>{const value=require('fs').readFileSync(require('path').join(__dirname,'outcome.txt'),'utf8');return value==='retry'?module.exports.RETRY:drinks[Number(value)]};\n");
  const port=40000+process.pid%10000,base='http://127.0.0.1:'+port;let server;
  const start=async()=>{
    server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('server did not start');
  };
  const request=async(url,cookie='',body)=>{
    const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async(username)=>(await request('/api/login','',{username,password:username==='admin'?'admin123':'123456'})).cookie;
  const stop=async()=>{const done=new Promise(r=>server.once('exit',r));server.kill();await done};
  try{
    await start();assert.equal((await request('/api/draws','',{})).status,401);
    let user=await login('user'),ping=await login('ping');
    let result=await request('/api/draws',user,{});
    assert.equal(result.data.outcome.kind,'retry');assert.equal(result.data.record,null);
    assert.deepEqual((await request('/api/rewards',user)).data,[]);
    fs.writeFileSync(outcomeFile,'0');result=await request('/api/draws',user,{});
    const first=result.data.record.id;assert.equal(result.data.quota.remaining,1);
    assert.equal(result.data.quota.currentReward.id,first);
    assert.equal((await request('/api/draws',user,{})).status,409,'redraw requires explicit current reward ID');
    assert.equal((await request('/api/draws',user,{replaceDrawId:first+999})).status,409);
    assert.equal((await request('/api/rewards/redeem',ping,{drawIds:[first]})).status,409,'cannot redeem another account reward');
    fs.writeFileSync(outcomeFile,'1');
    const batch=await Promise.all(Array.from({length:8},()=>request('/api/draws',user,{replaceDrawId:first})));
    assert.equal(batch.filter(r=>r.status===201).length,1);assert.equal(batch.filter(r=>r.status===409).length,7);
    let rewards=(await request('/api/rewards',user)).data;assert.equal(rewards.length,1);
    let held=rewards[0].id;assert.notEqual(held,first);
    assert.equal((await request('/api/rewards/redeem',user,{drawIds:[first]})).status,409,'forfeited reward cannot be redeemed');
    fs.writeFileSync(outcomeFile,'retry');result=await request('/api/draws',user,{replaceDrawId:held});
    assert.equal(result.status,201);assert.equal(result.data.quota.currentReward,null);
    assert.equal((await request('/api/rewards',user)).data.length,0,'retry does not keep the forfeited prize');
    fs.writeFileSync(outcomeFile,'2');result=await request('/api/draws',user,{});held=result.data.record.id;
    await stop();await start();user=await login('user');
    assert.equal((await request('/api/quota',user)).data.currentReward.id,held);
    await stop();
    const db=new DatabaseSync(path.join(temp,'tea.db'));
    db.exec("UPDATE daily_rewards SET day=date(day,'-1 day'); UPDATE draws SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'-1 day')");db.close();
    await start();user=await login('user');ping=await login('ping');
    assert.equal((await request('/api/quota',user)).data.currentReward,null);
    assert.equal((await request('/api/rewards',user)).data.length,1,'previous day reward persists');
    result=await request('/api/draws',user,{});const today=result.data.record.id;
    const ids=[held,today];assert.equal((await request('/api/rewards',user)).data.length,2);
    assert.equal((await request('/api/rewards/redeem',user,{drawIds:[held,first]})).status,409);
    assert.ok((await request('/api/rewards',user)).data.every(r=>!r.redeemed_at),'stale batch rolls back completely');
    const exchanges=await Promise.all(Array.from({length:5},()=>request('/api/rewards/redeem',user,{drawIds:ids})));
    assert.equal(exchanges.filter(r=>r.status===200).length,1);assert.equal(exchanges.filter(r=>r.status===409).length,4);
    rewards=(await request('/api/rewards',user)).data;assert.equal(rewards.length,2);assert.ok(rewards.every(r=>r.redeemed_at));
    assert.equal((await request('/api/draws',user,{replaceDrawId:today})).status,429);
    await stop();await start();user=await login('user');
    assert.equal((await request('/api/quota',user)).data.redeemed,true);assert.equal((await request('/api/draws',user,{})).status,429);
    assert.equal((await request('/api/draws',await login('ping'),{})).status,201,'accounts have independent rewards');
  }finally{if(server&&server.exitCode===null)await stop()}
});

test('legacy migration keeps only today latest win and never recreates forfeited or redeemed rewards',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-reward-migration-'));
  for(const file of ['server.js','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  const db=new DatabaseSync(path.join(temp,'tea.db'));
  db.exec(`CREATE TABLE draws (id INTEGER PRIMARY KEY, user_id INTEGER, drink_id INTEGER, brand TEXT, name TEXT, note TEXT, price REAL, created_at TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);`);
  const insert=db.prepare('INSERT INTO draws VALUES (?,1,1,?,?,?,10,?)');
  insert.run(1,'测试','旧日奖励','',new Date(Date.now()-86400000).toISOString());
  insert.run(2,'测试','今天旧结果','',new Date().toISOString());
  insert.run(3,'测试','今天最新奖励','',new Date().toISOString());db.close();
  const port=50000+process.pid%5000,base='http://127.0.0.1:'+port;let server;
  const start=async()=>{server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('migration server failed')};
  const stop=async()=>{const done=new Promise(r=>server.once('exit',r));server.kill();await done};
  const login=async()=>{const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'user',password:'123456'})});return res.headers.get('set-cookie').split(';')[0]};
  try{
    await start();let cookie=await login();
    let rewards=await (await fetch(base+'/api/rewards',{headers:{cookie}})).json();
    assert.deepEqual(rewards.map(r=>r.id),[3]);
    const res=await fetch(base+'/api/rewards/redeem',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({drawIds:[3]})});assert.equal(res.status,200);
    await stop();await start();cookie=await login();
    rewards=await (await fetch(base+'/api/rewards',{headers:{cookie}})).json();
    assert.equal(rewards.length,1);assert.ok(rewards[0].redeemed_at);
    assert.equal((await (await fetch(base+'/api/quota',{headers:{cookie}})).json()).redeemed,true);
  }finally{if(server&&server.exitCode===null)await stop()}
});
