const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fortune = require('../fortune.js');

test('all 80 source captions are preserved verbatim with the correct brand restrictions', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../docs/奶茶朋友圈文案_80条_20261026.md'), 'utf8');
  const rows = [...source.matchAll(/^(\d+)\. (.+)$/gm)].map(([, number, text]) => [Number(number), text.trimEnd()]);
  assert.deepEqual(rows.map(([number]) => number), Array.from({ length: 80 }, (_, i) => i + 1));
  assert.deepEqual(Fortune.entries.map(e => e[1]).sort(), rows.map(([, text]) => text).sort());
  assert.deepEqual(Fortune.entries.slice(0, 66).map(e => e[1]), rows.filter(([n]) => n < 43 || n > 56).map(([, text]) => text));
  const brands = {
    '蜜雪冰城': [43, 55], '瑞幸': [44], '茶百道': [45, 56], '霸王茶姬': [46],
    '沪上阿姨': [47], '益禾堂': [48], '书亦烧仙草': [49], '喜茶': [50, 51],
    '一点点': [52], '古茗': [53], '茉莉奶白': [54]
  };
  assert.deepEqual(Object.keys(Fortune.brandEntries).sort(), Object.keys(brands).sort());
  for (const [brand, numbers] of Object.entries(brands)) {
    assert.deepEqual(Fortune.brandEntries[brand].map(e => e[1]), numbers.map(n => rows[n - 1][1]));
  }
});

test('80 latest captions only; generic cycles have no repeats, including their boundary', () => {
  assert.equal(Fortune.entries.length, 80);
  assert.equal(new Set(Fortune.entries.map(e => e[0])).size, Fortune.entries.length);
  assert.equal(new Set(Fortune.entries.map(e => e[1])).size, Fortune.entries.length);
  assert.ok(Fortune.entries.every(e => e.length === 2 && e.every(Boolean)));
  let state = {}, last;
  for (let round = 0; round < 3; round++) {
    const seen = new Set();
    for (let i = 0; i < 66; i++) {
      state = Fortune.next(state, () => round === 0 ? 0 : round === 1 ? 0.999999 : Math.random());
      assert.notEqual(state.id, last);
      assert.ok(state.id < 66, 'no brand caption without a matching brand');
      assert.ok(!seen.has(state.id));
      seen.add(state.id);
      last = state.id;
      state = JSON.parse(JSON.stringify(state));
    }
    assert.equal(seen.size, 66);
    assert.equal(state.remaining.length, 0);
  }
});

test('each brand cycles through generic and matching captions only', () => {
  for (const [brand, copies] of Object.entries(Fortune.brandEntries)) {
    const expected = new Set([...Fortune.entries.slice(0, 66), ...copies].map(e => e[1]));
    let state = {}, last;
    for (let round = 0; round < 2; round++) {
      const seen = new Set();
      for (let i = 0; i < expected.size; i++) {
        state = Fortune.next(state, () => 0.999999, brand);
        const text = Fortune.entries[state.id][1];
        assert.ok(expected.has(text), brand + ' must not receive another brand’s caption');
        assert.ok(!seen.has(text));
        assert.notEqual(state.id, last);
        seen.add(text);
        last = state.id;
      }
      assert.deepEqual(seen, expected);
    }
  }
});

test('brand changes immediately discard ineligible captions; matching is exact', () => {
  let state = Fortune.next({}, () => 0.999999, '蜜雪冰城');
  assert.ok(Fortune.brandEntries['蜜雪冰城'].includes(Fortune.entries[state.id]));
  for (const brand of ['喜茶', '蜜雪冰城', '古茗', '活动礼品', '', '蜜雪冰城联名礼品', '蜜雪', 'constructor', '__proto__']) {
    state = Fortune.next(state, () => 0.999999, brand);
    const copies = Object.hasOwn(Fortune.brandEntries, brand) ? Fortune.brandEntries[brand] : [];
    assert.ok([...Fortune.entries.slice(0, 66), ...copies].includes(Fortune.entries[state.id]));
  }
  state = Fortune.next(state, () => 0.999999, ' 蜜雪冰城 ');
  assert.ok(Fortune.brandEntries['蜜雪冰城'].includes(Fortune.entries[state.id]));
  assert.ok(Fortune.brandEntries['蜜雪冰城'].some(e => e[1] === '最近爱上一座城，叫蜜雪冰城。'));
});

test('result dialog has no prize notes or social caption controls', () => {
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  for(const id of ['notes','share-note','share-text','copy-share'])assert.ok(!html.includes('id="'+id+'"'));
  assert.ok(!html.includes('Fortune.next'));
});
