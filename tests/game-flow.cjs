// Optional: NODE_PATH must point to Playwright; uses an isolated app and database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-games-'));
for(const file of ['server.js','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.appendFileSync(path.join(temp,'game-rules.js'),"\nif(typeof module!=='undefined'){let calls=0;module.exports.pick=drinks=>calls++%2===0?module.exports.RETRY:drinks[0]}\n");
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
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'admin123'})})));
  assert.equal(await page.locator('.mode-switch button').count(),6);
  assert.equal(await page.locator('#scratch-number').count(),0);
  await page.evaluate(()=>scrollTo(0,0));
  const hub=page.locator('#wheel-spin'),hubRect=await hub.boundingBox();
  assert.ok(hubRect.y>=0&&hubRect.y+hubRect.height<=844,'mobile center button visible without scrolling');
  assert.equal(await hub.isEnabled(),true);
  await page.locator('#open-odds').click();
  assert.equal(await page.locator('.rare-prize').count(),await page.evaluate(()=>layout.filter(s=>!s.special&&s.price>=16).length));
  assert.equal(await page.locator('.rare-prize .odds-name small').first().textContent().then(t=>t.includes('钻石')),true);
  assert.equal(await page.locator('.odds-tier').evaluateAll(sections=>sections.filter(s=>!s.querySelector('.tier-diamond')).every(s=>!s.querySelector('.rare-prize'))),true);
  assert.equal(await page.locator('.rare-prize').first().evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  if(process.env.TEA_SCREENSHOT)await page.locator('#odds').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-odds.png')});
  await page.locator('#odds-close').click();
  await page.evaluate(()=>{const saved=drinks;drinks=[];renderAll();window.emptyHubDisabled=$('wheel-spin').disabled;drinks=saved;renderAll()});
  assert.equal(await page.evaluate(()=>window.emptyHubDisabled),true);
  assert.equal(await page.evaluate(()=>celebrate(2,{price:20})), 'legendary','reduced motion retains rarity');
  await page.evaluate(()=>scrollTo(0,0));
  if(process.env.TEA_SCREENSHOT)await page.screenshot({path:process.env.TEA_SCREENSHOT,fullPage:true});
  let wheelRequests=0;
  await page.route('**/api/draws',async route=>{if(route.request().method()==='POST'){wheelRequests++;await new Promise(r=>setTimeout(r,300))}await route.continue()}, {times:1});
  let recorded=0;
  const close=async()=>{await page.locator('#close').click()};
  const play=async(mode)=>{
    if(mode==='number'){
      // Reproduce the reported 50 -> another number bug using a fixed preview.
      await page.evaluate(()=>{const random=Math.random;Math.random=()=>.5;try{prepareTicket()}finally{Math.random=random}});
      const snapshot=async()=>({lucky:await page.locator('.lucky-number').textContent(),numbers:await page.locator('.ticket-cell').allTextContents(),ticket:await page.locator('#ticket-no').textContent()});
      const before=await snapshot();assert.equal(before.lucky,'50');
      await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      await page.waitForFunction(()=>scratchStarted&&!requestingDraw);await page.mouse.up();
      assert.deepEqual(await snapshot(),before,'scratching must preserve every number and the ticket ID');
      await page.evaluate(()=>setMode('scratch'));assert.equal(await page.evaluate(()=>mode),'number','an unfinished ticket must not be discarded');
      const expected=await page.evaluate(()=>scratchDrink.name);
      assert.equal(await page.locator('.ticket-number-row.winner .number-prize>span').textContent(),expected);
    }
    if(mode==='box'){await page.locator('.lucky-box').first().click();await page.locator('#box-detail').click()}
    else if(mode==='slot')await page.locator('#slot-play').click();
    else{
      if(mode==='wheel'){
        await hub.click();
        assert.equal(await hub.isDisabled(),true);
        assert.equal(await page.locator('#spin').isDisabled(),true);
        await hub.evaluate(b=>b.click());
      }else await page.locator('#spin').click();
      if(mode==='capsule'){await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
    }
    await page.locator('#result[open]').waitFor();
  };
  for(const mode of ['wheel','scratch','number','capsule','box','slot']){
    await page.locator('#mode-'+mode).click();
    await play(mode);
    if(mode==='wheel')assert.equal(wheelRequests,1,'center click submits once');
    assert.equal(await page.locator('#name').textContent(),'再来一次');
    assert.equal(await page.locator('#copy').isVisible(),false);
    assert.equal(await page.evaluate(()=>history.length),recorded);
    await page.locator('#confirm').click();
    if(mode==='scratch'||mode==='number'||mode==='box')await play(mode);
    else{
      if(mode==='capsule'){await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
      await page.locator('#result[open]').waitFor();
    }
    recorded++;
    assert.equal(await page.evaluate(()=>history.length),recorded);
    assert.equal(await page.locator('#name').textContent(),await page.evaluate(()=>drinks[0].name));
    if(mode==='slot')assert.equal(new Set(await page.locator('.slot-reel b').allTextContents()).size,1);
    if(mode==='number'){assert.equal(await page.locator('.ticket-cell').count(),15);assert.equal(await page.locator('.ticket-cell.winner').count(),1)}
    await close();
  }
  await page.locator('#open-odds').click();
  assert.equal((await page.locator('.odds-pct').allTextContents()).reduce((n,v)=>n+Math.round(parseFloat(v)*10000),0),1000000);
  assert.ok(!(await page.locator('#odds-list').textContent()).includes('空奖'));
  await page.locator('#odds-close').click();
  // A pending prize permits redraw, but cancellation preserves it and makes no POST.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'user',password:'123456'})})));
  await play('slot');assert.equal(await page.locator('#name').textContent(),'再来一次');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#slot-play').isEnabled(),true);
  assert.equal(await page.locator('#pending-rewards li:not(.reward-empty)').count(),1);
  const held=await page.evaluate(()=>drawQuota.currentReward.id),beforeCancel=drawRequests;
  acceptConfirm=false;await page.locator('#mode-wheel').click();await page.locator('#spin').click();
  await page.waitForFunction(()=>!requestingDraw);
  assert.equal(drawRequests,beforeCancel,'cancel must not submit a draw');
  assert.equal(await page.evaluate(()=>drawQuota.currentReward.id),held);
  acceptConfirm=true;await page.locator('#mode-slot').click();await play('slot');
  assert.equal(await page.evaluate(()=>drawQuota.currentReward),null,'retry replaces the forfeited prize');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  assert.notEqual(await page.evaluate(()=>drawQuota.currentReward.id),held);
  assert.equal(await page.locator('#pending-rewards li:not(.reward-empty)').count(),1);
  acceptConfirm=false;await page.locator('#redeem-all').click();
  assert.equal(await page.evaluate(()=>drawQuota.redeemed),false);
  acceptConfirm=true;await page.locator('#redeem-all').click();await page.waitForFunction(()=>drawQuota.redeemed);
  assert.equal(await page.locator('#pending-rewards .reward-empty').count(),1);
  assert.equal(await page.locator('#redeemed-rewards li:not(.reward-empty)').count(),1);
  assert.equal(await page.locator('#redeem-all').isDisabled(),true);
  await page.locator('#mode-wheel').click();assert.equal(await page.locator('#spin').isDisabled(),true);assert.equal(await hub.isDisabled(),true);
  await page.reload();await page.locator('#app-main').waitFor({state:'visible'});
  assert.equal(await page.locator('#spin').isDisabled(),true);
  // Another account can scratch and redeem only after the ticket is revealed.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'ping',password:'123456'})})));
  await page.locator('#mode-scratch').click();await play('scratch');await page.locator('#confirm').click();
  await page.evaluate(()=>startScratch());
  assert.equal(await page.locator('#redeem-all').isDisabled(),true);
  assert.equal(await page.locator('#spin').isDisabled(),false);
  await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
  await page.mouse.move(rect.x+4,rect.y+10);await page.mouse.down();
  for(let y=12;y<rect.height;y+=14){await page.mouse.move(rect.x+5,rect.y+y);await page.mouse.move(rect.x+rect.width-5,rect.y+y,{steps:6})}
  await page.mouse.up();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#spin').isEnabled(),true);
  assert.equal(await page.locator('#redeem-all').isEnabled(),true);
  if(process.env.TEA_SCREENSHOT)await page.locator('.rewards-section').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-rewards.png')});
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['slot','scratch','number','capsule']){await page.locator('#mode-'+mode).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' mobile overflow')}
  assert.deepEqual(errors,[]);console.log('Six modes, retry continuation, server records, redraw confirmation, redemption, pointer scratching and mobile layout passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
