// Uses a temporary app and database; requires Playwright and Chrome (or TEA_BROWSER).
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-reveal-speed-'));
for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
const port=32000+process.pid%20000,base='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
let browser;
(async()=>{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
  const page=await browser.newPage({viewport:{width:390,height:900},reducedMotion:'no-preference'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let draws=0;
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/draws')draws++});
  const ready=()=>page.waitForFunction(()=>appReady&&allDrinks.length);
  const choose=async mode=>{await page.locator('#mode-picker summary').click();await page.locator('#mode-'+mode).click()};
  const speed=value=>page.locator('.reveal-speed label').filter({has:page.locator('input[value="'+value+'"]')}).click();
  await page.goto(base);await ready();
  assert.equal(await page.locator('[name="reveal-speed"][value="full"]').isChecked(),true);
  await speed('quick');assert.equal(draws,0,'changing speed does not draw');
  await page.reload();await ready();
  assert.equal(await page.locator('[name="reveal-speed"][value="quick"]').isChecked(),true,'speed persists');
  await page.evaluate(()=>savePersonalMenu('古茗',[]));
  const triggers={wheel:'#wheel-spin',flip:'.flip-card',box:'.lucky-box',capsule:'#capsule-knob',slot:'#slot-play',scratch:'#scratch',number:'#spin'};
  for(const mode of ['wheel','flip','box','capsule','slot','scratch','number']){
    await choose(mode);const before=draws;
    // Hold the response to check that repeated starts and speed changes are locked.
    let release;
    const gate=new Promise(resolve=>release=resolve);
    await page.route('**/api/draws',async route=>{if(route.request().method()==='POST')await gate;await route.continue()});
    await page.locator(triggers[mode]).first().click();
    await page.waitForFunction(()=>requestingDraw);
    assert.equal(await page.locator('[name="reveal-speed"]').first().isDisabled(),true);
    await page.evaluate(mode=>{if(mode==='box')openBox(document.querySelector('.lucky-box'));else if(mode==='slot')playSlot();else if(mode==='capsule')gacha();else if(mode==='wheel')spin();else if(mode==='flip')flipCard();else revealTicket()},mode);
    const start=Date.now();release();
    await page.locator('#result[open]').waitFor({timeout:2000});
    assert.ok(Date.now()-start<1500,mode+' skips animation waits');
    assert.equal(draws,before+1,mode+' sends one draw');
    assert.equal(await page.evaluate(()=>current.id===history[0].drink_id||current.name===history[0].name),true,'shows server result');
    assert.equal(await page.locator('#name').textContent(),await page.evaluate(()=>current.name));
    await page.locator('#confirm').click();await page.unroute('**/api/draws');
  }
  // A second scratch ticket should start and reveal with a single click too.
  const before=draws;await page.locator('#spin').click();await page.locator('#result[open]').waitFor({timeout:2000});
  assert.equal(draws,before+1);await page.locator('#confirm').click();
  await choose('wheel');await speed('full');
  await page.locator('#wheel-spin').click();await page.waitForTimeout(500);
  assert.equal(await page.locator('#result').getAttribute('open'),null,'full wheel keeps its animation');
  assert.equal(await page.locator('[name="reveal-speed"]').first().isDisabled(),true);
  await page.locator('#result[open]').waitFor();await page.locator('#confirm').click();
  await choose('capsule');await page.locator('#capsule-knob').click();
  await page.waitForFunction(()=>capsulePhase==='ready');
  assert.equal(await page.locator('#result').getAttribute('open'),null,'full capsule waits for manual opening');
  assert.equal(await page.locator('[name="reveal-speed"]').first().isDisabled(),true);
  await page.locator('#capsule-drop').click();await page.locator('#result[open]').waitFor();await page.locator('#confirm').click();
  await speed('quick');await choose('wheel');
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
    for(const label of await page.locator('.reveal-speed label').all())assert.ok((await label.boundingBox()).height>=44,'touch targets');
    if(width===390&&process.env.TEA_SCREENSHOT){fs.mkdirSync(path.join(root,'.screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'.screenshots','reveal-speed-390.png'),fullPage:true})}
  }
  // Failed requests leave the preference and retry controls intact.
  await choose('wheel');await page.route('**/api/draws',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"retry"}'}));
  await page.locator('#wheel-spin').click();await page.locator('#notice[open]').waitFor();
  await page.locator('#notice-ok').click();assert.equal(await page.locator('[name="reveal-speed"]').first().isDisabled(),false);
  await page.unroute('**/api/draws');
  await page.locator('#wheel-spin').click();await page.locator('#result[open]').waitFor({timeout:2000});await page.locator('#confirm').click();
  await page.evaluate(()=>localStorage.setItem(REVEAL_STORAGE_KEY,'invalid'));await page.reload();await ready();
  assert.equal(await page.locator('[value="full"][name="reveal-speed"]').isChecked(),true,'invalid preference falls back');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#wheel-spin').click();
  await page.locator('#result[open]').waitFor({timeout:2000});await page.locator('#confirm').click();
  await page.locator('[name="reveal-speed"][value="full"]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[value="quick"][name="reveal-speed"]').isChecked(),true,'keyboard speed selection');
  await page.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw new Error('blocked')}});
  await page.reload();await ready();await speed('quick');
  assert.equal(await page.locator('[value="quick"][name="reveal-speed"]').isChecked(),true,'unavailable storage still works');
  assert.deepEqual(errors,[]);
  console.log('Reveal speed: seven quick games, single requests, server results, repeat scratch, full animations, persistence, retry, storage fallback and responsive controls passed.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.kill()});
