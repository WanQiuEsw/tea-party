// Isolated browser checks for the searchable shop dialog and personal drink pool.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-shop-'));
for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)))fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=41000+process.pid%10000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const choose=async brand=>{await page.locator('#shop-search').fill(brand);await page.locator('.shop-option').filter({has:page.getByText(brand,{exact:true})}).click()};
  const save=async()=>{await page.locator('#save-menu').click();await page.locator('#personal-menu').waitFor({state:'hidden'})};
  await page.goto(base);await page.waitForFunction(()=>allDrinks.length&&drawQuota!==null);
  await page.locator('#shop-select').click();
  assert.equal(await page.locator('#shop-search').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('#save-menu').isDisabled(),true);
  await page.locator('#shop-search').fill('不存在的店');assert.equal(await page.locator('.shop-option').count(),0);
  await choose('古茗');assert.equal(await page.locator('.menu-exclude').count(),12);
  const first=await page.locator('.menu-item b').first().textContent();
  await page.locator('.menu-exclude').first().click();assert.equal(await page.locator('.menu-exclude').count(),11);
  await page.locator('#show-available').click();assert.equal(await page.locator('.menu-exclude').count(),1);
  await page.locator('#drink-search').fill(first);await page.locator('.menu-exclude').click();
  assert.equal(await page.locator('#included-count').textContent(),'12');
  await page.locator('#cancel-menu').click();assert.equal(await page.evaluate(()=>selectedBrand),null,'cancel leaves selection unsaved');
  assert.equal(await page.locator('#shop-select').evaluate(el=>el===document.activeElement),true);
  await page.locator('#shop-select').click();await choose('古茗');await page.locator('.menu-exclude').first().click();
  await choose('茶百道');await choose('古茗');assert.equal(await page.locator('#included-count').textContent(),'11','switching shops retains the draft');
  await page.route('**/api/menu',route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'测试保存失败'})}):route.continue());
  await page.locator('#save-menu').click();await page.locator('#notice').waitFor({state:'visible'});await page.locator('#notice-ok').click();
  assert.equal(await page.locator('#personal-menu').isVisible(),true);assert.equal(await page.locator('#save-menu').isEnabled(),true);
  assert.equal(await page.evaluate(()=>selectedBrand),null,'failed save leaves selection unchanged');
  await page.unroute('**/api/menu');await save();assert.equal(await page.evaluate(()=>drinks.length),11);
  await page.reload();await page.waitForFunction(()=>drinks.length===11&&drawQuota!==null);
  await page.locator('#shop-select').click();await page.locator('#show-available').click();await page.locator('.menu-exclude').click();await save();
  assert.equal(await page.evaluate(()=>drinks.length),12);
  await page.locator('#shop-select').click();
  for(const [width,height] of [[1280,800],[768,1024],[390,844],[320,568]]){
    await page.setViewportSize({width,height});
    const bounds=await page.evaluate(()=>{
      const dialog=$('personal-menu'),r=dialog.getBoundingClientRect(),f=$('save-menu').getBoundingClientRect();
      return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,footer:f.bottom<=innerHeight&&f.top>=0,overflow:dialog.scrollWidth>dialog.clientWidth,bodyLocked:getComputedStyle(document.body).overflow==='hidden'};
    });const close=await page.locator('#close-menu').boundingBox();assert.ok(close&&close.x>=0&&close.x+close.width<=width,'close button fits '+width);assert.deepEqual(bounds,{fits:true,footer:true,overflow:false,bodyLocked:true},'dialog fits '+width);
    await page.locator('#drink-search').fill('不匹配的饮品');assert.match(await page.locator('#personal-menu-list').textContent(),/没有匹配/);await page.locator('#drink-search').fill('');
    await page.locator('.menu-exclude').last().click();await page.locator('#restore-menu').click();
    if(process.env.TEA_SCREENSHOT){await page.evaluate(()=>{for(const selector of ['.shop-dialog-body','.shop-browser','.shop-drinks'])document.querySelector(selector).scrollTo(0,0)});fs.mkdirSync(path.join(root,'.screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'.screenshots','shop-dialog-'+width+'.png')})}
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('#personal-menu').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('menu-open')),false);
  await page.locator('#shop-select').click();
  while(await page.locator('.menu-exclude').count()>2)await page.locator('.menu-exclude').first().click();
  assert.equal(await page.locator('.menu-exclude:disabled').count(),2);
  assert.match(await page.locator('#menu-message').textContent(),/至少保留 2/);
  await save();assert.equal(await page.evaluate(()=>drinks.length),2);assert.equal(await page.locator('#wheel-spin').isEnabled(),true);
  for(const size of [2,3,12]){
    if(size!==2){await page.locator('#edit-menu').click();if(size===12)await page.locator('#restore-menu').click();else{await page.locator('#show-available').click();await page.locator('.menu-exclude').first().click()}await save()}
    await page.reload();await page.waitForFunction(n=>drinks.length===n&&drawQuota!==null,size);
    for(const mode of ['flip','box','capsule','number','scratch','wheel','slot']){
      await page.locator('#mode-'+mode).click();
      if(mode==='flip')assert.equal(await page.locator('.flip-card').count(),size);
      if(mode==='box')assert.equal(await page.locator('.lucky-box').count(),size);
      if(mode==='capsule')assert.equal(await page.locator('.gacha-capsule').count(),size);
      if(mode==='number'){assert.equal(await page.locator('.ticket-number-row').count(),Math.min(5,size));assert.equal(await page.locator('.ticket-cell.winner').count(),1)}
      if(mode==='wheel')assert.equal(await page.evaluate(()=>layout.filter(s=>!s.special).length),size);
      for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' fits '+width+' with '+size+' choices')}
      if(process.env.TEA_SCREENSHOT&&size<=3&&['flip','box','capsule','number'].includes(mode)){await page.setViewportSize({width:390,height:844});fs.mkdirSync(path.join(root,'.screenshots'),{recursive:true});await page.locator(mode==='number'?'#scratch-stage':'#'+mode+'-stage').screenshot({path:path.join(root,'.screenshots',mode+'-'+size+'-choices.png')})}
      if(size<=3){
        const before=await page.evaluate(()=>history.length);
        if(mode==='box'){await page.locator('.lucky-box').last().click();await page.locator('#box-detail').click()}
        else if(mode==='flip')await page.locator('.flip-card').last().click();
        else if(mode==='slot')await page.locator('#slot-play').click();
        else if(mode==='capsule'){await page.locator('#capsule-knob').click();await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
        else await page.locator('#spin').click();
        await page.locator('#result[open]').waitFor();
        assert.ok(await page.evaluate(()=>current.kind==='retry'||drinks.some(d=>d.id===current.id)),mode+' result belongs to the selected pool');
        const count=await page.evaluate(()=>history.length);assert.ok(count===before||count===before+1,'one draw per interaction');
        await page.locator('#close').click();
      }
    }
  }
  await page.locator('#shop-select').click();await page.locator('#restore-menu').click();await save();
  await page.evaluate(()=>{busy=true;updateSpinButton()});assert.equal(await page.locator('#shop-select').isDisabled(),true);await page.evaluate(()=>{busy=false;updateSpinButton()});
  assert.deepEqual(errors,[]);console.log('Shop search, quick add/remove, draft cancel, failed save, refresh persistence, minimum two choices and adaptive games, draw locks and 320–1280px dialog layouts passed.');
})().catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true})});
