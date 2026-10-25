// Optional: NODE_PATH must point to Playwright; uses an isolated app and database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-games-'));
for(const file of ['server.js','index.html','inventory.js','game-rules.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.appendFileSync(path.join(temp,'game-rules.js'),"\nif(typeof module!=='undefined'){let calls=0;module.exports.pick=drinks=>calls++%2===0?module.exports.RETRY:drinks[0]}\n");
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:'3147'},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:3147/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3147');await page.locator('#app-main').waitFor({state:'visible'});
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'admin123'})})));
  assert.equal(await page.locator('.mode-switch button').count(),6);
  assert.equal(await page.locator('#scratch-number').count(),0);
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
      await page.locator('#spin').click();
      if(mode==='capsule'){await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
    }
    await page.locator('#result[open]').waitFor();
  };
  for(const mode of ['wheel','scratch','number','capsule','box','slot']){
    await page.locator('#mode-'+mode).click();
    await play(mode);
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
  // Ordinary account: retry remains available; one prize locks all modes and survives reload.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'user',password:'123456'})})));
  await play('slot');assert.equal(await page.locator('#name').textContent(),'再来一次');
  await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#slot-play').isDisabled(),true);
  await page.locator('#mode-wheel').click();assert.equal(await page.locator('#spin').isDisabled(),true);
  assert.equal(await page.evaluate(async()=>{try{await api('/api/draws',{method:'POST',body:'{}'});return false}catch{return true}}),true);
  await page.reload();await page.locator('#app-main').waitFor({state:'visible'});
  assert.equal(await page.locator('#spin').isDisabled(),true);
  // Another account may finish an already-started scratch even after its prize consumes the quota.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'ping',password:'123456'})})));
  await page.locator('#mode-scratch').click();await play('scratch');await page.locator('#confirm').click();
  await page.evaluate(()=>startScratch());
  assert.equal(await page.locator('#spin').isDisabled(),false);
  await page.locator('#scratch').scrollIntoViewIfNeeded();const rect=await page.locator('#scratch').boundingBox();
  await page.mouse.move(rect.x+4,rect.y+10);await page.mouse.down();
  for(let y=12;y<rect.height;y+=14){await page.mouse.move(rect.x+5,rect.y+y);await page.mouse.move(rect.x+rect.width-5,rect.y+y,{steps:6})}
  await page.mouse.up();await page.locator('#result[open]').waitFor();await close();
  assert.equal(await page.locator('#spin').isDisabled(),true);
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['slot','scratch','number','capsule']){await page.locator('#mode-'+mode).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' mobile overflow')}
  assert.deepEqual(errors,[]);console.log('Six modes, retry continuation, server records, daily quota, pointer scratching and mobile layout passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
