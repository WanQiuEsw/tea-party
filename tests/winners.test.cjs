const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('winner feed requires login, limits results and masks names; ticker handles empty, scrolling and mobile',async()=>{
  const root=process.env.TEA_TEST_ROOT||path.join(__dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-winners-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
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
    assert.ok(rows.every(r=>Object.keys(r).sort().join(',')==='brand,id,name,username'));
    assert.ok(rows.every((r,i)=>!i||rows[i-1].id>r.id));
    if(browser){
      const page=browser.tickerPage;
      await page.evaluate(()=>loadWinnerTicker());
      assert.equal(await page.locator('.winner-group').count(),2);
      assert.equal(await page.locator('.winner-group[aria-hidden=true]').count(),1);
      assert.equal(await page.locator('.winner-track img').count(),0,'prize names are text, not HTML');
      assert.match(await page.locator('.winner-track').textContent(),/<img src=x/);
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
