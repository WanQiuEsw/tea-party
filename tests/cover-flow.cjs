// Isolated app: removing the intro must leave the wheel playable on mobile.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=process.env.TEA_TEST_ROOT||path.join(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-cover-'));
for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)))fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=36000+process.pid%10000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert.equal((await fetch(base+'/cover.css')).status,200);
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>allDrinks.length&&drawQuota!==null);
  await page.setViewportSize({width:320,height:568});
  assert.ok(await page.locator('#wheel-spin').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),'first visit shows wheel before selecting a shop');
  await page.locator('#shop-select').click();await page.locator('.shop-option').first().click();await page.locator('#save-menu').click();await page.waitForFunction(()=>selectedBrand!==null&&!menuSaving);
  for(const [width,height] of [[1280,800],[768,1024],[390,844],[375,667],[320,568]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
    const bounds=await page.evaluate(()=>{
      const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
      return {wheel:box('.hub'),modes:box('.mode-switch'),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    console.log(width,bounds);
    if(process.env.TEA_SCREENSHOT)await page.screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-'+width+'.png')});
    assert.equal(await page.locator('.intro').count(),0,'homepage banner is removed');assert.equal(bounds.overflow,false);
    if(width<=850){assert.ok(bounds.modes.bottom<height,'all game choices visible');assert.ok(bounds.wheel.bottom<height,'wheel action visible without scrolling')}
  }
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['scratch','number','capsule','slot','box','flip','wheel']){
    await page.locator('#mode-'+mode).click();assert.equal(await page.locator('#mode-'+mode).getAttribute('aria-pressed'),'true');
  }
  await page.locator('#wheel-spin').click();await page.locator('#result').waitFor({state:'visible'});
  assert.equal(await page.locator('.intro').count(),0);assert.deepEqual(errors,[]);
  console.log('Removed intro, mobile first-screen wheel, seven game choices and draw passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true})});
