// Uses a temporary app and database; NODE_PATH can point to an existing Playwright install.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-wheel-'));
for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=32000+process.pid%20000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert.equal((await fetch(base+'/wheel.css')).status,200);
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2,hasTouch:true,reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>allDrinks.length&&drawQuota!==null);
  await page.locator('#shop-select').click();const brand=await page.locator('.shop-option b').first().textContent();
  await page.locator('.shop-option').first().click();await page.locator('#save-menu').click();
  await page.waitForFunction(()=>drinks.length&&!menuSaving);
  const probabilities=await page.evaluate(()=>layout.map(s=>({prob:s.prob,start:s.start,span:s.span})));
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>draw());
    assert.deepEqual(await page.evaluate(()=>layout.map(s=>({prob:s.prob,start:s.start,span:s.span}))),probabilities,'drawing and resizing preserve probabilities and sector geometry');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
    const button=await page.locator('#wheel-spin').boundingBox(),wheel=await page.locator('.wheel-wrap').boundingBox();
    assert.ok(button.width>=44&&button.height>=44,'touch target at '+width);
    assert.ok(Math.abs(button.x+button.width/2-wheel.x-wheel.width/2)<1,'button is centered');
    assert.ok(wheel.x>=0&&wheel.x+wheel.width<=width,'wheel stays inside viewport');
    if(process.env.TEA_SCREENSHOT)await page.locator(width>850?'.layout':'#wheel-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-'+width+'.png')});
  }
  for(const count of [0,1,12,60]){
    await page.evaluate(count=>{window.savedWheelDrinks=drinks;drinks=Array.from({length:count},(_,i)=>({id:i+1,brand:'测试',name:'超长奖品名称用于验证手机文字边界'+i,price:10+i}));computeLayout();draw();updateSpinButton()},count);
    assert.equal(await page.locator('#wheel-spin').isDisabled(),count===0);
    if(count)assert.ok(Math.abs(await page.evaluate(()=>layout.reduce((n,s)=>n+s.span,0))-Math.PI*2)<1e-10);
    await page.evaluate(()=>{drinks=window.savedWheelDrinks;computeLayout();draw();updateSpinButton()});
  }
  await page.setViewportSize({width:390,height:900});
  const hub=page.locator('#wheel-spin');await hub.focus();await page.keyboard.press('Enter');
  await page.locator('#result[open]').waitFor();
  assert.equal(await page.evaluate(()=>{const s=layout.find(s=>current.kind?s.drink.kind===current.kind:s.drink.id===current.id);return Math.abs(Math.sin((angle+s.start+s.span/2)/2))<1e-8}),true,'pointer stops on the server prize');
  assert.deepEqual(errors,[]);
  console.log('Glass wheel: 320/390/768/1280px, high-DPI touch target, empty/single/dense prizes, unchanged probabilities, keyboard draw and pointer alignment passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
