const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start > 0, name);
  let depth = 0, opened = false;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') { depth++; opened = true; }
    if (html[i] === '}' && --depth === 0 && opened) return html.slice(start, i + 1);
    if (html[i] !== '}') continue;
  }
  throw new Error(name);
}
// Read the real page's functions and constants so the test follows production rules.
function rules(prices = [7.3, 12, 20]) {
  let seed = 17;
  const context = vm.createContext({ crypto: { getRandomValues(a) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; a[0] = seed; } } });
  vm.runInContext(`${html.match(/const PRICE_POWER=[^\n]+/)[0]}
    ${html.match(/const SPECIAL_PRIZES=[^\n]+/)[0]}
    const drinks=${JSON.stringify(prices.map((price, i) => ({ id: i + 1, brand: '测试', name: '饮品' + i, price })))};
    let layout=[],layoutTotal=0;const tau=Math.PI*2;const priceOf=d=>d.price;
    ${['computeLayout','randomIndex','makeNumberTicket','slotResult','slotProbability','checkScratch'].map(source).join('\n')}
    computeLayout();`, context);
  return expression => vm.runInContext(expression, context);
}
test('probabilities sum to 100%, with 20% blank, 3% retry and inverse-price drinks', () => {
  const run = rules();
  assert.ok(Math.abs(run('layout.reduce((s,x)=>s+x.prob,0)') - 1) < 1e-12);
  assert.equal(run('layout.find(x=>x.drink.kind==="blank").prob'), .2);
  assert.equal(run('layout.find(x=>x.drink.kind==="retry").prob'), .03);
  assert.ok(Math.abs(run('layout[0].prob/layout[2].prob') - 20 / 7.3) < 1e-12);
  run('const counts=Array(layout.length).fill(0);for(let i=0;i<100000;i++)counts[randomIndex()]++');
  assert.equal(run('counts.reduce((a,b)=>a+b,0)'), 100000);
  assert.ok(run('counts.every((n,i)=>Math.abs(n/100000-layout[i].prob)<.006)'));
});
test('one lucky number matches at any of 15 positions, while blank tickets never match', () => {
  for (const size of [1,3,23,100]) {
    const run=rules(Array.from({length:size},(_,i)=>7+i));
    run(`const positions=new Set();for(let i=0;i<500;i++)for(const result of [drinks[0],...SPECIAL_PRIZES]){
      const ticket=makeNumberTicket(result),matches=ticket.cards.filter(c=>ticket.lucky.includes(c.label));
      if(ticket.lucky.length!==1)throw Error('expected one lucky number');
      if(ticket.cards.length!==15||new Set(ticket.cards.map(c=>c.label)).size!==15)throw Error('invalid number pool');
      if(!ticket.cards.every(c=>c.drink&&/^\\d{2}$/.test(c.label)))throw Error('missing prize');
      if(!ticket.cards.every(c=>c.winner===ticket.lucky.includes(c.label)))throw Error('incorrect winner');
      let offset=0;
      for(let count=1;count<=5;count++){
        const row=ticket.cards.slice(offset,offset+count);
        if(!row.every(c=>c.drink===row[0].drink)||row[0].drink.kind==='blank')throw Error('invalid shared row prize');
        offset+=count;
      }
      if(result.kind==='blank'&&matches.length!==0)throw Error('blank matched');
      if(result.kind!=='blank'){
        if(matches.length!==1||matches[0].drink!==result)throw Error('incorrect reward');
        positions.add(ticket.cards.findIndex(c=>c.winner));
      }
    }`);
    assert.equal(run('positions.size'),15);
  }
});

test('number cards wait for 90% scratched; other cards retain 40%', () => {
  const run=rules();
  run("let scratchType='number',ratio=.5,revealed=0;const scratchRatio=()=>ratio,setScratchProgress=()=>{},revealTicket=()=>revealed++");
  run('checkScratch()');assert.equal(run('revealed'),0);
  run('ratio=.89;checkScratch()');assert.equal(run('revealed'),0);
  run('ratio=.9;checkScratch()');assert.equal(run('revealed'),1);
  run("scratchType='classic';ratio=.4;checkScratch()");assert.equal(run('revealed'),2);
});
test('shake only awards three identical prize IDs; mixed results and blanks lose', () => {
  const run=rules();
  assert.equal(run('slotResult([drinks[0],drinks[0],drinks[0]])===drinks[0]'),true);
  for(const symbols of ['[drinks[0],drinks[1],drinks[0]]','[drinks[0],drinks[0],drinks[1]]','[drinks[0],drinks[1],SPECIAL_PRIZES[0]]','Array(3).fill(SPECIAL_PRIZES[0])','[drinks[0],SPECIAL_PRIZES[1],drinks[0]]','[drinks[0],{...drinks[0],id:99},drinks[0]]'])assert.equal(run(`slotResult(${symbols}).kind`),'blank');
  assert.equal(run('slotResult(Array(3).fill(SPECIAL_PRIZES[1])).kind'),'retry');
  const single=rules([13]);
  assert.equal(single('slotResult([drinks[0],SPECIAL_PRIZES[0],drinks[0]]).kind'),'blank');
});
test('shake final odds use cubes; independent reel simulation agrees with disclosure', () => {
  const run=rules(Array(23).fill(13));
  assert.ok(Math.abs(run('slotProbability(drinks[0])-layout[0].prob**3'))<1e-12);
  assert.ok(Math.abs(run('layout.reduce((s,x)=>s+slotProbability(x.drink),0)')-1)<1e-12);
  run(`let wins=0,retries=0;for(let i=0;i<100000;i++){
    const result=slotResult(Array.from({length:3},()=>layout[randomIndex()].drink));
    if(!result.kind)wins++;if(result.kind==='retry')retries++;
  }`);
  assert.ok(Math.abs(run('wins/100000-layout.filter(s=>!s.drink.kind).reduce((n,s)=>n+s.prob**3,0)'))<.0004);
  assert.ok(Math.abs(run('retries/100000-.03**3'))<.0001);
});
test('empty menu has no drawable outcomes', () => {
  const run = rules([]);
  assert.equal(run('layout.length'), 0);
  assert.equal(run('layoutTotal'), 0);
});
