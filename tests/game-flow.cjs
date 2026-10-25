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
for (const file of ['server.js', 'index.html']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
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
  // Scratch using the real pointer/canvas path, not the direct reveal button.
  await force('win');await page.locator('#scratch-number').click();
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
  await page.locator('#result[open]').waitFor();
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
  // Existing modes still produce a result and save one record each.
  for (const mode of ['wheel','capsule','box']) {
    await force('win');await page.locator('#mode-' + mode).click();
    if (mode === 'box') {await page.locator('.lucky-box').first().click();await page.locator('#box-detail').click();}
    else await page.locator('#spin').click();
    await page.locator('#result[open]').waitFor();recorded++;await page.waitForFunction(n => history.length === n, recorded);await close();
  }
  await page.locator('#open-odds').click();
  assert.equal(await page.locator('.odds-pct').allTextContents().then(a => Math.round(a.reduce((n,v)=>n+parseFloat(v),0)*10)), 1000);
  await page.locator('#odds-close').click();
  // Mobile layouts and screenshots.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const mode of ['slot','scratch']) {
    await page.locator('#mode-' + mode).click();
    if (mode === 'scratch') await page.locator('#scratch-word').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), mode + ' mobile overflow');
    await page.screenshot({ path: path.join(root, '.screenshots', 'games-' + mode + '-mobile.png'), fullPage: true });
  }
  // Single drink and empty menus: no accidental three-of-a-kind blank, no stale ticket.
  await page.evaluate(() => { drinks=drinks.slice(0,1);renderAll(); });
  await force('blank');await page.locator('#mode-slot').click();await page.locator('#slot-play').click();
  await page.locator('#result[open]').waitFor();assert.ok(new Set(await page.locator('.slot-reel b').allTextContents()).size > 1);await close();
  await page.evaluate(() => { drinks=[];renderAll(); });
  assert.equal(await page.locator('#slot-play').isDisabled(), true);
  await page.locator('#mode-scratch').click();assert.equal(await page.locator('#spin').isDisabled(), true);
  assert.equal(await page.evaluate(() => scratchDrink), null);
  assert.deepEqual(errors, []);
  console.log('PASS: wins, blanks, retry, pointer scratching, lever/keyboard/shake, duplicate-click lock, history, existing modes, odds, mobile, single/empty menus');
})().catch(error => { console.error(error);process.exitCode=1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
  // Test files remain in the OS temp folder; never remove user workspace data.
});
