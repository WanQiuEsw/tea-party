// Optional: NODE_PATH must point to Playwright; uses an isolated app and database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');

const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-games-'));
for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.mkdirSync(path.join(temp,'assets'));
for(const file of ['flip-card-back.webp','milk-tea-glass.webp','scratch-cover.webp','number-cover.webp','result-gift.webp'])fs.copyFileSync(path.join(root,'assets',file),path.join(temp,'assets',file));
fs.appendFileSync(path.join(temp,'game-rules.js'),"\nif(typeof module!=='undefined'){module.exports.pick=drinks=>drinks[0]}\n");
const port=32000+process.pid%20000,baseUrl='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(baseUrl+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let acceptConfirm=true,drawRequests=0;
  page.on('dialog',async dialog=>{if(acceptConfirm)await dialog.accept();else await dialog.dismiss()});
  page.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/draws')drawRequests++});
  await page.goto(baseUrl);await page.locator('#app-main').waitFor({state:'visible'});
  await page.waitForFunction(()=>appReady&&allDrinks.length>0);
  const ensureShop=async()=>{await page.evaluate(async()=>{if(selectedBrand===null)await savePersonalMenu('古茗',[])})};
  assert.equal(await page.locator('#wheel-spin').isDisabled(),true,'choose a shop before drawing');
  await page.locator('#shop-select').click();await page.locator('.shop-option').filter({has:page.getByText('古茗',{exact:true})}).click();await page.locator('#save-menu').click();await page.waitForFunction(()=>selectedBrand==='古茗'&&!menuSaving);
  assert.equal(await page.evaluate(()=>drinks.length),12);
  await page.locator('#edit-menu').click();await page.locator('.menu-exclude').first().click();
  await page.locator('#cancel-menu').click();assert.equal(await page.evaluate(()=>drinks.length),12,'cancel keeps menu');
  await page.locator('#edit-menu').click();await page.locator('.menu-exclude').first().click();
  await page.locator('#save-menu').click();await page.locator('#personal-menu').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>drinks.length),11);
  await page.reload();await page.waitForFunction(()=>appReady&&drinks.length===11);
  await page.locator('#shop-select').click();await page.locator('.shop-option').filter({has:page.getByText('茶百道',{exact:true})}).click();await page.locator('#save-menu').click();await page.waitForFunction(()=>selectedBrand==='茶百道'&&!menuSaving);
  assert.equal(await page.evaluate(()=>drinks.length),12);
  await page.locator('#shop-select').click();await page.locator('.shop-option').filter({has:page.getByText('古茗',{exact:true})}).click();await page.locator('#save-menu').click();await page.waitForFunction(()=>selectedBrand==='古茗'&&!menuSaving);
  assert.equal(await page.evaluate(()=>drinks.length),11,'each shop remembers its exclusions');
  await page.locator('#edit-menu').click();await page.locator('#restore-menu').click();await page.locator('#save-menu').click();await page.locator('#personal-menu').waitFor({state:'hidden'});
  assert.match(await page.locator('#whoami').textContent(),/demo.*测试账号/);
  assert.equal(await page.locator('#my-rewards').isVisible(),false);
  await page.locator('#logout').click();
  await page.locator('#login-user').fill('admin');await page.locator('#login-pass').fill('wrong');await page.locator('#login-btn').click();
  await page.waitForFunction(()=>$('login-error').textContent.length>0);
  await page.locator('#cancel-login').click();await page.locator('#app-main').waitFor({state:'visible'});
  assert.match(await page.locator('#whoami').textContent(),/demo/);
  await page.locator('#logout').click();
  await page.locator('#login-user').fill('ping');await page.locator('#login-pass').fill('123456');await page.locator('#login-btn').click();
  await page.waitForFunction(()=>$('whoami').textContent.includes('ping')&&appReady);
  await page.reload();await page.waitForFunction(()=>$('whoami').textContent.includes('ping')&&appReady);
  await page.locator('#logout').click();await page.locator('#demo-login').click();
  await page.waitForFunction(()=>$('whoami').textContent.includes('demo')&&appReady);
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'admin123'})})));
  assert.equal(await page.locator('.layout').isVisible(),false,'admin has no game interface');
  assert.equal(await page.locator('#admin-config').isVisible(),true);
  assert.equal(await page.locator('#admin-draws').isVisible(),true);
  await page.evaluate(async()=>enterApp(await api('/api/demo',{method:'POST'})));
  await ensureShop();
  assert.equal(await page.locator('#my-rewards').isVisible(),false,'demo has no redeemable rewards');
  await page.evaluate(()=>showResult(drinks[0]));
  assert.match(await page.locator('#result-auto-close').textContent(),/秒后自动关闭/);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#result').evaluate(el=>el.open),true,'win stays visible before five seconds');
  await page.locator('#close').click();
  await page.evaluate(()=>showResult(drinks[0]));
  await page.waitForTimeout(4200);
  assert.equal(await page.locator('#result').evaluate(el=>el.open),true,'old timer cannot close a new result');
  await page.locator('#result').waitFor({state:'hidden',timeout:2000});
  assert.equal(await page.locator('.mode-switch button').count(),7);
  assert.equal(await page.locator('#scratch-number').count(),0);
  await page.evaluate(()=>scrollTo(0,0));
  const hub=page.locator('#wheel-spin'),hubRect=await hub.boundingBox();
  assert.equal(await page.locator('#current-result').isVisible(),true,'latest result remains after modal closes');await hub.scrollIntoViewIfNeeded();
  assert.equal(await hub.isEnabled(),true);
  assert.equal(await page.locator('#open-odds, #odds').count(),0);
  assert.equal(await page.locator('.hint').textContent(),'清单内每款奶茶机会相同');
  await page.evaluate(()=>{const saved=allDrinks;allDrinks=[];renderAll();window.emptyHubDisabled=$('wheel-spin').disabled;allDrinks=saved;renderAll()});
  assert.equal(await page.evaluate(()=>window.emptyHubDisabled),true);
  await page.evaluate(()=>showResult(drinks[0]));assert.equal(await page.locator('#result-tier').textContent(),'');await page.locator('#close').click();
  await page.evaluate(()=>scrollTo(0,0));
  if(process.env.TEA_SCREENSHOT)await page.screenshot({path:process.env.TEA_SCREENSHOT,fullPage:true});
  await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-capsule').click();
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'capsule fits '+width);
    const sizes=await page.evaluate(()=>{
      const globe=document.querySelector('.capsule-globe').getBoundingClientRect();
      return {globe:globe.width,icons:[...document.querySelectorAll('.gacha-capsule')].map(el=>el.offsetWidth),knob:document.querySelector('#capsule-knob').offsetWidth};
    });
    assert.equal(sizes.icons.length,await page.evaluate(()=>drinks.length));
    assert.ok(sizes.icons.every(size=>size>=30&&size<=sizes.globe/3),'capsule icons scale with display at '+width);
    assert.ok(sizes.knob>=44,'touch target at '+width);
    if(process.env.TEA_SCREENSHOT)await page.locator('#capsule-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-capsule-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-wheel').click();
  let wheelRequests=0;
  await page.route('**/api/draws',async route=>{if(route.request().method()==='POST'){wheelRequests++;await new Promise(r=>setTimeout(r,300))}await route.continue()}, {times:1});
  let recorded=0;
  const close=async()=>{await page.locator('#close').click()};
  const play=async(mode)=>{
    if(mode==='capsule')await page.emulateMedia({reducedMotion:'no-preference'});
    if(mode==='number'){
      // Reproduce the reported 50 -> another number bug using a fixed preview.
      await page.evaluate(()=>{const random=Math.random;Math.random=()=>.5;try{prepareTicket()}finally{Math.random=random}});
      const snapshot=async()=>({lucky:await page.locator('.lucky-number').textContent(),numbers:await page.locator('.ticket-cell').allTextContents(),ticket:await page.locator('#ticket-no').textContent()});
      const before=await snapshot();assert.equal(before.lucky,'50');
      await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      await page.waitForFunction(()=>scratchStarted&&!requestingDraw);await page.mouse.up();
      const scratched=await page.evaluate(()=>scratchRatio());
      assert.ok(scratched>0,'cover is actually erasable');
      await page.setViewportSize({width:320,height:844});
      await page.waitForFunction(()=>Math.abs(foil.width-Math.round($('ticket-body').getBoundingClientRect().width*Math.min(devicePixelRatio||1,2)))<=2);
      assert.ok(Math.abs(await page.evaluate(()=>scratchRatio())-scratched)<.025,'resizing preserves the scratched area');
      await page.setViewportSize({width:390,height:844});
      assert.deepEqual(await snapshot(),before,'scratching must preserve every number and the ticket ID');
      await page.evaluate(()=>setMode('scratch'));assert.equal(await page.evaluate(()=>mode),'number','an unfinished ticket must not be discarded');
      const expected=await page.evaluate(()=>scratchDrink.name);
      assert.equal(await page.locator('.ticket-number-row.winner .number-prize>span').textContent(),expected);
    }
    if(mode==='box'){await page.locator('.lucky-box').first().click();await page.locator('#box-detail').click()}
    else if(mode==='flip'){await page.locator('.flip-card').first().click();}
    else if(mode==='slot'){await page.locator('#slot-play').click();}
    else{
      if(mode==='wheel'){
        await hub.click();
        if(recorded===0){
          assert.equal(await hub.isDisabled(),true);
          assert.equal(await page.locator('#spin').isDisabled(),true);
          await hub.evaluate(b=>b.click());
        }
      }else await page.locator('#spin').click();

      if(mode==='capsule'){
        await page.waitForFunction(()=>capsulePhase==='ready');
        for(const width of [320,1280]){
          await page.setViewportSize({width,height:900});
          const drop=await page.locator('#capsule-drop').boundingBox(),tray=await page.locator('#capsule-out').boundingBox();
          assert.ok(drop.width>=44&&drop.height>=44,'capsule opens by touch');
          assert.ok(drop.x>=tray.x&&drop.x+drop.width<=tray.x+tray.width&&drop.y>=tray.y&&drop.y+drop.height<=tray.y+tray.height,'ready capsule stays in tray at '+width);
          if(process.env.TEA_SCREENSHOT)await page.locator('#capsule-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-capsule-ready-'+width+'.png')});
        }
        await page.setViewportSize({width:390,height:844});
        await page.locator('#capsule-drop').click();
      }
    }
    await page.locator('#result[open]').waitFor();
    if(mode==='capsule')await page.emulateMedia({reducedMotion:'reduce'});
  };
  for(const mode of ['wheel','scratch','number','capsule','box','slot','flip']){
    await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-'+mode).click();
    await play(mode);
    if(mode==='wheel')assert.equal(wheelRequests,1,'center click submits once');
    recorded++;
    assert.equal(await page.evaluate(()=>history.length),recorded);
    assert.equal(await page.locator('#name').textContent(),await page.evaluate(()=>drinks[0].name));
    assert.equal(await page.locator('#share-note').count(),0,'social caption removed');
    if(mode==='slot')assert.equal(new Set(await page.locator('.slot-reel b').allTextContents()).size,1);
    if(mode==='number'){assert.equal(await page.locator('.ticket-cell').count(),15);assert.equal(await page.locator('.ticket-cell.winner').count(),1)}
    await close();
  }
  assert.equal(await page.locator('#open-odds, #odds').count(),0);
  assert.equal(await page.locator('.hint').textContent(),'清单内每款奶茶机会相同');
  await page.reload();await page.waitForFunction(()=>appReady&&drinks.length>0);
  assert.equal(await hub.isEnabled(),true,'demo stays eligible after reload');
  assert.equal(await page.locator('#mode-fortune').count(),0,'no separate fortune mode');
  await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-slot').click();await play('slot');
  await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.shareCopied=text}});
  await page.locator('#copy').click();
  const copied=await page.evaluate(()=>window.shareCopied);
  assert.ok(copied.includes(await page.locator('#name').textContent()));assert.ok(!copied.includes('今日份快乐'));
  if(process.env.TEA_SCREENSHOT)await page.locator('#result').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-share.png')});
  await close();
  await play('slot');
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'result fits '+width)}
  await page.setViewportSize({width:390,height:844});await close();
  // Real flip animation delays disclosure, uses one server draw and locks other actions.
  const art=await page.request.get(baseUrl+'/assets/flip-card-back.webp');assert.equal(art.status(),200);assert.equal(art.headers()['content-type'],'image/webp');assert.ok((await art.body()).length>1000);
  const beforePreview=drawRequests;await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-flip').click();assert.equal(drawRequests,beforePreview,'preview never draws');
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'flip fits '+width);
    assert.equal(await page.locator('.flip-card').count(),await page.evaluate(()=>Math.min(3,drinks.length)));
    if(process.env.TEA_SCREENSHOT)await page.locator('#flip-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-flip-'+width+'.png')});
  }
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});
  const beforeFlip=drawRequests;await page.locator('.flip-card').nth(1).focus();await page.locator('.flip-card').nth(1).press('Enter');
  await page.waitForFunction(()=>busy&&$('flip-deck').dataset.phase==='spinning');
  assert.equal(await page.locator('.flip-card').nth(1).isDisabled(),true);assert.equal(await page.locator('#mode-wheel').isDisabled(),true);assert.equal(await page.locator('#logout').isDisabled(),true);
  if(process.env.TEA_SCREENSHOT)await page.locator('#flip-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-flip-spinning.png')});
  assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('.chosen .flip-name').textContent(),'','no prize text during suspense');
  assert.equal(await page.locator('.chosen .flip-inner').evaluate(el=>getComputedStyle(el).animationName),'flipSpin');
  await page.evaluate(()=>{flipCard(0);setMode('wheel')});assert.equal(await page.evaluate(()=>mode),'flip');assert.equal(drawRequests,beforeFlip+1,'double activation submits once');
  await page.waitForFunction(()=>$('flip-deck').dataset.phase==='revealed');
  assert.equal(await page.locator('#result').isVisible(),false,'front of card appears before result dialog');
  if(process.env.TEA_SCREENSHOT)await page.locator('#flip-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-flip-burst.png')});
  await page.locator('#result[open]').waitFor();
  assert.equal(await page.locator('.chosen .flip-name').textContent(),await page.locator('#name').textContent());
    assert.equal(await page.locator('#share-note').count(),0,'social caption removed');
  await close();await page.emulateMedia({reducedMotion:'reduce'});
  if(process.env.TEA_SCREENSHOT)await page.locator('#flip-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-flip-revealed.png')});
  await page.route('**/api/draws',route=>route.abort(),{times:1});await page.locator('.flip-card').first().click();await page.locator('#notice[open]').waitFor();
  await page.waitForFunction(()=>!busy&&!requestingDraw);
  assert.equal(await page.evaluate(()=>busy||requestingDraw),false,'network failure releases controls');assert.equal(await page.locator('#flip-deck').getAttribute('data-phase'),'revealed','failed draw preserves last card');
  await page.locator('#notice-ok').click();await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-slot').click();
  // Ordinary users can make repeated decisions without reward prompts or daily locks.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'user',password:'123456'})})));
  await ensureShop();
  assert.equal(await page.locator('#my-rewards,#replace-reward,.redeem-reward').count(),0);
  await page.locator('#mode-picker summary').click();await page.locator('#mode-slot').click();
  for(let i=0;i<3;i++){await play('slot');await close();assert.equal(await page.locator('#slot-play').isEnabled(),true)}
  await page.locator('#current-result').click();const latest=await page.locator('#name').textContent();await page.locator('#close').click();
  await page.reload();await page.waitForFunction(()=>appReady);
  await page.locator('#current-result').click();assert.equal(await page.locator('#name').textContent(),latest,'latest decision survives reload');await page.locator('#close').click();
  await page.locator('#mode-picker summary').click();await page.locator('#mode-scratch').click();
  await page.evaluate(()=>{prepareTicket();void startScratch()});await page.waitForFunction(()=>scratchStarted&&!requestingDraw);
  assert.equal(await page.locator('#random-mode').isDisabled(),true);
  await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
  await page.mouse.move(rect.x+4,rect.y+10);await page.mouse.down();
  for(let y=12;y<rect.height;y+=14){await page.mouse.move(rect.x+5,rect.y+y);await page.mouse.move(rect.x+rect.width-5,rect.y+y,{steps:6})}
  await page.mouse.up();await page.locator('#result[open]').waitFor();await close();
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['slot','scratch','number','capsule','flip']){await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-'+mode).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' mobile overflow')}
  for(const mode of ['scratch','number']){
    await page.locator('#mode-picker').evaluate(el=>el.open=true);await page.locator('#mode-'+mode).click();
    await page.waitForFunction(key=>ticketArt[key].complete&&ticketArt[key].naturalWidth>0,mode);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>Math.abs(foil.width-Math.round($('ticket-body').getBoundingClientRect().width*Math.min(devicePixelRatio||1,2)))<=2);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' fits '+width+'px');
      const box=await page.locator('#ticket').boundingBox();
      assert.ok(box.x>=0&&box.x+box.width<=width,mode+' ticket stays on screen');
      if(process.env.TEA_SCREENSHOT)await page.locator('#scratch-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-'+mode+'-cover-'+width+'.png')});
    }
  }
  assert.deepEqual(errors,[]);console.log('Seven modes, golden flip timing and input locks, personal menus, clean results and admin management-only view and demo draws, uniform prizes, server records, unlimited decisions, persistent results, pointer scratching and mobile layout passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
