const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Inventory=require('../inventory');
const catalog=require('../catalog.json').map((d,i)=>({...d,id:i+1}));

test('drink categories distinguish fruit coffee, milk drinks, fruit tea and other options',()=>{
  for(const [name,expected] of [['葡萄冰美式','咖啡'],['猫山王榴莲拿铁','咖啡'],['抹茶拿铁','奶茶'],['黑糖珍珠鲜牛乳','奶茶'],['茉莉奶绿','奶茶'],['抹茶芝士芭乐','果茶'],['杨枝甘露','果茶'],['茉莉绿茶','其他'],['固体杨枝甘露','其他'],['未知新品','其他']]) {
    assert.equal(Inventory.teaCategory({name,brand:'咖啡店'}),expected,name);
  }
  const groups=Inventory.teaCategories.flatMap(c=>Inventory.teaSelection(catalog,Inventory.ALL_SHOPS,c));
  assert.equal(groups.length,catalog.length);
  assert.equal(new Set(groups.map(d=>d.id)).size,catalog.length);
});

test('all-shop and individual-shop bulk selection excludes private custom options',()=>{
  const items=[...catalog,{id:-1,brand:'古茗',name:'我的拿铁',custom:true}];
  assert.equal(Inventory.teaScope(items,Inventory.ALL_SHOPS).length,catalog.length);
  assert.ok(Inventory.teaSelection(items,'古茗','咖啡').length>0);
  assert.ok(Inventory.teaSelection(items,'古茗','咖啡').every(d=>d.brand==='古茗'&&d.id>0));
  assert.deepEqual(Inventory.teaSelection(items,'不存在的店铺','咖啡'),[]);
});

test('category buttons replace the draft selection, reflect selection and allow restoring all',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  const elements=new Map();
  const element=()=>({attributes:{},value:'',setAttribute(k,v){this.attributes[k]=v},replaceChildren(...children){this.children=children}});
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
  const context=vm.createContext({Inventory,document:{createElement:element},$,allDrinks:catalog,draftBrand:Inventory.ALL_SHOPS,draftListId:undefined,draftExcluded:new Set(),menuTab:'available',scopeDrinks:brand=>Inventory.teaScope(catalog,brand),shopLabel:brand=>brand===Inventory.ALL_SHOPS?'全部店铺':brand});
  const source=script.slice(script.indexOf('function renderTeaCategories(){'),script.indexOf('function renderPersonalMenu(){'));
  vm.runInContext(source+'\nfunction renderPersonalMenu(){renderTeaCategories()}',context);
  vm.runInContext('renderTeaCategories()',context);
  $('tea-categories').children[1].onclick();
  assert.equal(context.menuTab,'included');
  assert.deepEqual(catalog.filter(d=>!context.draftExcluded.has(d.id)),Inventory.teaSelection(catalog,Inventory.ALL_SHOPS,'咖啡'));
  assert.equal($('tea-categories').children[1].attributes['aria-pressed'],'true');
  $('tea-categories').children[3].onclick();
  assert.deepEqual(catalog.filter(d=>!context.draftExcluded.has(d.id)),Inventory.teaSelection(catalog,Inventory.ALL_SHOPS,'果茶'));
  $('tea-categories').children[0].onclick();
  assert.equal(context.draftExcluded.size,0);
  context.draftBrand='瑞幸咖啡';vm.runInContext('renderTeaCategories()',context);
  assert.equal($('tea-categories').children[3].disabled,true);
  context.draftListId=1;vm.runInContext('renderTeaCategories()',context);
  assert.equal($('tea-categories').hidden,true);
});

test('saved all-shop category survives reload and edits stay private until saved',async()=>{
  const script=fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const coffeeIds=new Set(Inventory.teaSelection(catalog,Inventory.ALL_SHOPS,'咖啡').map(d=>d.id));
  const context=vm.createContext({structuredClone,allDrinks:catalog,ALL_SHOPS:Inventory.ALL_SHOPS,localState:{brand:'古茗',menus:[],selectedId:null,lists:[],options:[]}});
  vm.runInContext('function persistLocal(next){localState=next}',context);
  vm.runInContext(script.slice(script.indexOf('async function localApi('),script.indexOf('async function api(')),context);
  const excludedIds=catalog.filter(d=>!coffeeIds.has(d.id)).map(d=>d.id);
  await context.localApi('/api/menu',{method:'PUT',body:JSON.stringify({brand:Inventory.ALL_SHOPS,excludedIds})});
  // Exercise the actual startup restoration and shared draw-pool expression.
  vm.runInContext(script.match(/selectedBrand=localState.brand===ALL_SHOPS[^;]+;/)[0],context);
  assert.equal(context.selectedBrand,Inventory.ALL_SHOPS);
  const saved=new Set(context.localState.menus[0].excludedIds);
  assert.deepEqual(Inventory.teaScope(catalog,context.selectedBrand).filter(d=>!saved.has(d.id)).map(d=>d.id),[...coffeeIds]);
  const draft=new Set(saved);draft.clear();
  assert.equal(context.localState.menus[0].excludedIds.length,excludedIds.length);
  await context.localApi('/api/menu',{method:'PUT',body:JSON.stringify({brand:'古茗',excludedIds:[]})});
  assert.equal(context.localState.menus.length,2);
  assert.deepEqual([...context.localState.menus.find(m=>m.brand===Inventory.ALL_SHOPS).excludedIds],excludedIds);
});
