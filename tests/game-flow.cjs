// Optional: NODE_PATH must point to Playwright; uses an isolated app and database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-games-'));
for(const file of ['server.js','index.html','inventory.js','game-rules.js','fortune.js','flip.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.mkdirSync(path.join(temp,'assets'));fs.copyFileSync(path.join(root,'assets/flip-card-back.webp'),path.join(temp,'assets/flip-card-back.webp'));
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
  assert.equal(await page.locator('#my-rewards').isVisible(),false,'admin must not see My Rewards');
  assert.equal(await page.locator('.mode-switch button').count(),7);
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
  let rememberRedraw=false;
  const approveReminder=async()=>{await page.locator('#replace-reward[open]').waitFor();if(rememberRedraw)await page.locator('#skip-redraw-reminder').check();await page.locator('#replace-continue').click()};
  const play=async(mode)=>{
    let needsReminder=await page.evaluate(()=>!!drawQuota.currentReward&&localStorage.getItem('tea_skip_redraw_'+currentUserId)!=='1');
    if(mode==='number'){
      // Reproduce the reported 50 -> another number bug using a fixed preview.
      await page.evaluate(()=>{const random=Math.random;Math.random=()=>.5;try{prepareTicket()}finally{Math.random=random}});
      const snapshot=async()=>({lucky:await page.locator('.lucky-number').textContent(),numbers:await page.locator('.ticket-cell').allTextContents(),ticket:await page.locator('#ticket-no').textContent()});
      const before=await snapshot();assert.equal(before.lucky,'50');
      await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      if(needsReminder){await page.mouse.up();await approveReminder();needsReminder=false}
      await page.waitForFunction(()=>scratchStarted&&!requestingDraw);await page.mouse.up();
      assert.deepEqual(await snapshot(),before,'scratching must preserve every number and the ticket ID');
      await page.evaluate(()=>setMode('scratch'));assert.equal(await page.evaluate(()=>mode),'number','an unfinished ticket must not be discarded');
      const expected=await page.evaluate(()=>scratchDrink.name);
      assert.equal(await page.locator('.ticket-number-row.winner .number-prize>span').textContent(),expected);
    }
    if(mode==='box'){await page.locator('.lucky-box').first().click();if(needsReminder)await approveReminder();await page.locator('#box-detail').click()}
    else if(mode==='flip'){await page.locator('.flip-card').first().click();if(needsReminder)await approveReminder()}
    else if(mode==='slot'){await page.locator('#slot-play').click();if(needsReminder)await approveReminder()}
    else{
      if(mode==='wheel'){
        await hub.click();
        if(recorded===0){
          assert.equal(await hub.isDisabled(),true);
          assert.equal(await page.locator('#spin').isDisabled(),true);
          await hub.evaluate(b=>b.click());
        }
      }else await page.locator('#spin').click();
      if(needsReminder)await approveReminder();
      if(mode==='capsule'){await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
    }
    await page.locator('#result[open]').waitFor();
  };
  for(const mode of ['wheel','scratch','number','capsule','box','slot','flip']){
    await page.locator('#mode-'+mode).click();
    await play(mode);
    if(mode==='wheel')assert.equal(wheelRequests,1,'center click submits once');
    assert.equal(await page.locator('#name').textContent(),'再来一次');
    assert.equal(await page.locator('#share-note').isVisible(),false,'retry has no share caption');
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
    assert.equal(await page.locator('#share-note').isVisible(),true,'every prize mode has a share caption');
    assert.ok(await page.locator('#share-text').textContent());
    if(mode==='slot')assert.equal(new Set(await page.locator('.slot-reel b').allTextContents()).size,1);
    if(mode==='number'){assert.equal(await page.locator('.ticket-cell').count(),15);assert.equal(await page.locator('.ticket-cell.winner').count(),1)}
    await close();
  }
  await page.locator('#open-odds').click();
  assert.equal((await page.locator('.odds-pct').allTextContents()).reduce((n,v)=>n+Math.round(parseFloat(v)*10000),0),1000000);
  assert.ok(!(await page.locator('#odds-list').textContent()).includes('空奖'));
  await page.locator('#odds-close').click();
  // Admin can draw after redeeming a legacy reward, including after reload.
  const adminDb=new DatabaseSync(path.join(temp,'tea.db'));
  const adminRecord=await page.evaluate(()=>history[0].id),adminId=await page.evaluate(()=>currentUserId);
  adminDb.prepare('INSERT INTO daily_rewards (user_id,day,draw_id) VALUES (?,?,?)').run(adminId,await page.evaluate(()=>drawQuota.day),adminRecord);adminDb.close();
  await page.evaluate(async id=>{const result=await api('/api/rewards/redeem',{method:'POST',body:JSON.stringify({drawIds:[id]})});drawQuota=result.quota;updateSpinButton()},adminRecord);
  assert.equal(await page.evaluate(()=>drawQuota.redeemed),false,'admin stays eligible after redemption');
  await page.reload();await page.waitForFunction(()=>drawQuota!==null&&drinks.length>0);
  assert.equal(await hub.isEnabled(),true,'admin remains eligible after reload');
  assert.equal(await page.locator('#mode-fortune').count(),0,'no separate fortune mode');
  await page.locator('#mode-slot').click();await play('slot');await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();
  await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.shareCopied=text}});
  await page.locator('#copy-share').click();
  const copied=await page.evaluate(()=>window.shareCopied);
  assert.ok(copied.includes(await page.locator('#name').textContent()));assert.ok(copied.includes(await page.locator('#share-text').textContent()));
  if(process.env.TEA_SCREENSHOT)await page.locator('#result').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-share.png')});
  const caption=await page.locator('#share-text').textContent();await close();
  await play('slot');await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();
  assert.notEqual(await page.locator('#share-text').textContent(),caption,'successive prizes get different captions');
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'share result fits '+width)}
  await page.setViewportSize({width:390,height:844});await close();
  // Real flip animation delays disclosure, uses one server draw and locks other actions.
  const art=await page.request.get(baseUrl+'/assets/flip-card-back.webp');assert.equal(art.status(),200);assert.equal(art.headers()['content-type'],'image/webp');assert.ok((await art.body()).length>1000);
  const beforePreview=drawRequests;await page.locator('#mode-flip').click();assert.equal(drawRequests,beforePreview,'preview never draws');
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'flip fits '+width);
    assert.equal(await page.locator('.flip-card').count(),3);
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
  await page.locator('#result[open]').waitFor();assert.equal(await page.locator('#name').textContent(),'再来一次');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();
  assert.equal(await page.locator('.chosen .flip-name').textContent(),await page.locator('#name').textContent());
  assert.equal(await page.locator('#share-note').isVisible(),true);
  await close();await page.emulateMedia({reducedMotion:'reduce'});
  if(process.env.TEA_SCREENSHOT)await page.locator('#flip-stage').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-flip-revealed.png')});
  await page.route('**/api/draws',route=>route.abort(),{times:1});await page.locator('.flip-card').first().click();await page.locator('#notice[open]').waitFor();
  assert.equal(await page.evaluate(()=>busy||requestingDraw),false,'network failure releases controls');assert.equal(await page.locator('#flip-deck').getAttribute('data-phase'),'revealed','failed draw preserves last card');
  await page.locator('#notice-ok').click();await page.locator('#mode-slot').click();
  // A pending prize permits redraw, but cancellation preserves it and makes no POST.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'user',password:'123456'})})));
  assert.equal(await page.locator('#my-rewards').isVisible(),true,'regular users see My Rewards');
  await play('slot');assert.equal(await page.locator('#name').textContent(),'再来一次');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#slot-play').isEnabled(),true);
  assert.equal(await page.locator('#pending-rewards li:not(.reward-empty)').count(),1);
  const held=await page.evaluate(()=>drawQuota.currentReward.id),beforeCancel=drawRequests;
  await page.locator('#mode-flip').click();await page.locator('.flip-card').first().click();
  await page.locator('#replace-reward[open]').waitFor();await page.locator('#skip-redraw-reminder').check();await page.locator('#replace-cancel').click();
  await page.waitForFunction(()=>!requestingDraw);
  assert.equal(await page.evaluate(()=>localStorage.getItem('tea_skip_redraw_'+currentUserId)),null,'cancel must not remember the checkbox');
  assert.equal(drawRequests,beforeCancel,'cancel must not submit a draw');
  assert.equal(await page.locator('#flip-deck').getAttribute('data-phase'),'idle','cancel does not start flipping');
  assert.equal(await page.evaluate(()=>drawQuota.currentReward.id),held);
  rememberRedraw=true;await page.locator('#mode-slot').click();await play('slot');
  assert.equal(await page.evaluate(()=>localStorage.getItem('tea_skip_redraw_'+currentUserId)),'1');
  assert.equal(await page.evaluate(()=>drawQuota.currentReward),null,'retry replaces the forfeited prize');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  assert.notEqual(await page.evaluate(()=>drawQuota.currentReward.id),held);
  assert.equal(await page.locator('#pending-rewards li:not(.reward-empty)').count(),1);
  await page.reload();await page.waitForFunction(()=>drawQuota!==null&&drinks.length>0);
  await play('wheel');assert.equal(await page.locator('#replace-reward').isVisible(),false,'saved choice suppresses reminders after reload');
  assert.equal(await page.locator('#name').textContent(),'再来一次');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  // Five dated rewards persist; exchange one old prize without touching the others.
  const db=new DatabaseSync(path.join(temp,'tea.db'));
  const userId=await page.evaluate(()=>currentUserId);
  for(let days=1;days<=4;days++){
    const record=db.prepare("INSERT INTO draws (user_id,drink_id,brand,name,note,price,created_at) SELECT user_id,drink_id,brand,name,note,price,strftime('%Y-%m-%dT%H:%M:%fZ',created_at,?) FROM draws WHERE id=?").run('-'+days+' days',await page.evaluate(()=>drawQuota.currentReward.id));
    db.prepare("INSERT INTO daily_rewards (user_id,day,draw_id) VALUES (?,date(?,?),?)").run(userId,await page.evaluate(()=>drawQuota.day),'-'+days+' days',Number(record.lastInsertRowid));
  }
  db.close();
  await page.reload();await page.waitForFunction(()=>rewardList.length===5);
  const todayReward=await page.evaluate(()=>drawQuota.currentReward.id);
  const selected=page.locator('.redeem-reward').nth(2);
  const selectedId=Number(await selected.getAttribute('data-draw-id'));
  acceptConfirm=false;await selected.click();
  assert.equal(await page.locator('.redeem-reward').count(),5,'cancel preserves all prizes');
  acceptConfirm=true;
  const redeemRequest=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname==='/api/rewards/redeem');
  await selected.click();
  assert.deepEqual((await redeemRequest).postDataJSON(),{drawIds:[selectedId]});
  await page.waitForFunction(()=>rewardList.filter(r=>r.redeemed_at).length===1&&!redeeming);
  assert.equal(await page.locator('.redeem-reward').count(),4);
  assert.equal(await page.evaluate(()=>drawQuota.currentReward.id),todayReward);
  assert.equal(await page.locator('#spin').isEnabled(),true,'old reward redemption permits today draws');
  await page.reload();await page.waitForFunction(()=>rewardList.length===5);
  assert.equal(await page.locator('.redeem-reward').count(),4,'individual redemption persists after reload');
  const todayButton=page.locator('.redeem-reward[data-draw-id="'+todayReward+'"]');
  acceptConfirm=false;await todayButton.click();
  assert.equal(await page.evaluate(()=>drawQuota.redeemed),false);
  acceptConfirm=true;await todayButton.click();await page.waitForFunction(()=>drawQuota.redeemed&&!redeeming);
  assert.equal(await page.locator('#pending-rewards li:not(.reward-empty)').count(),3);
  assert.equal(await page.locator('#redeemed-rewards li:not(.reward-empty)').count(),2);
  assert.equal(await page.locator('.redeem-reward').count(),3);
  await page.locator('#mode-wheel').click();assert.equal(await page.locator('#spin').isDisabled(),true);assert.equal(await hub.isDisabled(),true);
  await page.reload();await page.locator('#app-main').waitFor({state:'visible'});
  assert.equal(await page.locator('#spin').isDisabled(),true);
  // Another account can scratch and redeem only after the ticket is revealed.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'ping',password:'123456'})})));
  assert.equal(await page.evaluate(()=>localStorage.getItem('tea_skip_redraw_'+currentUserId)),null,'another account has its own reminder setting');
  rememberRedraw=false;await page.locator('#mode-scratch').click();await play('scratch');await page.locator('#confirm').click();
  await page.evaluate(()=>startScratch());
  assert.equal(await page.locator('.redeem-reward').isDisabled(),true);
  assert.equal(await page.locator('#spin').isDisabled(),false);
  await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
  await page.mouse.move(rect.x+4,rect.y+10);await page.mouse.down();
  for(let y=12;y<rect.height;y+=14){await page.mouse.move(rect.x+5,rect.y+y);await page.mouse.move(rect.x+rect.width-5,rect.y+y,{steps:6})}
  await page.mouse.up();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#spin').isEnabled(),true);
  assert.equal(await page.locator('.redeem-reward').isEnabled(),true);
  if(process.env.TEA_SCREENSHOT)await page.locator('.rewards-section').screenshot({path:process.env.TEA_SCREENSHOT.replace('.png','-rewards.png')});
  for(const width of [390,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'reward list fits '+width+'px')}
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['slot','scratch','number','capsule','flip']){await page.locator('#mode-'+mode).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' mobile overflow')}
  assert.deepEqual(errors,[]);console.log('Seven modes, golden flip timing and input locks, share captions and admin draws after redemption, retry continuation, server records, redraw confirmation, redemption, pointer scratching and mobile layout passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
