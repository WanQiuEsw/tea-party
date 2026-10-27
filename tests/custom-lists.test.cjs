const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');

test('named cross-brand lists persist, isolate accounts and control all draw candidates',async()=>{
  const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-lists-'));
  for(const file of fs.readdirSync(root).filter(f=>/\.(js|css|html|json)$/.test(f)))fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
  const port=33000+process.pid%10000,base='http://127.0.0.1:'+port;let server,browser;
  const request=async(url,cookie='',body,method=body?'POST':'GET')=>{
    const res=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const start=async()=>{server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});for(let i=0;i<80;i++){try{if((await request('/api/me')).status===200)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('server failed')};
  const stop=async()=>{const done=new Promise(r=>server.once('exit',r));server.kill();await done};
  const login=async username=>(await request('/api/login','',{username,password:username==='admin'?'admin123':'123456'})).cookie;
  try{
    await start();assert.equal((await request('/api/lists')).status,401);
    let user=await login('user');const ping=await login('ping'),admin=await login('admin');
    const catalog=(await request('/api/drinks',user)).data;
    const a=catalog.find(d=>d.brand==='古茗'),b=catalog.find(d=>d.brand==='茶百道'),c=catalog.find(d=>d.brand==='壶见');
    const ids=[a.id,b.id],save=(name,drinkIds,id)=>request('/api/lists'+(id?'/'+id:''),user,{name,drinkIds},id?'PUT':'POST');
    for(const [name,values] of [['',ids],['x'.repeat(31),ids],['清单',[]],['清单',[a.id,a.id]],['清单',['1']],['清单',[-1]],['清单',[999999]]])assert.equal((await save(name,values)).status,400);
    assert.equal((await request('/api/lists',admin,{name:'管理',drinkIds:ids})).status,403);
    let saved=await save('  工作日快乐水  ',ids);assert.equal(saved.status,201);
    const first=saved.data.selectedId;assert.equal(saved.data.lists[0].name,'工作日快乐水');
    assert.deepEqual((await request('/api/lists',ping)).data,{selectedId:null,lists:[]});
    for(const method of ['PUT','DELETE'])assert.equal((await request('/api/lists/'+first,ping,{name:'越权',drinkIds:ids},method)).status,404);
    assert.equal((await request('/api/draws',user,{drinkIds:[a.id]})).status,409);
    let held=null;
    for(let i=0;i<12;i++){
      const result=await request('/api/draws',user,{replaceDrawId:held,drinkIds:catalog.filter(d=>ids.includes(d.id)).map(d=>d.id)});
      assert.equal(result.status,201);assert.ok(ids.includes(result.data.outcome.id));assert.equal(result.data.outcome.kind,undefined);held=result.data.record.id;
    }
    saved=await save('周末清单',[c.id]);const second=saved.data.selectedId;assert.notEqual(second,first);
    assert.equal(saved.data.lists.length,2);
    assert.equal((await request('/api/draws',user,{replaceDrawId:held,drinkIds:[a.id,b.id]})).status,409);
    const single=await request('/api/draws',user,{replaceDrawId:held,drinkIds:[c.id]});assert.equal(single.data.outcome.id,c.id);
    await save('重命名后的清单',ids,first);
    await stop();await start();user=await login('user');
    saved=await request('/api/lists',user);assert.equal(saved.data.selectedId,first);assert.equal(saved.data.lists[0].name,'重命名后的清单');
    const adminAgain=await login('admin');await request('/api/drinks/'+a.id,adminAgain,undefined,'DELETE');
    saved=await request('/api/lists',user);assert.deepEqual(saved.data.lists[0].drinkIds,[b.id],'deleted catalog items disappear from lists');
    const fresh=await request('/api/drinks',adminAgain,{brand:b.brand,name:'新增饮品',price:10,note:''});assert.equal(fresh.status,201);
    assert.deepEqual((await request('/api/lists',user)).data.lists[0].drinkIds,[b.id],'new catalog items require manual addition');
    await request('/api/menu',user,{brand:b.brand,excludedIds:[]},'PUT');
    assert.equal((await request('/api/lists',user)).data.selectedId,null,'shop selection deactivates custom list');
    await save('只喝这一杯',[b.id],first);
    await request('/api/lists/'+first,user,undefined,'DELETE');
    saved=await request('/api/lists',user);assert.equal(saved.data.selectedId,null);assert.equal(saved.data.lists.length,1);
    assert.ok((await request('/api/draws',user)).data.length>=13,'deleting a list preserves history');

    if(process.env.TEA_LIST_BROWSER){
      const {chromium}=require('playwright');browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
      const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.waitForFunction(()=>allDrinks.length&&drawQuota);
      const choose=async brand=>{await page.locator('#shop-search').fill(brand);await page.locator('#shop-results .shop-option').filter({has:page.getByText(brand,{exact:true})}).click()};
      const saveUI=async()=>{await page.locator('#save-menu').click();await page.locator('#personal-menu').waitFor({state:'hidden'})};
      await page.locator('#new-list').click();assert.equal(await page.locator('#save-menu').isDisabled(),true);
      await page.locator('#list-name').fill('跨店快乐水');
      await choose('古茗');await page.locator('.menu-exclude').first().click();
      await choose('茶百道');await page.locator('.menu-exclude').first().click();
      await page.locator('#show-included').click();assert.equal(await page.locator('.menu-exclude').count(),2);
      for(const width of [320,390,768,1280]){
        await page.setViewportSize({width,height:900});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width);
        assert.ok(await page.locator('#personal-menu').evaluate(el=>el.scrollWidth<=el.clientWidth),'no dialog overflow '+width);
        const bounds=await page.locator('#save-menu').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900,'save visible '+width);
      }
      if(process.env.TEA_SCREENSHOT){await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'.screenshots','custom-list-mobile.png')});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(root,'.screenshots','custom-list-desktop.png')})}
      await saveUI();assert.equal(await page.locator('#shop-current').textContent(),'跨店快乐水');
      await page.reload();await page.waitForFunction(()=>drinks.length===2&&selectedListId!==null);
      assert.deepEqual(await page.evaluate(()=>layout.map(s=>s.prob)),[.5,.5]);
      for(const mode of ['wheel','flip','box','capsule','scratch','number','slot']){
        await page.locator('#mode-'+mode).click();
        if(mode==='flip')await page.locator('.flip-card').last().click();
        else if(mode==='box'){await page.locator('.lucky-box').last().click();await page.locator('#box-detail').click()}
        else if(mode==='capsule'){await page.locator('#capsule-knob').click();await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
        else if(mode==='slot')await page.locator('#slot-play').click();else await page.locator('#spin').click();
        await page.locator('#result[open]').waitFor();
        assert.ok(await page.evaluate(()=>drinks.some(d=>d.id===current.id)),mode+' uses custom list');
        assert.equal(await page.locator('#result-tier').textContent(),'');assert.equal(await page.locator('#result-probability').textContent(),'');
        await page.locator('#close').click();
      }
      await page.locator('#edit-menu').click();await page.locator('#list-name').fill('一杯也开心');await page.locator('.menu-exclude').first().click();await saveUI();
      assert.equal(await page.evaluate(()=>drinks.length),1);assert.equal(await page.locator('#spin').isEnabled(),true);
      for(const mode of ['wheel','flip','box','capsule','scratch','number','slot']){await page.locator('#mode-'+mode).click();assert.deepEqual(await page.evaluate(()=>layout.map(s=>s.prob)),[1]);}
      await page.locator('#edit-menu').click();await page.locator('#list-name').fill('取消的修改');await page.locator('#cancel-menu').click();assert.equal(await page.locator('#shop-current').textContent(),'一杯也开心');
      page.once('dialog',dialog=>dialog.accept());await page.locator('#edit-menu').click();await page.locator('#delete-list').click();await page.locator('#personal-menu').waitFor({state:'hidden'});
      assert.equal(await page.evaluate(()=>selectedListId),null);assert.deepEqual(errors,[]);
      // Bulk selection preserves every catalog item and only limits the wheel presentation.
      await page.locator('#shop-select').click();
      assert.equal(await page.locator('#custom-lists').isVisible(),false);
      await page.locator('#cancel-menu').click();
      await page.locator('#new-list').click();await page.locator('#list-name').fill('全部奶茶');
      await choose('古茗');await page.locator('#select-brand').click();
      const brandCount=await page.evaluate(()=>allDrinks.filter(d=>d.brand==='古茗').length);
      assert.equal(await page.evaluate(()=>draftIncluded.size),brandCount);
      assert.equal(await page.locator('#select-brand').isDisabled(),true);
      await page.locator('#drink-search').fill('不存在的饮品');
      await page.locator('#select-all-drinks').click();
      assert.equal(await page.evaluate(()=>draftIncluded.size===allDrinks.length),true);
      assert.equal(await page.locator('#select-all-drinks').isDisabled(),true);
      await page.locator('#clear-list').click();assert.equal(await page.locator('#save-menu').isDisabled(),true);
      await page.locator('#select-all-drinks').click();await saveUI();
      assert.equal(await page.evaluate(()=>drinks.length===allDrinks.length),true);
      assert.equal(await page.locator('#mode-wheel').isVisible(),false);
      assert.equal(await page.locator('#wheel-stage').isVisible(),false);
      assert.equal(await page.locator('#wheel-limit-note').isVisible(),true);
      await page.evaluate(()=>setMode('wheel'));assert.notEqual(await page.evaluate(()=>mode),'wheel');
      await page.reload();await page.waitForFunction(()=>drinks.length===allDrinks.length&&drawQuota);
      assert.equal(await page.locator('#mode-wheel').isVisible(),false);
      const counts=await page.evaluate(()=>{
        const saved=drinks,results=[];
        for(const size of [0,1,2,3,4,8,9,10,12,13,allDrinks.length]){
          drinks=allDrinks.slice(0,size);renderFlip();renderBoxes();renderCapsules();
          results.push({size,flip:document.querySelectorAll('.flip-card').length,box:document.querySelectorAll('.lucky-box').length,capsule:document.querySelectorAll('.gacha-capsule').length,rewards:boxRewards.length});
        }
        drinks=saved;renderAll();return results;
      });
      for(const {size,flip,box,capsule,rewards} of counts){
        assert.equal(flip,Math.min(3,size));assert.equal(box,Math.min(9,size));
        assert.equal(capsule,Math.min(12,size));assert.equal(rewards,box);
      }
      // A result beyond every display cap must still appear on the chosen object.
      await page.evaluate(()=>{globalThis.originalRequestDraw=requestDraw;requestDraw=async()=>drinks.at(-1)});
      const lastDrink=await page.evaluate(()=>drinks.at(-1).id);
      for(const mode of ['flip','box','capsule']){
        await page.locator('#mode-'+mode).click();
        for(const width of [320,390,768,1280]){
          await page.setViewportSize({width,height:900});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' full catalog fits '+width);
          if(process.env.TEA_SCREENSHOT&&width===390)await page.locator('#'+mode+'-stage').screenshot({path:path.join(root,'.screenshots','capped-'+mode+'.png')});
        }
        if(mode==='flip')await page.locator('.flip-card').last().click();
        if(mode==='box'){await page.locator('.lucky-box').last().click();await page.locator('#box-detail').click()}
        if(mode==='capsule'){await page.locator('#capsule-knob').click();await page.waitForFunction(()=>capsulePhase==='ready');await page.locator('#capsule-drop').click()}
        await page.locator('#result[open]').waitFor();
        assert.equal(await page.evaluate(()=>current.id),lastDrink,mode+' can reveal the last catalog drink');
        await page.locator('#close').click();
      }
      await page.evaluate(()=>{requestDraw=globalThis.originalRequestDraw;delete globalThis.originalRequestDraw});
      await page.locator('#mode-slot').click();
      await page.locator('#slot-play').click();await page.locator('#result[open]').waitFor();await page.locator('#close').click();
      for(const size of [25,24]){
        await page.locator('#edit-menu').click();
        await page.evaluate(size=>{draftIncluded=new Set(allDrinks.slice(0,size).map(d=>d.id));renderPersonalMenu()},size);
        await saveUI();
        assert.equal(await page.locator('#mode-wheel').isVisible(),size<=24);
        assert.equal(await page.locator('#wheel-limit-note').isVisible(),size>24);
      }
      await page.locator('#mode-wheel').click();await page.locator('#wheel-spin').click();await page.locator('#result[open]').waitFor();await page.locator('#close').click();
      await page.locator('#new-list').click();await page.locator('#create-list').click();
      assert.equal(await page.locator('#list-name').inputValue(),'');assert.equal(await page.evaluate(()=>draftIncluded.size),0);
      await page.locator('#cancel-menu').click();assert.equal(await page.evaluate(()=>drinks.length),24);
      for(const width of [320,390,768,1280]){
        await page.setViewportSize({width,height:900});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'bulk homepage fits '+width);
        await page.locator('#new-list').click();
        assert.ok(await page.locator('#personal-menu').evaluate(el=>el.scrollWidth<=el.clientWidth),'bulk dialog fits '+width);
        if(process.env.TEA_SCREENSHOT&&[390,1280].includes(width))await page.screenshot({path:path.join(root,'.screenshots','bulk-list-'+width+'.png')});
        await page.locator('#cancel-menu').click();
      }
      assert.deepEqual(errors,[]);
      await page.evaluate(()=>loadWinnerTicker());assert.equal(await page.locator('.winner-badge').count(),0);
    }
  }finally{if(browser)await browser.close();if(server?.exitCode===null)await stop();fs.rmSync(temp,{recursive:true,force:true})}
});
