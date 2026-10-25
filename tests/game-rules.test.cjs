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
    ${['computeLayout','randomIndex','makeTicketCards','makeNumberTicket','makeSlotSymbols','checkScratch'].map(source).join('\n')}
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
test('word tickets include exactly one winning prize; blank/retry never match', () => {
  for (const size of [1, 3, 23, 100]) {
    const run = rules(Array.from({ length: size }, (_, i) => 7 + i));
    for (const type of ['word']) {
      run(`const cards_${type}=makeTicketCards(drinks[0],'${type}')`);
      assert.equal(run(`cards_${type}.filter(c=>c.drink===drinks[0]).length`), 1);
      assert.equal(run(`new Set(cards_${type}.map(c=>c.label)).size`), Math.min(size, 6));
      assert.equal(run(`makeTicketCards(SPECIAL_PRIZES[0],'${type}').some(c=>c.label==='88'||c.label==='空')`), false);
    }
  }
});
test('number tickets support 1–3 lucky numbers and multiple real prizes without false wins', () => {
  for (const size of [1, 3, 23, 100]) {
    const run=rules(Array.from({length:size},(_,i)=>7+i));
    run(`for(let i=0;i<100;i++){
      for(const count of [1,2,3])for(const result of [drinks[0],...SPECIAL_PRIZES]){
        const ticket=makeNumberTicket(result,count),matches=ticket.cards.filter(c=>ticket.lucky.includes(c.label));
        if(ticket.lucky.length!==count||new Set(ticket.lucky).size!==count)throw Error('invalid lucky numbers');
        if(ticket.cards.length!==15||new Set(ticket.cards.map(c=>c.label)).size!==15)throw Error('invalid number pool');
        if(!ticket.cards.every(c=>c.drink&&/^\\d{2}$/.test(c.label)))throw Error('missing prize');
        if(!ticket.cards.every(c=>c.winner===ticket.lucky.includes(c.label)))throw Error('incorrect winner');
        if(result.kind==='blank'&&matches.length!==0)throw Error('blank matched');
        if(result.kind==='retry'&&(matches.length!==1||matches[0].drink!==result))throw Error('retry duplicated');
        if(!result.kind&&(matches.length<1||matches.length>count||!matches.some(c=>c.drink===result)||matches.some(c=>c.drink.kind)))throw Error('wrong rewards');
      }
    }`);
    run('randomIndex=()=>0');
    for(const count of [1,2,3])assert.equal(run(`makeNumberTicket(drinks[0],${count}).cards.filter(c=>c.winner).length`),count);
  }
});

test('number cards wait for 90% scratched; other cards retain 40%', () => {
  const run=rules();
  run("let scratchType='number',ratio=.5,revealed=0;const scratchRatio=()=>ratio,setScratchProgress=()=>{},revealTicket=()=>revealed++");
  run('checkScratch()');assert.equal(run('revealed'),0);
  run('ratio=.89;checkScratch()');assert.equal(run('revealed'),0);
  run('ratio=.9;checkScratch()');assert.equal(run('revealed'),1);
  run("scratchType='word';ratio=.4;checkScratch()");assert.equal(run('revealed'),2);
});
test('slot win is three identical drinks; blank cannot accidentally match even with one drink', () => {
  for (const size of [1, 23]) {
    const run = rules(Array(size).fill(13));
    assert.equal(run('makeSlotSymbols(drinks[0]).every(d=>d===drinks[0])'), true);
    assert.equal(run('new Set(makeSlotSymbols(SPECIAL_PRIZES[0])).size'), 2);
    assert.equal(run('makeSlotSymbols(SPECIAL_PRIZES[1]).every(d=>d.kind==="retry")'), true);
  }
});
test('empty menu has no drawable outcomes', () => {
  const run = rules([]);
  assert.equal(run('layout.length'), 0);
  assert.equal(run('layoutTotal'), 0);
});
