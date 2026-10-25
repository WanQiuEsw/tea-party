// Optional browser check: NODE_PATH must contain an installed Playwright package.
// Uses a temporary copy of the app and its own SQLite database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, '.screenshots'), { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tea-games-'));
for (const file of ['server.js', 'index.html', 'inventory.js']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
const server = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: '3147' }, windowsHide: true, stdio: 'pipe' });
let browser;
(async () => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch('http://127.0.0.1:3147/api/me')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, channel: process.env.TEA_BROWSER || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3147');
  await page.locator('#app-main').waitFor({ state: 'visible' });
  await page.waitForFunction(() => drinks.length === 23);
  await page.evaluate(() => { const original=makeNumberTicket;window.numberTicketOriginal=original;makeNumberTicket=result=>original(result,1); });
  const force = kind => page.evaluate(kind => { randomIndex = () => kind === 'win' ? 0 : layout.findIndex(s => s.drink.kind === kind); }, kind);
  const close = async () => { await page.locator('#result[open]').waitFor(); await page.locator('#close').click(); };
  const total = () => page.evaluate(async () => (await api('/api/draws')).length);
  let recorded = await total();
  await page.locator('#mode-scratch').click();
  for (const type of ['number', 'word']) {
    for (const kind of ['win', 'blank', 'retry']) {
      await force(kind);
      await page.locator('#scratch-' + type).click();
      if (kind === 'win') assert.equal(await page.locator(type === 'number' ? '.ticket-cell.winner' : '.ticket-word').count(), 1);
      if(type==='number'){
        assert.equal(await page.locator('.ticket-number-row').count(),15);
        assert.equal(await page.locator('.ticket-cell').count(),15);
        assert.equal(await page.locator('.ticket-cell.winner').count(),kind==='blank'?0:1);
        assert.equal(await page.locator('.ticket-cell em').count(),15);
        const lucky=await page.locator('.lucky-number').textContent();
        const numbers=await page.locator('.ticket-cell b').allTextContents();
        assert.equal(numbers.includes(lucky),kind!=='blank');
      }
      await page.locator('#spin').click();
      await page.locator('#result[open]').waitFor();
      assert.equal(await page.locator('#name').textContent(), kind === 'win' ? await page.evaluate(() => drinks[0].name) : kind === 'blank' ? '空奖' : '再来一次');
      assert.equal(await page.locator('#copy').isVisible(), kind === 'win');
      if (kind === 'win') { recorded++; await page.waitForFunction(n => history.length === n, recorded); }
      assert.equal(await total(), recorded, 'only drink wins should be recorded');
      if (kind === 'retry') {
        await force('win');
        await page.locator('#confirm').click();
        assert.equal(await page.evaluate(() => scratchRevealed), false);
      } else await close();
    }
  }
  // Multiple matches are real rewards, appear in the summary, and each save once.
  for(const count of [2,3]){
    await force('win');
    await page.evaluate(count=>{makeNumberTicket=result=>numberTicketOriginal(result,count)},count);
    await page.locator('#scratch-number').click();
    assert.equal(await page.locator('.lucky-number').count(),count);
    assert.equal(await page.locator('.ticket-cell.winner').count(),count);
    await page.locator('#spin').click();await page.locator('#result[open]').waitFor();
    assert.equal(await page.locator('#name').textContent(),'收获 '+count+' 份好运！');
    assert.equal(await page.locator('#notes').textContent().then(s=>s.split('参考价值').length-1),count);
    recorded+=count;await page.waitForFunction(n=>history.length===n,recorded);
    assert.equal(await total(),recorded);await close();
    if(count===3){
      await page.locator('#ticket').screenshot({path:path.join(root,'.screenshots','number-ticket-multi-desktop.png')});
      await page.setViewportSize({width:390,height:844});
      await page.locator('#ticket').screenshot({path:path.join(root,'.screenshots','number-ticket-multi-mobile.png')});
      await page.setViewportSize({width:1280,height:900});
    }
  }
  await page.evaluate(()=>{makeNumberTicket=result=>numberTicketOriginal(result,1)});
  // Scratch using the real pointer/canvas path, not the direct reveal button.
  await force('win');await page.locator('#scratch-number').click();
  await page.locator('#scratch').scrollIntoViewIfNeeded();
  const rect = await page.locator('#scratch').boundingBox();
  await page.mouse.move(rect.x + 4, rect.y + 10);await page.mouse.down();
  for (let y = 12; y < rect.height; y += 18) {
    await page.mouse.move(rect.x + 8, rect.y + y);
    await page.mouse.move(rect.x + rect.width - 8, rect.y + y, { steps: 8 });
  }
  await page.mouse.up();await page.locator('#result[open]').waitFor();recorded++;
  await page.waitForFunction(n => history.length === n, recorded);await close();
  assert.equal(await page.locator('#scratch-progress').getAttribute('aria-valuenow'), '100');
  // Slot animation, repeated clicks, win/blank/retry and keyboard access.
  await page.locator('#mode-slot').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await force('win');await page.locator('#slot-lever').click();
  await page.evaluate(() => { playSlot();playSlot();setMode('wheel'); });
  assert.equal(await page.evaluate(() => mode), 'slot');
  const winningName=await page.evaluate(()=>drinks[0].name);
  for(let active=0;active<3;active++){
    await page.waitForFunction(i=>{
      const reels=[...document.querySelectorAll('.slot-reel')];
      return reels.filter(r=>r.classList.contains('rolling')).length===1&&reels[i].classList.contains('rolling');
    },active);
    const stages=await page.locator('.slot-reel').evaluateAll(reels=>reels.map(reel=>({name:reel.querySelector('b').textContent,animation:getComputedStyle(reel.querySelector('b')).animationName})));
    for(let i=0;i<3;i++){
      assert.equal(stages[i].animation,i===active?'reel-roll':'none','only the current reel animates');
      if(i<active)assert.equal(stages[i].name,winningName,'stopped reels retain their result');
      if(i>active)assert.equal(stages[i].name,'等待好运','later reels have not started');
    }
    assert.equal(await page.locator('#slot-lever').isDisabled(),true);
    assert.equal(await page.locator('#result').getAttribute('open'),null,'no result before the third reel stops');
    assert.equal(await total(),recorded,'no record before the third reel stops');
  }
  await page.locator('#result[open]').waitFor();
  assert.equal(await page.locator('.slot-reel.rolling').count(),0);
  assert.equal(await page.locator('.slot-reel b').allTextContents().then(a => new Set(a).size), 1);
  recorded++;await page.waitForFunction(n => history.length === n, recorded);await close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const kind of ['blank','retry']) {
    await force(kind);await page.locator('#slot-play').focus();await page.keyboard.press('Enter');
    await page.locator('#result[open]').waitFor();
    if (kind === 'blank') assert.ok(new Set(await page.locator('.slot-reel b').allTextContents()).size > 1);
    else { await force('win');await page.locator('#confirm').click();await page.locator('#result[open]').waitFor();recorded++;await page.waitForFunction(n => history.length === n, recorded); }
    await close();
  }
  // Synthetic device motion validates the handler; physical sensor testing remains manual.
  await page.evaluate(() => { window.DeviceMotionEvent = class {}; });
  await page.locator('#slot-motion').click();
  assert.equal(await page.locator('#slot-motion').textContent(), '摇一摇已开启');
  await force('win');
  await page.evaluate(() => { const e=new Event('devicemotion');e.accelerationIncludingGravity={x:25,y:0,z:0};dispatchEvent(e);dispatchEvent(e); });
  await page.locator('#result[open]').waitFor();recorded++;await page.waitForFunction(n => history.length === n, recorded);await close();
  // Capsule sequence stays locked until the player opens it, then records exactly once.
  await page.locator('#mode-capsule').click();
  assert.equal(await page.locator('.gacha-capsule i').count(),16);
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const kind of ['win','blank','retry']){
    await force(kind);
    await page.locator('#capsule-knob').click();
    assert.equal(await page.evaluate(()=>capsulePhase),'coin');
    await page.evaluate(()=>{gacha();gacha();setMode('wheel')});
    assert.equal(await page.evaluate(()=>mode),'capsule');
    assert.equal(await page.locator('#capsule-knob').isDisabled(),true);
    await page.waitForFunction(()=>capsulePhase==='turn');
    assert.equal(await page.locator('#result').getAttribute('open'),null);
    await page.waitForFunction(()=>capsulePhase==='drop');
    await page.waitForFunction(()=>capsulePhase==='ready');
    assert.equal(await total(),recorded,'unopened capsule does not record');
    assert.equal(await page.locator('#result').getAttribute('open'),null);
    if(kind==='win')await page.locator('#capsule-machine').screenshot({path:path.join(root,'.screenshots','capsule-ready.png')});
    if(kind==='blank')await page.locator('#spin').click();
    else {await page.locator('#capsule-drop').focus();await page.keyboard.press('Enter')}
    assert.equal(await page.evaluate(()=>capsulePhase),'opening');
    await page.evaluate(()=>{revealCapsule();revealCapsule();gacha()});
    assert.equal(await page.locator('#result').getAttribute('open'),null,'opening precedes result');
    await page.locator('#result[open]').waitFor();
    assert.equal(await page.locator('#name').textContent(),kind==='win'?await page.evaluate(()=>drinks[0].name):kind==='blank'?'空奖':'再来一次');
    if(kind==='win'){recorded++;await page.waitForFunction(n=>history.length===n,recorded)}
    assert.equal(await total(),recorded,'only one winning capsule record');
    await close();
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  // Existing modes still produce a result and save one record each.
  for (const mode of ['wheel','capsule','box']) {
    await force('win');await page.locator('#mode-' + mode).click();
    if (mode === 'box') {await page.locator('.lucky-box').first().click();await page.locator('#box-detail').click();}
    else {await page.locator('#spin').click();if(mode==='capsule'){await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}}
    await page.locator('#result[open]').waitFor();recorded++;await page.waitForFunction(n => history.length === n, recorded);await close();
  }
  await page.locator('#open-odds').click();
  assert.equal(await page.locator('.odds-pct').allTextContents().then(a => Math.round(a.reduce((n,v)=>n+parseFloat(v),0)*10)), 1000);
  await page.locator('#odds-close').click();
  // Mobile layouts and screenshots.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ['slot','scratch','capsule']) {
    await page.locator('#mode-' + mode).click();
    if (mode === 'scratch') await page.locator('#scratch-word').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), mode + ' mobile overflow');
    await page.screenshot({ path: path.join(root, '.screenshots', 'games-' + mode + '-mobile.png'), fullPage: true });
  }
  await page.locator('#mode-scratch').click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await force('blank');await page.locator('#scratch-number').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'number ticket mobile overflow');
    assert.equal(await page.locator('.ticket-number-row').count(),15);
    await page.locator('#spin').click();await close();
    assert.equal(await page.locator('.ticket-cell.winner').count(),0);
    assert.equal(await page.locator('.ticket-cell').count(),15);
    await page.screenshot({path:path.join(root,'.screenshots','number-ticket-'+width+'.png'),fullPage:true});
  }
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});await page.locator('#mode-capsule').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'capsule mobile overflow');
    const machine=await page.locator('#capsule-machine').boundingBox();assert.ok(machine.x>=0&&machine.x+machine.width<=width);
    await page.locator('#capsule-machine').screenshot({path:path.join(root,'.screenshots','capsule-machine-'+width+'.png')});
  }
  // Single drink and empty menus: no accidental three-of-a-kind blank, no stale ticket.
  await page.evaluate(() => { drinks=drinks.slice(0,1);renderAll(); });
  await force('blank');await page.locator('#mode-slot').click();await page.locator('#slot-play').click();
  await page.locator('#result[open]').waitFor();assert.ok(new Set(await page.locator('.slot-reel b').allTextContents()).size > 1);await close();
  await page.evaluate(() => { drinks=[];renderAll(); });
  assert.equal(await page.locator('#slot-play').isDisabled(), true);
  await page.locator('#mode-scratch').click();assert.equal(await page.locator('#spin').isDisabled(), true);
  assert.equal(await page.evaluate(() => scratchDrink), null);
  // General prize management: real CSV upload, preview, import, edit and downloads.
  await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'admin123'})})));
  await page.locator('#admin-config summary').click();
  const csv=require('../inventory').toCSV([{brand:'',name:'无线耳机',price:1299.99,note:'蓝色，凭券领取'},{brand:'',name:'无线耳机',price:1299.99,note:'重复'}]);
  await page.locator('#import-file').setInputFiles({name:'gifts.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#import-preview').waitFor({state:'visible'});
  assert.match(await page.locator('#import-summary').textContent(),/新增 1 条，重复跳过 1 条/);
  await page.locator('#confirm-import').click();
  await page.waitForFunction(()=>drinks.some(d=>d.name==='无线耳机'));
  const giftRow=page.locator('#config-list tr').filter({hasText:'无线耳机'});
  assert.equal(await giftRow.locator('.price-input').inputValue(),'1299.99');
  await giftRow.getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('#new-name').fill('蓝牙耳机');await page.locator('#new-note').fill('礼品备注');
  await page.locator('#save-item').click();
  await page.waitForFunction(()=>drinks.some(d=>d.name==='蓝牙耳机'));
  await page.locator('#new-name').fill('礼品卡');await page.locator('#new-price').fill('100');await page.locator('#save-item').click();
  await page.waitForFunction(()=>drinks.some(d=>d.name==='礼品卡'));
  for(const [id,expected] of [['download-template','奖品导入模板.csv'],['export-items','奖品清单.csv']]){
    const downloadPromise=page.waitForEvent('download');await page.locator('#'+id).click();
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),expected);
    assert.equal(await download.failure(),null);
  }
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'management mobile overflow');
  }
  await page.screenshot({path:path.join(root,'.screenshots','prize-management-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:path.join(root,'.screenshots','prize-management-desktop.png'),fullPage:true});
  assert.deepEqual(errors, []);
  console.log('PASS: wins, blanks, retry, pointer scratching, lever/keyboard/shake, duplicate-click lock, history, existing modes, odds, mobile, single/empty menus');
})().catch(error => { console.error(error);process.exitCode=1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
  // Test files remain in the OS temp folder; never remove user workspace data.
});
