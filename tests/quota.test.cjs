const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
test('daily quota persists, retries stay free, concurrent requests cannot bypass it, admin is unlimited',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-quota-'));
  for(const file of ['server.js','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  // Deterministic outcomes in this isolated server: retry once, then always a prize.
  fs.appendFileSync(path.join(temp,'game-rules.js'), '\nlet calls=0;module.exports.pick=drinks=>calls++===0?module.exports.RETRY:drinks[0];\n');
  let server;
  const start=async()=>{
    server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:'3149'},windowsHide:true,stdio:'pipe'});
    for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:3149/api/me')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}
    throw Error('server did not start');
  };
  const request=async(url,cookie='',body)=>{
    const res=await fetch('http://127.0.0.1:3149'+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async(username)=>(await request('/api/login','',{username,password:username==='admin'?'admin123':'123456'})).cookie;
  const stop=async()=>{const done=new Promise(r=>server.once('exit',r));server.kill();await done};
  try{
    await start();
    assert.equal((await request('/api/draws','',{})).status,401);
    let user=await login('user');
    assert.equal((await request('/api/quota',user)).data.remaining,1);
    let result=await request('/api/draws',user,{});
    assert.equal(result.data.outcome.kind,'retry');assert.equal(result.data.record,null);
    assert.equal(result.data.quota.remaining,1);
    assert.equal((await request('/api/draws',user)).data.length,0);
    const batch=await Promise.all(Array.from({length:8},()=>request('/api/draws',user,{drinkId:999,role:'admin'})));
    assert.equal(batch.filter(r=>r.status===201).length,1);
    assert.equal(batch.filter(r=>r.status===429).length,7);
    assert.equal((await request('/api/draws',user)).data.length,1);
    assert.equal((await request('/api/quota',await login('user'))).data.remaining,0);
    const ping=await login('ping');assert.equal((await request('/api/quota',ping)).data.remaining,1);
    assert.equal((await request('/api/draws',ping,{})).status,201);
    const admin=await login('admin');
    for(let i=0;i<5;i++){result=await request('/api/draws',admin,{});assert.equal(result.status,201);assert.equal(result.data.quota.unlimited,true)}
    await stop();await start();user=await login('user');
    assert.equal((await request('/api/draws',user,{})).status,429);
    await stop();
    // Move yesterday's usage back one day; the next day's allowance is restored.
    const db=new DatabaseSync(path.join(temp,'tea.db'));
    db.exec("UPDATE daily_draws SET day=date(day,'-1 day'); UPDATE draws SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'-1 day')");db.close();
    await start();user=await login('user');assert.equal((await request('/api/quota',user)).data.remaining,1);
    result=await request('/api/draws',user,{});assert.equal(result.status,201);
  }finally{if(server&&server.exitCode===null)await stop()}
});
