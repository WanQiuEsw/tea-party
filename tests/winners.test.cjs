const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('winner feed requires login, limits results and masks names; ticker handles empty, scrolling and mobile',async()=>{
  const root=process.env.TEA_TEST_ROOT||path.join(__dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-winners-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
  fs.appendFileSync(path.join(temp,'game-rules.js'),"\nif(typeof module!=='undefined')module.exports.pick=drinks=>drinks[0];\n");
  const port=41000+process.pid%10000,base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let db,browser;
  try{
    let ready=false;
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
    assert.ok(ready,'server starts');
    assert.equal((await fetch(base+'/api/winners')).status,401);
    const login=await fetch(base+'/api/demo',{method:'POST'}),cookie=login.headers.get('set-cookie').split(';')[0];
    const feed=async()=>{const res=await fetch(base+'/api/winners',{headers:{cookie}});assert.equal(res.status,200);return res.json()};
    assert.deepEqual(await feed(),[]);
    if(process.env.TEA_TICKER_BROWSER){
      const {chromium}=require('playwright');
      browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
      const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.locator('.winner-ticker').waitFor({state:'visible'});
      assert.match(await page.locator('.winner-track').textContent(),/等待第一份好运/);
      browser.tickerPage=page;browser.tickerErrors=errors;
    }
    db=new DatabaseSync(path.join(temp,'tea.db'));
    const user=db.prepare("SELECT id FROM users WHERE username='user'").get();
    const insert=db.prepare('INSERT INTO draws (user_id,brand,name,note,price,created_at) VALUES (?,?,?,?,?,?)');
    for(let i=0;i<25;i++)insert.run(user.id,'测试店','奶茶'+i,'private note',10,new Date().toISOString());
    const demo=db.prepare("SELECT id FROM users WHERE username='demo'").get();
    insert.run(demo.id,'测试店','<img src=x onerror=alert(1)>','secret',10,new Date().toISOString());
    const rows=await feed();assert.equal(rows.length,20);
    assert.equal(rows[0].username,'体验用户');assert.equal(rows[1].username,'u**');assert.equal(rows[1].name,'奶茶24');
    assert.ok(rows.every(r=>Object.keys(r).sort().join(',')==='brand,id,name,tier,username'));
    assert.ok(rows.every(r=>r.tier===null),'legacy records have no invented rarity');
    assert.ok(rows.every((r,i)=>!i||rows[i-1].id>r.id));
    const add=db.prepare('INSERT INTO drinks (brand,name,note,price) VALUES (?,?,?,?)');
    const chosen=Number(add.run('测试档位','A 好运奶茶','',100).lastInsertRowid);
    for(let i=0;i<8;i++)add.run('测试档位','B 奶茶'+i,'',90-i*10);
    const request=async(url,body,method='POST')=>{
      const res=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.ok(res.ok,await res.clone().text());return res.json();
    };
    await request('/api/menu',{brand:'测试档位',excludedIds:[]},'PUT');
    const saved=[];
    for(const [price,tier] of [[100,'king'],[80,'diamond'],[50,'gold'],[10,'bronze']]){
      db.prepare('UPDATE drinks SET price=? WHERE id=?').run(price,chosen);
      const result=await request('/api/draws',{});saved.push(result.record.id);
      assert.equal((await feed())[0].tier,tier,'tier follows the actual draw pool');
    }
    const excluded=db.prepare('SELECT id FROM drinks WHERE brand=? AND id!=?').all('测试档位',chosen).map(d=>d.id);
    db.prepare('UPDATE drinks SET price=1 WHERE id=?').run(excluded[0]);
    await request('/api/menu',{brand:'测试档位',excludedIds:excluded.slice(1)},'PUT');
    await request('/api/draws',{});
    assert.equal((await feed())[0].tier,'king','rarity is recalculated for the two-item personal menu');
    db.prepare('DELETE FROM drinks WHERE brand=?').run('测试档位');
    assert.deepEqual((await feed()).filter(r=>saved.includes(r.id)).map(r=>r.tier),['bronze','gold','diamond','king'],'saved tiers survive catalog changes');
    if(browser){
      const page=browser.tickerPage;
      await page.evaluate(()=>loadWinnerTicker());
      assert.equal(await page.locator('.winner-group').count(),2);
      assert.equal(await page.locator('.winner-group[aria-hidden=true]').count(),1);
      assert.equal(await page.locator('.winner-track img').count(),0,'prize names are text, not HTML');
      assert.match(await page.locator('.winner-track').textContent(),/<img src=x/);
      const colors=[];
      for(const tier of ['king','diamond','gold','bronze']){
        const message=page.locator('.winner-group').first().locator('.winner-'+tier).first();
        assert.equal(await message.count(),1);
        assert.match(await message.locator('.winner-badge').textContent(),new RegExp({king:'王者',diamond:'钻石',gold:'黄金',bronze:'青铜'}[tier]));
        colors.push(await message.locator('strong').evaluate(el=>getComputedStyle(el).color));
      }
      assert.equal(new Set(colors).size,4,'all four tiers have different colors');
      assert.equal(await page.locator('.winner-group').first().locator('.winner-message:not([class*="winner-king"]):not([class*="winner-diamond"]):not([class*="winner-gold"]):not([class*="winner-bronze"]) .winner-badge').count(),0);
      const transform=()=>page.locator('.winner-track').evaluate(el=>getComputedStyle(el).transform);
      const before=await transform();await page.waitForTimeout(250);assert.notEqual(await transform(),before,'ticker actually moves');
      await page.locator('.winner-ticker').hover();
      assert.equal(await page.locator('.winner-track').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
      await page.locator('.winner-window').focus();await page.mouse.move(0,0);
      assert.equal(await page.locator('.winner-track').evaluate(el=>getComputedStyle(el).animationPlayState),'paused','keyboard pause');
      await page.locator('.winner-window').evaluate(el=>el.blur());
      db.prepare('UPDATE draws SET name = ? WHERE id = ?').run('多肉葡萄',rows[0].id);
      await page.evaluate(()=>loadWinnerTicker());
      fs.mkdirSync(path.join(__dirname,'..','.screenshots'),{recursive:true});
      await page.screenshot({path:path.join(__dirname,'..','.screenshots','winner-ticker-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile horizontal overflow');
      await page.screenshot({path:path.join(__dirname,'..','.screenshots','winner-ticker-mobile.png')});
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('.winner-track').evaluate(el=>getComputedStyle(el).animationName),'none');
      assert.equal(await page.locator('.winner-group[aria-hidden=true]').isVisible(),false);
      assert.deepEqual(browser.tickerErrors,[]);
    }
  }finally{
    if(browser)await browser.close();if(db)db.close();
    const done=new Promise(r=>server.once('exit',r));server.kill();await done;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
