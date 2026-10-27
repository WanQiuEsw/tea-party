const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');

test('gift result modal fits screens and preserves prize, copy and close actions',{skip:!process.env.TEA_RESULT_BROWSER},async()=>{
  const {chromium}=require('playwright');
  const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-result-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
  fs.appendFileSync(path.join(temp,'game-rules.js'),"\nif(typeof module!=='undefined')module.exports.pick=drinks=>drinks[0];\n");
  const port=42000+process.pid%10000,base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  let browser;
  try{
    let ready=false;
    for(let i=0;i<80;i++){try{if((await fetch(base+'/api/me')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
    assert.ok(ready,'isolated server starts');
    for(const asset of ['/result.css','/assets/result-gift.webp'])assert.equal((await fetch(base+asset)).status,200);
    browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>allDrinks.length>0&&drawQuota!==null);
    await page.locator('#shop-select').click();await page.locator('.shop-option').filter({has:page.getByText('古茗',{exact:true})}).click();await page.locator('#save-menu').click();await page.waitForFunction(()=>selectedBrand==='古茗'&&!menuSaving);
    const open=()=>page.evaluate(()=>showResult(drinks.find(d=>d.name==='桂花酒酿小丸子')||drinks[0]));
    const out=path.join(root,'.screenshots','result-gift');fs.mkdirSync(out,{recursive:true});
    for(const [width,height] of [[320,568],[390,844],[768,1024],[1280,900],[844,390]]){
      await page.setViewportSize({width,height});await open();
      await page.waitForFunction(()=>document.querySelector('.result-art img').naturalWidth>0);
      const fits=await page.locator('#result').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth+1});
      assert.ok(fits,'no modal overflow at '+width+'×'+height);
      await page.screenshot({path:path.join(out,width+'.png')});
      if(height>=568)assert.ok(await page.locator('#result').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'standard prize needs no scrolling at '+width);
      await page.locator('#confirm').click();assert.equal(await page.locator('#result').isVisible(),false);
    }
    await page.setViewportSize({width:390,height:844});
    await open();assert.equal(await page.locator('#result-tier').textContent(),'');await page.keyboard.press('Escape');
    await open();await page.locator('#copy').click();
    await page.waitForFunction(()=>$('copy').textContent==='奖品信息已复制！');
    assert.equal(await page.locator('#copy').textContent(),'奖品信息已复制！');
    assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/古茗/);
    await page.locator('#close').click();
    await page.evaluate(()=>{mode='number';showResult(drinks[0],[drinks[0],drinks[1]])});
    assert.match(await page.locator('#name').textContent(),/2 份/);
    assert.equal(await page.locator('#result-prizes').isVisible(),true);
    assert.equal(await page.locator('#result-tier').textContent(),'');
    await page.screenshot({path:path.join(out,'multiple.png')});await page.keyboard.press('Escape');
    await page.evaluate(()=>{mode='wheel';showResult({...drinks[0],name:'超长奖品名称'.repeat(8)})});
    assert.ok(await page.locator('#result').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'long names wrap');
    await page.keyboard.press('Escape');
    await open();await page.waitForTimeout(3200);
    assert.equal(await page.locator('#result').isVisible(),true,'ordinary prize stays open after three seconds');
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('#result').isVisible(),false,'ordinary prize auto closes');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>showResult(drinks[0]));
    await page.waitForTimeout(500);
    assert.ok(await page.locator('#result').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'celebration does not cause horizontal scrolling');
    await page.screenshot({path:path.join(out,'celebration.png')});
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
