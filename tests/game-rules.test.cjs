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
    ${['computeLayout','randomIndex','makeTicketCards','makeSlotSymbols'].map(source).join('\n')}
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
test('number and word tickets include exactly one winning prize; blank/retry never match', () => {
  for (const size of [1, 3, 23, 100]) {
    const run = rules(Array.from({ length: size }, (_, i) => 7 + i));
    for (const type of ['number', 'word']) {
      run(`const cards_${type}=makeTicketCards(drinks[0],'${type}')`);
      assert.equal(run(`cards_${type}.filter(c=>c.drink===drinks[0]).length`), 1);
      assert.equal(run(`new Set(cards_${type}.map(c=>c.label)).size`), Math.min(size, 6));
      assert.equal(run(`makeTicketCards(SPECIAL_PRIZES[0],'${type}').some(c=>c.label==='88'||c.label==='空')`), false);
    }
  }
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
