const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('decisions are unlimited, old redemptions do not lock draws, retired endpoints cannot redeem',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-decisions-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
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
    let user=await login('user');
    const headers={cookie:user,'Content-Type':'application/json'};
    await fetch(base+'/api/menu',{method:'PUT',headers,body:JSON.stringify({brand:'古茗',excludedIds:[]})});
    const first=await request('/api/draws',user,{});assert.equal(first.status,201);
    const db=new DatabaseSync(path.join(temp,'tea.db'));
    // Existing installations keep legacy rows, but those rows no longer grant or restrict anything.
    db.exec('CREATE TABLE daily_rewards (user_id INTEGER,day TEXT,draw_id INTEGER,redeemed_at TEXT)');
    const userId=db.prepare("SELECT id FROM users WHERE username='user'").get().id;
    db.prepare('INSERT INTO daily_rewards VALUES (?,?,?,?)').run(userId,new Date().toISOString().slice(0,10),first.data.record.id,new Date().toISOString());
    db.close();
    const batch=await Promise.all(Array.from({length:8},()=>request('/api/draws',user,{})));
    assert.ok(batch.every(r=>r.status===201),'all redraws succeed without replacement confirmation');
    assert.equal(new Set(batch.map(r=>r.data.record.id)).size,8);
    assert.equal((await request('/api/draws',user)).data.length,9);
    for(const endpoint of ['/api/quota','/api/rewards'])assert.equal((await request(endpoint,user)).status,404);
    assert.equal((await request('/api/rewards/redeem',user,{drawIds:[first.data.record.id]})).status,404);
    assert.equal((await request('/api/draws',await login('admin'),{})).status,403);
    await stop();await start();user=await login('user');
    assert.equal((await request('/api/draws',user,{})).status,201,'old redeemed rows never block after restart');
    const old=new DatabaseSync(path.join(temp,'tea.db'));
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM daily_rewards').get().n,1,'legacy data is preserved and no new rewards are created');old.close();
  }finally{if(server?.exitCode===null)await stop();fs.rmSync(temp,{recursive:true,force:true})}
});
