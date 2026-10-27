const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'selector-browser-'));
for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)&&!f.startsWith('.')))fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=45000+process.pid%10000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push({url:new URL(r.url()).pathname,body:r.postDataJSON()})});
  const ready=()=>page.waitForFunction(()=>appReady);
  await page.goto(base);await ready();assert.equal(await page.locator('#login-view').isVisible(),false);assert.equal(await page.locator('.winner-ticker').count(),0);
  assert.equal(posts.length,0);assert.equal(await page.locator('#custom-entry').isVisible(),true);assert.equal(await page.locator('#tea-entry').isVisible(),false);
  await page.locator('#source-tea').click();assert.equal(await page.locator('#custom-entry').isVisible(),false);
  await page.locator('#shop-select').click();await page.locator('#shop-results .shop-option').first().click();await page.locator('#save-menu').click();await page.waitForFunction(()=>drinks.length>0&&!menuSaving);const teaBrand=await page.evaluate(()=>selectedBrand);
  await page.locator('#source-custom').click();assert.equal(await page.evaluate(()=>drinks.length),0,'tea options never leak into empty custom mode');
  await page.locator('#custom-options').fill('咖啡\n奶茶\n咖啡\n');await page.locator('#use-custom-options').click();await page.waitForFunction(()=>drinks.length===2&&!customDirty);
  assert.equal(await page.evaluate(()=>customLists.length),1);assert.equal(posts.length,0,'lists never leave the browser');
  await page.locator('#source-tea').click();assert.equal(await page.evaluate(()=>selectedBrand),teaBrand);assert.ok(await page.evaluate(()=>drinks.every(d=>!d.custom)));
  await page.reload();await ready();assert.equal(await page.locator('#source-tea').getAttribute('aria-pressed'),'true');
  await page.locator('#source-custom').click();assert.deepEqual(await page.evaluate(()=>drinks.map(d=>d.name)),['咖啡','奶茶']);
  await page.reload();await ready();assert.equal(await page.locator('#custom-options').inputValue(),'咖啡\n奶茶');
  await page.locator('#custom-options').fill('咖啡\n奶茶\n散步');assert.equal(await page.locator('#spin').isDisabled(),true);await page.locator('#use-custom-options').click();assert.equal(await page.evaluate(()=>drinks.length),3);
  await page.locator('#custom-options').fill('咖啡\n奶茶');await page.locator('#use-custom-options').click();assert.equal(await page.evaluate(()=>localState.options.length),2);
  await page.locator('[name=reveal-speed][value=quick]').check();
  for(const m of ['wheel','scratch','number','capsule','box','slot','flip']){
    await page.locator('#mode-picker summary').click();await page.locator('#mode-'+m).click();
    if(m==='box')await page.locator('.lucky-box').first().click();else if(m==='slot')await page.locator('#slot-play').click();else await page.locator('#spin').click();
    await page.locator('#result[open]').waitFor();assert.ok(['咖啡','奶茶'].includes(await page.locator('#name').textContent()),m);
    assert.equal(await page.locator('#result-price').textContent(),'');await page.waitForFunction(n=>history.length===n,posts.filter(p=>p.url==='/api/completions').length||1);
    await page.locator('#confirm').click();
    await page.waitForFunction(()=>!busy&&!capsuleBusy&&!slotBusy&&!requestingDraw);
  }
  await page.waitForTimeout(300);assert.equal(posts.filter(p=>p.url==='/api/completions').length,7);
  for(const event of posts){assert.equal(event.url,'/api/completions');assert.deepEqual(Object.keys(event.body).sort(),['id','mode'])}
  await page.locator('#current-result').click();await page.locator('#confirm').click();assert.equal(posts.length,7,'review does not count');
  await page.reload();await ready();assert.equal(await page.evaluate(()=>history.length),7);assert.equal(await page.locator('#current-result').isVisible(),true);
  const other=await browser.newPage();await other.goto(base);await other.waitForFunction(()=>appReady);assert.equal(await other.evaluate(()=>customLists.length),0);await other.close();
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#source-tea').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#source-custom').click()}
  await page.setViewportSize({width:390,height:900});
  if(process.env.TEA_SCREENSHOT_DIR){await page.screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,'selector-simple-custom.png'),fullPage:true});await page.locator('#source-tea').click();await page.screenshot({path:path.join(process.env.TEA_SCREENSHOT_DIR,'selector-tea.png'),fullPage:true});await page.locator('#source-custom').click()}
  // A scratch request is not a completed choice until the foil is revealed.
  await page.locator('[name=reveal-speed][value=full]').check();await page.locator('#mode-picker summary').click();await page.locator('#mode-scratch').click();
  await page.evaluate(()=>startScratch());assert.equal(posts.length,7);assert.equal(await page.locator('#source-tea').isDisabled(),true);
  await page.locator('#spin').click();await page.locator('#result[open]').waitFor();await page.locator('#confirm').click();
  await page.waitForFunction(()=>history.length===8);
  // Full box reveals count even when the visitor never opens its details dialog.
  await page.locator('#mode-picker summary').click();await page.locator('#mode-box').click();await page.locator('.lucky-box').first().click();await page.waitForFunction(()=>history.length===9);
  assert.equal(await page.locator('#result').isVisible(),false);await page.locator('#box-detail').click();await page.locator('#confirm').click();await page.waitForTimeout(200);assert.equal(posts.length,9);
  await page.locator('#logout').click();await page.locator('#login-user').fill('admin');await page.locator('#login-pass').fill('admin123');await page.locator('#login-btn').click();await page.waitForFunction(()=>appReady&&adminMode);
  assert.equal(await page.locator('#admin-config').isVisible(),true);assert.equal(await page.locator('#admin-stats').isVisible(),true);assert.match(await page.locator('#stats-summary').textContent(),/累计 9 次/);assert.equal(await page.locator('.quick-start').isVisible(),false);
  await page.locator('#add-prize').click();await page.locator('#edit-name').fill('测试公共选项');await page.locator('#save-edit').click();await page.locator('#prize-editor').waitFor({state:'hidden'});assert.match(await page.locator('#save-state').textContent(),/已保存/);
  await page.locator('#logout').click();await page.waitForFunction(()=>appReady&&!adminMode);assert.equal(await page.evaluate(()=>drinks.length),2);
  // Blocked storage preserves input and the previously saved choice.
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('blocked')}});await page.locator('#custom-options').fill('散步\n看电影');await page.locator('#use-custom-options').click();assert.match(await page.locator('#custom-entry-error').textContent(),/本地存储/);assert.equal(await page.locator('#custom-options').inputValue(),'散步\n看电影');assert.equal(await page.evaluate(()=>drinks[0].name),'咖啡');
  await page.reload();await ready();await page.locator('#custom-options').fill('  \n');await page.locator('#use-custom-options').click();assert.match(await page.locator('#custom-entry-error').textContent(),/每行/);assert.equal(await page.locator('#spin').isDisabled(),true);
  await page.locator('#custom-options').fill('字'.repeat(41));await page.locator('#use-custom-options').click();assert.match(await page.locator('#custom-entry-error').textContent(),/40/);
  await page.reload();await ready();assert.equal(await page.locator('#custom-options').inputValue(),'咖啡\n奶茶');
  // Existing local lists from the previous release remain available.
  await page.evaluate(()=>{const saved={...localState};delete saved.source;delete saved.customId;persistLocal(saved)});await page.reload();await ready();assert.equal(await page.locator('#source-custom').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#custom-options').inputValue(),'咖啡\n奶茶');
  await page.locator('#source-tea').click();await page.reload();await ready();assert.equal(await page.evaluate(()=>selectedBrand),teaBrand);assert.equal(await page.locator('#tea-entry').isVisible(),true);
  await page.evaluate(()=>localStorage.setItem(LOCAL_KEY,JSON.stringify({lists:[null],menus:[],options:[],history:[]})));await page.reload();await ready();assert.equal(await page.evaluate(()=>customLists.length),0);
  assert.deepEqual(errors,[]);console.log('PASS: seven modes, local-only custom lists/results, isolated browsers, statistics, admin, storage failure and responsive layouts');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();const done=new Promise(r=>server.once('exit',r));server.kill();await done;fs.rmSync(temp,{recursive:true,force:true})});
