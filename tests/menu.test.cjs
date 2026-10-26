const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('catalog migration preserves legacy notes and history and never resurrects deleted drinks',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-catalog-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  let db=new DatabaseSync(path.join(temp,'tea.db'));
  db.exec("CREATE TABLE drinks (id INTEGER PRIMARY KEY AUTOINCREMENT,brand TEXT NOT NULL,name TEXT NOT NULL,note TEXT DEFAULT '',price REAL,UNIQUE(brand,name)); INSERT INTO drinks (brand,name,note,price) VALUES ('瑞幸','小黄油美式','原有偏好',15),('自定义店','我的饮品','保留',8);");
  db.close();
  const boot=()=>require('node:child_process').execFileSync(process.execPath,['-e',"require('node:http').Server.prototype.listen=function(){return this};require('./server.js')"],{cwd:temp,windowsHide:true});
  try{
    boot();db=new DatabaseSync(path.join(temp,'tea.db'));
    const drink=db.prepare("SELECT * FROM drinks WHERE brand='瑞幸咖啡' AND name='小黄油美式'").get();
    assert.equal(drink.id,1);assert.equal(drink.note,'原有偏好');assert.equal(drink.price,32);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drinks WHERE brand='自定义店'").get().n,1);
    db.exec("INSERT INTO draws (user_id,drink_id,brand,name,note,price,created_at) VALUES (1,1,'瑞幸','小黄油美式','历史备注',15,'2000-01-01T00:00:00Z'); DELETE FROM drinks WHERE id=1;");db.close();
    boot();db=new DatabaseSync(path.join(temp,'tea.db'));
    assert.equal(db.prepare('SELECT * FROM drinks WHERE id=1').get(),undefined);
    const history=db.prepare('SELECT * FROM draws').all();assert.equal(history.length,1);assert.equal(history[0].price,15);assert.equal(history[0].note,'历史备注');
  }finally{db.close();fs.rmSync(temp,{recursive:true,force:true})}
});

test('personal menus isolate accounts and shops, enforce draw candidates and survive restarts',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-menus-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  fs.appendFileSync(path.join(temp,'game-rules.js'),'\nmodule.exports.pick=drinks=>drinks[0];\n');
  const port=35000+process.pid%10000,base='http://127.0.0.1:'+port;let server;
  const request=async(url,cookie='',body,method=body?'POST':'GET')=>{
    const res=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const start=async()=>{server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});for(let i=0;i<80;i++){try{if((await request('/api/me')).status===200)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('server failed')};
  const stop=async()=>{const done=new Promise(r=>server.once('exit',r));server.kill();await done};
  const login=async(username)=>(await request('/api/login','',{username,password:'123456'})).cookie;
  const save=(cookie,brand,excludedIds)=>request('/api/menu',cookie,{brand,excludedIds},'PUT');
  try{
    await start();assert.equal((await request('/api/menu')).status,401);
    let user=await login('user');const ping=await login('ping');
    const catalog=(await request('/api/drinks',user)).data;
    assert.equal(catalog.length,924);assert.equal(new Set(catalog.map(d=>d.brand)).size,77);
    assert.equal((await request('/api/draws',user,{})).status,400,'selection is required');
    const shop=catalog.filter(d=>d.brand==='古茗'),other=catalog.find(d=>d.brand==='喜茶');
    assert.equal((await save(user,'古茗',[other.id])).status,400,'cannot exclude another shop drink');
    assert.equal((await save(user,'不存在',[])).status,400);
    assert.equal((await save(user,'古茗',[shop[0].id,shop[0].id])).status,400);
    assert.equal((await save(user,'古茗',['1'])).status,400);
    assert.equal((await save(user,'古茗',shop.slice(0,-1).map(d=>d.id))).status,200);
    assert.deepEqual((await request('/api/menu',ping)).data,{brand:null,menus:[]});
    assert.equal((await request('/api/draws',user,{drinkIds:shop.map(d=>d.id)})).status,409,'stale page does not draw');
    let draw=await request('/api/draws',user,{drinkIds:[shop.at(-1).id]});
    assert.equal(draw.data.outcome.id,shop.at(-1).id,'server uses only eligible drinks');
    const held=draw.data.record.id;
    await save(user,'古茗',shop.map(d=>d.id));
    assert.equal((await request('/api/draws',user,{replaceDrawId:held})).status,400);
    assert.equal((await request('/api/quota',user)).data.currentReward.id,held,'empty menu preserves reward');
    await save(user,'喜茶',[]);await save(user,'古茗',[]);
    const menus=(await request('/api/menu',user)).data;
    assert.equal(menus.menus.length,2);assert.deepEqual(menus.menus.find(m=>m.brand==='喜茶').excludedIds,[]);
    await save(user,'古茗',[shop[0].id]);
    await stop();await start();user=await login('user');
    assert.deepEqual((await request('/api/menu',user)).data.menus.find(m=>m.brand==='古茗').excludedIds,[shop[0].id]);
    assert.equal((await request('/api/drinks',user)).data.length,924,'catalog imports only once');
    await stop();
    const db=new DatabaseSync(path.join(temp,'tea.db'));
    db.prepare('DELETE FROM drinks WHERE id=?').run(shop[0].id);
    db.prepare('INSERT INTO drinks (brand,name,note,price) VALUES (?,?,?,?)').run('古茗','新增测试饮品','',10);db.close();
    await start();user=await login('user');
    const updated=(await request('/api/drinks',user)).data;
    assert.ok(!updated.some(d=>d.id===shop[0].id),'deleted drinks stay deleted');
    assert.ok(updated.some(d=>d.name==='新增测试饮品'),'new drinks join by default');
  }finally{if(server.exitCode===null)await stop();fs.rmSync(temp,{recursive:true,force:true})}
});
