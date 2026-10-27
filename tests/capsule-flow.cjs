const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'capsule-browser-'));
for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)))fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=45000+process.pid%10000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/completions'))posts.push(r.postDataJSON())});
  await page.goto(base);await page.waitForFunction(()=>appReady);
  await page.locator('#edit-custom-options').click();await page.locator('#custom-options').fill('奶茶\n咖啡');await page.locator('#use-custom-options').click();
  await page.locator('#mode-capsule').click();
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const selector of ['#capsule-knob','.coin-panel'])assert.ok(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.capsule-body').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right}));
    if(process.env.TEA_SCREENSHOT_DIR)await page.locator('#capsule-stage').screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,`capsule-idle-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:844});
  for(const asset of ['egg','knob','coin','slot']){const response=await page.request.get(base+'/assets/boba-'+asset+'.webp');assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/webp/)}
  await page.locator('#capsule-knob').click();await page.locator('#capsule-dialog[open]').waitFor();
  assert.equal(await page.evaluate(()=>history.length),0,'unopened capsule is not a completed selection');
  assert.equal(await page.locator('#result').isVisible(),false);
  const chosen=await page.evaluate(()=>capsuleDrink.name);
  for(const [width,height] of [[320,568],[390,844],[768,1024],[1280,900],[844,390]]){
    await page.setViewportSize({width,height});
    assert.ok(await page.locator('#capsule-open').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=140&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'egg fits '+width+'x'+height);
    assert.ok(await page.locator('#capsule-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
    if(process.env.TEA_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,`capsule-modal-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:844});await page.keyboard.press('Escape');
  assert.equal(await page.locator('#capsule-dialog').isVisible(),false);
  assert.equal(await page.locator('#source-custom').isDisabled(),true);
  if(process.env.TEA_SCREENSHOT_DIR)await page.locator('#capsule-stage').screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,'capsule-machine-390.png')});
  await page.locator('#capsule-drop').click();assert.equal(await page.evaluate(()=>capsuleDrink.name),chosen);
  assert.equal(await page.locator('#capsule-open').evaluate(el=>el===document.activeElement),true);
  await page.locator('#capsule-open').click();assert.equal(await page.locator('#capsule-open').isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#capsule-dialog').isVisible(),true);
  await page.locator('#result[open]').waitFor();assert.equal(await page.locator('#name').textContent(),chosen);
  await page.waitForFunction(()=>history.length===1);assert.equal(posts.length,1);
  await page.locator('#confirm').click();
  // Reduced motion still lets the visitor open the egg themselves.
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#capsule-knob').click();await page.locator('#capsule-dialog[open]').waitFor();
  await page.locator('#capsule-open').focus();await page.keyboard.press('Enter');await page.locator('#result[open]').waitFor();await page.locator('#confirm').click();
  // Explicit quick reveal keeps the existing one-click flow.
  await page.locator('[name=reveal-speed][value=quick]').check();await page.locator('#capsule-knob').click();await page.locator('#result[open]').waitFor();
  assert.equal(await page.locator('#capsule-dialog').isVisible(),false);await page.waitForFunction(()=>history.length===3);assert.equal(posts.length,3);
  assert.deepEqual(errors,[]);
  assert.ok(await page.locator('#capsule-knob img').evaluate(img=>img.complete&&img.naturalWidth>0));
  console.log('PASS: responsive egg dialog, keyboard, close/reopen, one result per egg, reduced motion, quick reveal, artwork routes');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();const done=new Promise(r=>server.once('exit',r));server.kill();await done;fs.rmSync(temp,{recursive:true,force:true})});
