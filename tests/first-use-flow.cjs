// Browser regression with an isolated server and database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-first-use-'));
for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=32000+process.pid%20000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let draws=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/draws')draws++});
  const ready=()=>page.waitForFunction(()=>allDrinks.length&&drawQuota!==null&&mode===(savedMode()==='wheel'&&drinks.length>WHEEL_LIMIT?'slot':savedMode()));
  const choose=async mode=>{await page.locator('#mode-picker summary').click();await page.locator('#mode-'+mode).click()};
  await page.goto(base);await ready();
  assert.equal(await page.evaluate(()=>mode),'wheel');
  assert.equal(await page.locator('#mode-wheel').isVisible(),false);
  assert.equal(await page.locator('#demo-notice').isVisible(),true);
  assert.equal(await page.locator('.start-steps li').count(),3);
  assert.equal(await page.locator('#spin').isDisabled(),true);
  await page.locator('#shop-select').click();await page.locator('.shop-option').first().click();await page.locator('#save-menu').click();
  await page.waitForFunction(()=>drinks.length&&!menuSaving);
  for(const m of ['scratch','number','capsule','box','slot','flip','wheel']){
    await choose(m);assert.equal(await page.evaluate(()=>mode),m);
    assert.equal(await page.locator('#mode-picker').getAttribute('open'),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem(MODE_STORAGE_KEY)),m);
  }
  await choose('flip');await page.reload();await ready();
  assert.equal(await page.evaluate(()=>mode),'flip');
  assert.equal(await page.locator('#flip-stage').isVisible(),true);
  for(let i=0;i<8;i++){
    const previous=await page.evaluate(()=>mode);await page.locator('#random-mode').click();
    assert.notEqual(await page.evaluate(()=>mode),previous);
  }
  assert.equal(draws,0,'previewing and switching never draw');
  await page.evaluate(()=>{localStorage.setItem(MODE_STORAGE_KEY,'invalid')});await page.reload();await ready();
  assert.equal(await page.evaluate(()=>mode),'wheel','invalid preferences fall back');
  await choose('wheel');
  await page.evaluate(()=>{drinks=allDrinks.slice(0,25);computeLayout();updateWheelAvailability();updateSpinButton()});
  assert.equal(await page.evaluate(()=>mode),'slot');
  assert.equal(await page.evaluate(()=>localStorage.getItem(MODE_STORAGE_KEY)),'wheel','automatic fallback preserves preference');
  for(let i=0;i<12;i++){await page.locator('#random-mode').click();assert.notEqual(await page.evaluate(()=>mode),'wheel')}
  await page.reload();await ready();await choose('wheel');
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});await page.locator('#mode-picker summary').click();
    assert.equal(await page.locator('.mode-switch button:visible').count(),7);
    const bounds=await page.locator('.mode-switch').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'picker stays inside viewport');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#mode-picker summary').click();
  }
  await page.setViewportSize({width:320,height:568});
  for(const m of ['slot','number','flip','wheel']){await choose(m);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),m+' toolbar fits small screens')}
  await page.setViewportSize({width:390,height:900});
  if(process.env.TEA_SCREENSHOT){fs.mkdirSync(path.join(root,'.screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'.screenshots','first-use-mobile.png'),fullPage:true})}
  await page.locator('#spin').click();await page.locator('#result[open]').waitFor();
  assert.equal(draws,1);assert.equal(await page.locator('#result-demo-notice').isVisible(),true);
  assert.equal(await page.locator('#confirm').textContent(),'确认这一杯');await page.locator('#confirm').click();
  await page.waitForFunction(()=>!document.getElementById('random-mode').disabled);
  await page.locator('#logout').click();await page.locator('#login-user').fill('user');await page.locator('#login-pass').fill('123456');await page.locator('#login-btn').click();
  await page.waitForFunction(()=>document.getElementById('whoami').textContent==='user · 用户'&&drawQuota!==null);
  assert.equal(await page.locator('#demo-notice').isVisible(),false);
  assert.equal(await page.locator('#result-demo-notice').evaluate(el=>el.hidden),true);
  await page.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw new Error('Storage disabled')}});
  await page.reload();await ready();await choose('scratch');await choose('wheel');
  assert.deepEqual(errors,[]);
  console.log('First-use flow: default, all modes, random, persistence, invalid/blocked storage, wheel limit, demo notices, confirmation and responsive picker passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
