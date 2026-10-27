const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
test('visitor privacy, legacy cleanup, administrator catalog and anonymous completion statistics',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'selector-api-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  const db=new DatabaseSync(path.join(temp,'tea.db'));
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,password TEXT,role TEXT); INSERT INTO users VALUES(1,'user','old','user'); CREATE TABLE draws(secret TEXT); INSERT INTO draws VALUES('private'); CREATE TABLE rewards(secret TEXT); CREATE TABLE user_menus(secret TEXT); CREATE TABLE daily_rewards(secret TEXT);");db.close();
  const port=35000+process.pid%10000,base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  const request=async(url,body,cookie='',method=body?'POST':'GET')=>{const res=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]}};
  try{
    let ready=false;for(let i=0;i<80;i++){try{if((await request('/api/me')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
    assert.equal((await request('/api/me')).data.user,null);
    assert.ok((await request('/api/drinks')).data.length);
    assert.equal((await request('/api/stats')).status,401);
    assert.equal((await request('/api/drinks',{name:'bad',price:5})).status,401);
    for(const endpoint of ['/api/demo','/api/lists','/api/menu','/api/draws','/api/draws/all','/api/winners'])assert.equal((await request(endpoint)).status,404);
    assert.equal((await request('/api/login',{username:'user',password:'123456'})).status,401);
    const login=await request('/api/login',{username:'admin',password:'admin123'});assert.equal(login.status,200);
    const cookie=login.cookie;assert.equal((await request('/api/login',{username:'admin',password:'wrong'},cookie)).status,401);assert.equal((await request('/api/me',null,cookie)).data.user.role,'admin');
    const added=await request('/api/drinks',{name:'公共测试',price:1},cookie);assert.equal(added.status,201);
    assert.equal((await request('/api/drinks/'+added.data.id,{name:'编辑完成'},cookie,'PATCH')).status,200);
    assert.equal((await request('/api/drinks/'+added.data.id,null,cookie,'DELETE')).status,200);
    for(const mode of ['wheel','scratch','number','capsule','box','slot','flip']){
      const body={id:crypto.randomUUID(),mode};assert.equal((await request('/api/completions',body)).status,200);assert.equal((await request('/api/completions',body)).status,200);
    }
    for(const body of [{id:'invalid',mode:'wheel'},{id:crypto.randomUUID(),mode:'bad'},{id:crypto.randomUUID(),mode:'wheel',name:'private'}])assert.equal((await request('/api/completions',body)).status,400);
    const stats=(await request('/api/stats',null,cookie)).data;assert.equal(stats.total,7);assert.equal(stats.daily[0].count,7);assert.equal(stats.modes.length,7);assert.ok(stats.modes.every(row=>row.count===1));
    const check=new DatabaseSync(path.join(temp,'tea.db'));assert.deepEqual(check.prepare('SELECT username FROM users').all().map(row=>row.username),['admin']);
    const tables=check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);for(const name of ['draws','rewards','daily_rewards','user_menus','user_shops','custom_lists','selected_lists'])assert.ok(!tables.includes(name));
    assert.deepEqual(check.prepare('PRAGMA table_info(completions)').all().map(row=>row.name),['id','day','mode']);check.close();
    await request('/api/logout',{},cookie);assert.equal((await request('/api/stats',null,cookie)).status,401);
  }finally{const done=new Promise(r=>server.once('exit',r));server.kill();await done;fs.rmSync(temp,{recursive:true,force:true})}
});
