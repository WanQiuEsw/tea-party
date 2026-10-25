const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const Inventory = require('../inventory');

test('CSV round trips Chinese, commas, quotes, newlines and spreadsheet formulas', () => {
  const items = ['奶茶', '=1+1', '+礼品', '-礼品', '@礼品', "'礼品"].map(name => ({name, brand: '', price: 1299.99, note: '规格,"蓝色"\n到店领取'}));
  assert.deepEqual(Inventory.parseCSV(Inventory.toCSV(items)), items);
  assert.match(Inventory.toCSV(items), /'=1\+1/);
  assert.deepEqual(Inventory.parseCSV('备注,参考价值,品牌/来源,奖品名称\r\n,20,,礼品卡\r\n'), [{name:'礼品卡', brand:'', price:20, note:''}]);
});

test('CSV and item validation reject malformed data', () => {
  for (const csv of ['', '错误表头\n礼品', '奖品名称,品牌/来源,参考价值,备注\n"未闭合,,,', '奖品名称,品牌/来源,参考价值,备注\n耳机,,0,', '奖品名称,品牌/来源,参考价值,备注\n耳机,,20']) assert.throws(() => Inventory.parseCSV(csv));
  for (const price of [0, -1, Infinity, null, true, [], '', 'NaN', 1000001]) assert.throws(() => Inventory.normalize({name:'耳机', price}));
  assert.throws(() => Inventory.normalize({name:'字'.repeat(41), price:1}));
  assert.equal(Inventory.normalize({name:' 耳机 ', price:0.01}).price, 0.01);
});

test('admin import is atomic, skips duplicates, preserves old data and enforces permissions and capacity', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-inventory-'));
  for (const file of ['server.js','index.html','inventory.js','game-rules.js']) fs.copyFileSync(path.join(__dirname,'..',file),path.join(temp,file));
  const server = spawn(process.execPath, ['server.js'], {cwd:temp, env:{...process.env,PORT:'3148'},windowsHide:true,stdio:'pipe'});
  const request = async (url, body, cookie='', method=body?'POST':'GET') => {
    const res = await fetch('http://127.0.0.1:3148'+url,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
    return {status:res.status, data:await res.json(), cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  try {
    for(let i=0;i<80;i++){try{await request('/api/me');break}catch{await new Promise(r=>setTimeout(r,100))}}
    assert.equal((await request('/api/drinks/import',{items:[]})).status,401);
    const user = (await request('/api/login',{username:'user',password:'123456'})).cookie;
    assert.equal((await request('/api/drinks/import',{items:[]},user)).status,403);
    const admin = (await request('/api/login',{username:'admin',password:'admin123'})).cookie;
    const before = (await request('/api/drinks',null,admin)).data;
    assert.equal(before.length,23);
    const gift = {name:'耳机',price:1299.99,note:'一年保修'};
    let res = await request('/api/drinks/import',{items:[gift,{name:'坏数据',price:0}]},admin);
    assert.equal(res.status,400);
    assert.deepEqual((await request('/api/drinks',null,admin)).data,before);
    res = await request('/api/drinks/import',{items:[gift,gift,before[0]]},admin);
    assert.equal(res.data.added,1);assert.equal(res.data.skipped,2);
    const saved = res.data.items.find(d=>d.name==='耳机');
    assert.equal(saved.brand,'');assert.equal(saved.price,1299.99);
    res=await request('/api/drinks/'+saved.id,{name:'无线耳机',note:'凭券领取',price:2999.95},admin,'PATCH');
    assert.equal(res.data.name,'无线耳机');assert.equal(res.data.price,2999.95);
    res=await request('/api/drinks/'+saved.id,{brand:before[0].brand,name:before[0].name},admin,'PATCH');
    assert.equal(res.status,409);
    res=await request('/api/drinks',{name:'礼品卡',price:100},admin);
    assert.equal(res.status,201);
    assert.equal(saved.note,'一年保修');
    assert.equal((await request('/api/drinks',null,admin)).data.find(d=>d.id===saved.id).note,'凭券领取');
    res=await request('/api/drinks/import',{items:Array.from({length:76},(_,i)=>({name:'礼物'+i,price:10}))},admin);
    assert.equal(res.status,400);
    assert.equal((await request('/api/drinks',null,admin)).data.length,25);
  } finally { server.kill(); }
});
