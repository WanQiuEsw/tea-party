const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'slot-browser-'));
for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)))fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=45000+process.pid%10000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/completions'))posts.push(r.postDataJSON())});
  await page.goto(base);await page.waitForFunction(()=>appReady);await page.locator('#mode-slot').tap();
  assert.equal(await page.locator('#slot-play').isDisabled(),true);assert.equal(await page.locator('#slot-lever').isDisabled(),true);
  const css=await page.request.get(base+'/slot.css');assert.equal(css.status(),200);assert.match(css.headers()['content-type'],/text\/css/);
  await page.locator('#edit-custom-options').tap();await page.locator('#custom-options').fill('四季奶青\n桃桃乌龙\n超长选项名称也需要完整显示abcdefghijklmnopqrstuvwxyz');await page.locator('#use-custom-options').tap();
  for(const width of [320,390,600,768,850,851,1280,1440]){
    await page.setViewportSize({width,height:900});
    // Exercise worst-case user text in all three windows, then restore the idle state.
    await page.evaluate(()=>renderSlot([drinks[2],drinks[2],drinks[2]]));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page fits '+width);
    assert.ok(await page.locator('#slot-lever').evaluate(el=>{const r=el.getBoundingClientRect(),stage=document.getElementById('slot-stage').getBoundingClientRect();return r.left>=stage.left&&r.right<=stage.right}),'lever stays inside stage '+width);
    for(const selector of ['#slot-play','#slot-lever','#slot-motion'])assert.ok(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=44&&r.height>=44}),selector+' fits '+width);
    for(const reel of await page.locator('.slot-reel').all())assert.ok(await reel.evaluate(el=>el.scrollWidth<=el.clientWidth),'reel text fits '+width);
    await page.evaluate(()=>renderSlot([null,null,null]));
    if(process.env.TEA_SCREENSHOT_DIR){await page.locator('#slot-stage').screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,`slot-glass-${width}.png`)});if([390,1280].includes(width))await page.screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,`slot-page-${width}.png`),fullPage:true})}
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#slot-play').tap();await page.waitForFunction(()=>slotBusy);
  assert.equal(await page.locator('#slot-play').isDisabled(),true);assert.equal(await page.locator('#slot-lever').isDisabled(),true);assert.equal(await page.locator('#slot-machine').getAttribute('aria-busy'),'true');
  await page.locator('#result[open]').waitFor();const chosen=await page.locator('#name').textContent();
  assert.deepEqual(await page.locator('.slot-reel b').allTextContents(),[chosen,chosen,chosen]);
  await page.waitForFunction(()=>history.length===1);assert.equal(posts.length,1);await page.locator('#confirm').tap();
  // Real keyboard activation on desktop, with the existing reduced-motion path.
  await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#slot-lever').focus();await page.keyboard.press('Enter');await page.locator('#result[open]').waitFor();await page.waitForFunction(()=>history.length===2);await page.locator('#confirm').click();
  await page.locator('[name=reveal-speed][value=quick]').check();await page.locator('#slot-play').focus();await page.keyboard.press('Space');await page.locator('#result[open]').waitFor();await page.waitForFunction(()=>history.length===3);await page.locator('#confirm').click();
  // Simulate permission refusal, then a granted device and a shake. Hardware is not required.
  await page.evaluate(()=>{window.DeviceMotionEvent=class extends Event{};DeviceMotionEvent.requestPermission=async()=>'denied'});
  await page.locator('#slot-motion').click();assert.match(await page.locator('#slot-status').textContent(),/未开启/);assert.equal(await page.locator('#slot-motion').getAttribute('aria-pressed'),'false');
  await page.evaluate(()=>{DeviceMotionEvent.requestPermission=async()=>'granted'});await page.locator('#slot-motion').click();assert.equal(await page.locator('#slot-motion').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{const e=new Event('devicemotion');e.accelerationIncludingGravity={x:30,y:0,z:0};dispatchEvent(e);dispatchEvent(e)});
  await page.locator('#result[open]').waitFor();await page.waitForFunction(()=>history.length===4);assert.equal(posts.length,4,'one result for repeated shake events');await page.locator('#confirm').click();
  await page.reload();await page.waitForFunction(()=>appReady);assert.equal(await page.evaluate(()=>history.length),4);assert.equal(await page.locator('#slot-machine').getAttribute('aria-busy'),'false');
  assert.deepEqual(errors,[]);console.log('PASS: 8 widths, long text, touch, keyboard, disabled/busy states, full/quick/reduced motion, mocked device permissions and shake, history, CSS route');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();const done=new Promise(r=>server.once('exit',r));server.kill();await done;fs.rmSync(temp,{recursive:true,force:true})});
