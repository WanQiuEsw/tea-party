const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');

test('admin pagination searches all history, validates input and supports prize editing',async()=>{
  const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tea-admin-'));
  for(const file of ['server.js','catalog.json','index.html','inventory.js','game-rules.js','fortune.js','flip.css','scratch.css','wheel.css','cover.css','result.css'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.cpSync(path.join(root,'assets'),path.join(temp,'assets'),{recursive:true});
  const port=43000+process.pid%10000,base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'pipe'});
  const request=async(url,cookie='',body)=>{
    const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  let db,browser;
  try{
    let ready=false;
    for(let i=0;i<80;i++){try{await request('/api/me');ready=true;break}catch{}await new Promise(r=>setTimeout(r,100))}
    assert.ok(ready,'isolated server starts');
    assert.equal((await request('/api/draws/all?page=1')).status,401);
    const user=(await request('/api/login','',{username:'user',password:'123456'})).cookie;
    assert.equal((await request('/api/draws/all?page=1',user)).status,403);
    const admin=(await request('/api/login','',{username:'admin',password:'admin123'})).cookie;
    db=new DatabaseSync(path.join(temp,'tea.db'));
    const uid=db.prepare("SELECT id FROM users WHERE username='user'").get().id;
    const insert=db.prepare('INSERT INTO draws (user_id,brand,name,price,created_at) VALUES (?,?,?,?,?)');
    for(let i=0;i<213;i++)insert.run(uid,'测试品牌',i===0?'早期奖品100%':'分页奖品'+i,i===1?null:18.5,'2026-10-26T17:30:00.000Z');
    assert.equal((await request('/api/draws',admin,{})).status,403,'admin draws are blocked on the server');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM draws').get().total,213,'blocked draw creates no history');
    assert.equal((await request('/api/quota',admin)).data.remaining,0);
    for(const size of [5,10,20,50]){
      const {data}=await request('/api/draws/all?page=1&pageSize='+size,admin);
      assert.equal(data.total,213);assert.equal(data.items.length,size);assert.equal(data.items[0].name,'分页奖品212');
      const second=(await request('/api/draws/all?page=2&pageSize='+size,admin)).data;
      assert.equal(second.items[0].id,data.items.at(-1).id-1);
    }
    const last=(await request('/api/draws/all?page=999&pageSize=10',admin)).data;
    assert.equal(last.page,22);assert.equal(last.items.length,3);
    for(const [search,total] of [['早期奖品100%',1],['测试品牌',213],['USER',213],['2026-10-27',213],['18.5',212],["' OR 1=1 --",0]]){
      const {data}=await request('/api/draws/all?page=1&search='+encodeURIComponent(search),admin);
      assert.equal(data.total,total,search);
    }
    for(const query of ['page=0','page=1.5','page=NaN','page=1&pageSize=7','page=1&search='+'x'.repeat(101)])assert.equal((await request('/api/draws/all?'+query,admin)).status,400);
    assert.equal((await request('/api/draws/all',admin)).data.length,200,'legacy callers stay compatible');
    if(process.env.TEA_ADMIN_BROWSER){
      const {chromium}=require('playwright');
      browser=await chromium.launch({headless:true,channel:process.env.TEA_BROWSER||'chrome'});
      const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
      const cookie=admin.split('=');await context.addCookies([{name:cookie[0],value:cookie[1],url:base}]);
      const page=await context.newPage(),errors=[],playerRequests=[];page.on('pageerror',e=>errors.push(e.message));
      page.on('request',request=>{if(['/api/menu','/api/draws','/api/quota','/api/rewards','/api/winners'].includes(new URL(request.url()).pathname))playerRequests.push(request.url())});
      const search=async(prefix,value)=>{await page.locator('#open-'+prefix+'-search').click();await page.locator('#'+prefix+'-search').fill(value);await page.locator('#'+prefix+'-search-form').getByRole('button',{name:'搜索',exact:true}).click()};
      await page.goto(base);await page.waitForFunction(()=>document.querySelector('#draws-list').children.length===10);

      assert.ok(await page.locator('#admin-config').evaluate(el=>el.open&&el.parentElement.firstElementChild===el),'management list is open and first');
      for(const selector of ['.shop-picker','.layout','.winner-ticker','#my-rewards'])assert.equal(await page.locator(selector).isVisible(),false,selector+' is hidden for admins');
      assert.equal(await page.locator('#admin-draws').isVisible(),true);
      assert.deepEqual(playerRequests,[],'admin loads only management data');
      assert.equal(await page.locator('#config-list tr').count(),10);
      assert.equal(await page.locator('#prize-search').isVisible(),false);
      await page.locator('#open-prize-search').click();await page.locator('#prize-search').fill('取消搜索');await page.locator('#prize-search-dialog').getByRole('button',{name:'取消',exact:true}).click();
      assert.equal(await page.locator('#config-list tr').count(),10,'cancelled search leaves list unchanged');
      for(const size of [5,20,50,10]){
        await page.locator('#prize-pagination select').selectOption(String(size));assert.equal(await page.locator('#config-list tr').count(),size);
        await page.locator('#draw-pagination select').selectOption(String(size));await page.waitForFunction(n=>document.querySelector('#draws-list').children.length===n,size);
      }
      await page.locator('#prize-pagination').getByRole('button',{name:'下一页',exact:true}).click();
      assert.match(await page.locator('#prize-pagination [role=status]').textContent(),/2 \/ 17/);
      await page.locator('#select-all').check();assert.equal(await page.locator('.drink-check:checked').count(),10);
      await page.locator('#prize-pagination').getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await page.locator('.drink-check:checked').count(),0);
      await search('prize','古茗');
      assert.match(await page.locator('#prize-pagination [role=status]').textContent(),/1 \//);
      assert.ok((await page.locator('#config-list').textContent()).includes('古茗'));
      const first=await page.locator('#config-list tr').first().textContent();
      await page.locator('#config-list tr').first().getByRole('button',{name:'编辑',exact:true}).click();
      await page.locator('#edit-name').fill('取消修改');await page.locator('#cancel-edit').click();
      assert.equal(await page.locator('#config-list tr').first().textContent(),first);
      await page.locator('#config-list tr').first().getByRole('button',{name:'编辑',exact:true}).click();
      for(const [key,value] of Object.entries({brand:'弹窗品牌',name:'弹窗礼品',price:'128.25',note:'到店领取'}))await page.locator('#edit-'+key).fill(value);
      await page.locator('#save-edit').click();await page.locator('#prize-editor').waitFor({state:'hidden'});
      await search('prize','到店领取');assert.equal(await page.locator('#config-list tr').count(),1);
      assert.match(await page.locator('#config-list').textContent(),/弹窗品牌.*弹窗礼品.*128.25.*到店领取/);
      await page.reload();await page.waitForFunction(()=>allDrinks.length>0);await search('prize','弹窗礼品');assert.equal(await page.locator('#config-list tr').count(),1);
      await page.locator('#config-list button').filter({hasText:'编辑'}).click();
      const duplicate=require('../catalog.json').find(d=>d.brand!=='古茗');await page.locator('#edit-brand').fill(duplicate.brand);await page.locator('#edit-name').fill(duplicate.name);await page.locator('#save-edit').click();
      await page.waitForFunction(()=>document.querySelector('#edit-error').textContent.length>0);assert.ok(await page.locator('#prize-editor').isVisible());await page.keyboard.press('Escape');
      await search('prize','没有这个奖品');assert.match(await page.locator('#config-list').textContent(),/没有匹配/);
      await search('draw','早期奖品100%');await page.waitForFunction(()=>document.querySelector('#draws-list').textContent.includes('早期奖品100%'));assert.equal(await page.locator('#draws-list tr').count(),1);
      assert.match(await page.locator('#draws-list').textContent(),/2026\/10\/27/);
      await search('draw','不存在的记录');await page.waitForFunction(()=>document.querySelector('#draws-list').textContent.includes('没有匹配'));
      await search('draw','');await page.waitForFunction(()=>document.querySelector('#draws-list').children.length===10);
      await page.locator('#draw-pagination').getByRole('button',{name:'末页',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#draws-list').children.length===3);
      for(const width of [390,320]){
        await page.setViewportSize({width,height:844});await search('prize','弹窗礼品');await page.locator('#config-list button').filter({hasText:'编辑'}).click();
        assert.ok(await page.locator('#prize-editor').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth}),'editor fits mobile');
        await page.screenshot({path:path.join(root,'.screenshots','admin-editor-'+width+'.png')});await page.locator('#cancel-edit').click();
      }
      await search('prize','');await page.locator('#prize-pagination select').selectOption('5');
      await page.locator('#prize-pagination').getByRole('button',{name:'末页',exact:true}).click();
      const beforeDelete=await page.evaluate(()=>allDrinks.length),remaining=await page.locator('#config-list tr').count();
      await page.locator('#select-all').check();page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-selected').click();
      await page.waitForFunction(n=>allDrinks.length===n,beforeDelete-remaining);
      assert.equal(await page.locator('#config-list tr').count(),5,'deleting the last page returns to a valid page');
      assert.equal(await page.locator('.drink-check:checked').count(),0);
      await page.setViewportSize({width:1280,height:900});await page.locator('#admin-config').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(root,'.screenshots','admin-list-desktop.png')});
      await page.locator('#add-prize').click();assert.match(await page.locator('#prize-editor-title').textContent(),/新增/);
      assert.equal(await page.locator('#edit-name').inputValue(),'');await page.locator('#edit-name').fill('取消新增');await page.locator('#cancel-edit').click();
      assert.equal(await page.evaluate(()=>allDrinks.some(d=>d.name==='取消新增')),false);
      await page.locator('#add-prize').click();
      for(const [key,value] of Object.entries({brand:'测试新增',name:'新增礼品',price:'29.99',note:'新增备注'}))await page.locator('#edit-'+key).fill(value);
      await page.locator('#save-edit').click();await page.locator('#prize-editor').waitFor({state:'hidden'});
      await search('prize','新增备注');assert.match(await page.locator('#config-list').textContent(),/新增礼品/);
      await page.locator('#clear-prize-search').click();assert.equal(await page.locator('#clear-prize-search').isVisible(),false);
      await page.locator('#open-import').click();
      const templateDownload=page.waitForEvent('download');await page.locator('#download-template').click();
      const template=await templateDownload;assert.match(template.suggestedFilename(),/奖品导入模板/);
      await page.locator('#import-file').setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('错误表头')});
      await page.waitForFunction(()=>document.querySelector('#import-state').textContent.length>0);assert.ok(await page.locator('#inventory-transfer').isVisible());
      const Inventory=require('../inventory');
      const csv=Inventory.toCSV([{brand:'测试导入',name:'CSV奖品',price:50,note:'导入备注'},{brand:'测试新增',name:'新增礼品',price:29.99,note:''}]);
      await page.locator('#import-file').setInputFiles({name:'prizes.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
      await page.locator('#import-preview').waitFor({state:'visible'});assert.match(await page.locator('#import-summary').textContent(),/新增 1 条，重复跳过 1 条/);
      for(const width of [390,320]){
        await page.setViewportSize({width,height:844});assert.ok(await page.locator('#inventory-transfer').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth}),'transfer modal fits mobile');
        await page.screenshot({path:path.join(root,'.screenshots','admin-transfer-'+width+'.png')});
      }
      await page.locator('#confirm-import').click();await page.locator('#inventory-transfer').waitFor({state:'hidden'});
      await search('prize','CSV奖品');assert.match(await page.locator('#config-list').textContent(),/测试导入.*CSV奖品.*50.*导入备注/);
      await page.locator('#open-import').click();assert.equal(await page.locator('#import-preview').isVisible(),false);
      const exportDownload=page.waitForEvent('download');await page.locator('#export-items').click();
      const exported=await exportDownload,exportText=fs.readFileSync(await exported.path(),'utf8'),items=Inventory.parseCSV(exportText.split('\r\n').slice(0,3).join('\r\n'));
      assert.ok(exportText.includes('CSV奖品')&&exportText.includes('新增礼品'),'export includes imported and newly added items');
      assert.equal(items.length,2,'export remains valid CSV');
      await page.locator('#close-import').click();
      await page.reload();await page.waitForFunction(()=>allDrinks.length>0);
      assert.equal(await page.locator('.layout').isVisible(),false,'admin view persists after reload');
      await page.evaluate(async()=>enterApp(await api('/api/demo',{method:'POST'})));
      assert.equal(await page.locator('.layout').isVisible(),true,'switching to demo restores games');
      assert.equal(await page.locator('#admin-config').isVisible(),false);assert.equal(await page.locator('#admin-draws').isVisible(),false);
      await page.evaluate(async()=>enterApp(await api('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'admin123'})})));
      assert.equal(await page.locator('.layout').isVisible(),false,'switching back restores management view');
      assert.deepEqual(errors,[]);
    }
  }finally{if(browser)await browser.close();if(db)db.close();server.kill()}
});
