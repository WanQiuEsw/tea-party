const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');

test('passwordless demo is unlimited, non-redeemable and cannot manage prizes; account switching preserves failed logins',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-auth-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  fs.appendFileSync(path.join(temp,'game-rules.js'),'\nmodule.exports.pick=drinks=>drinks[0];\n');
  const port=30000+process.pid%10000,base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  const request=async(url,cookie='',body)=>{
    const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const result={status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
    if(result.cookie&&res.ok&&(url==='/api/login'||url==='/api/demo'))await fetch(base+'/api/menu',{method:'PUT',headers:{cookie:result.cookie,'Content-Type':'application/json'},body:JSON.stringify({brand:'古茗',excludedIds:[]})});
    return result;
  };
  try{
    let ready=false;for(let i=0;i<80;i++){try{if((await request('/api/me')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
    assert.equal((await request('/api/me')).data.user,null);
    const demo=await request('/api/demo','',{});assert.equal(demo.data.username,'demo');assert.equal(demo.data.role,'user');assert.ok(demo.cookie);
    for(let i=0;i<3;i++)assert.equal((await request('/api/draws',demo.cookie,{})).status,201);
    assert.deepEqual((await request('/api/rewards',demo.cookie)).data,[]);
    assert.equal((await request('/api/quota',demo.cookie)).data.redeemed,false);
    assert.equal((await request('/api/drinks',demo.cookie,{name:'forbidden',price:10})).status,403);
    assert.equal((await request('/api/draws/all',demo.cookie)).status,403);
    assert.equal((await request('/api/login',demo.cookie,{username:'admin',password:'wrong'})).status,401);
    assert.equal((await request('/api/me',demo.cookie)).data.user.username,'demo');
    const user=await request('/api/login',demo.cookie,{username:'user',password:'123456'});
    assert.equal(user.data.username,'user');assert.equal((await request('/api/me',demo.cookie)).data.user,null);
    assert.deepEqual((await request('/api/draws',user.cookie)).data,[]);
    const draw=await request('/api/draws',user.cookie,{});
    assert.equal((await request('/api/rewards/redeem',user.cookie,{drawIds:[draw.data.record.id]})).status,200);
    assert.equal((await request('/api/draws',user.cookie,{})).status,429);
    const again=await request('/api/demo',user.cookie,{});
    assert.equal((await request('/api/me',user.cookie)).data.user,null);
    assert.equal((await request('/api/rewards/redeem',again.cookie,{drawIds:[draw.data.record.id]})).status,409);
    assert.equal((await request('/api/draws',again.cookie,{})).status,201);
  }finally{
    const done=new Promise(r=>server.once('exit',r));server.kill();await done;fs.rmSync(temp,{recursive:true,force:true});
  }
});
