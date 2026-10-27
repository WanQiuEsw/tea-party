(function (root) {
  const headers = ['奖品名称', '品牌/来源', '参考价值', '备注'];
  function normalize(item) {
    if (!item || typeof item !== 'object') throw Error('奖品格式错误');
    const result = {};
    for (const [key, max] of [['brand', 30], ['name', 40], ['note', 100]]) {
      const value = item[key] ?? '';
      if (typeof value !== 'string' || value.trim().length > max) throw Error(`${key === 'name' ? '名称' : key === 'brand' ? '品牌/来源' : '备注'}需为文字且不超过 ${max} 字`);
      result[key] = value.trim();
    }
    if (!result.name) throw Error('请填写奖品名称');
    const price = typeof item.price === 'number' || typeof item.price === 'string' && item.price.trim() ? Number(item.price) : NaN;
    if (!Number.isFinite(price) || price < 0.01 || price > 1000000) throw Error('参考价值需在 ¥0.01—1,000,000 之间');
    result.price = Math.round(price * 100) / 100;
    return result;
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = [], field = '', quoted = false, closed = false;
    const push = () => { row.push(field); field = ''; closed = false; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else field += c;
      } else if (c === '"' && !field && !closed) quoted = true;
      else if (c === ',') push();
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        push(); if (row.some(v => v.trim())) rows.push(row); row = [];
      } else { if (closed || c === '"') throw Error('CSV 引号格式错误'); field += c; }
    }
    if (quoted) throw Error('CSV 引号未闭合');
    push(); if (row.some(v => v.trim())) rows.push(row);
    if (!rows.length) throw Error('文件为空');
    const keys = rows.shift().map(v => v.trim());
    if (keys.length !== 4 || !headers.every(h => keys.includes(h))) throw Error('表头应包含：' + headers.join('、'));
    if (!rows.length || rows.length > 100) throw Error('每次请导入 1—100 条奖品');
    return rows.map((r, i) => {
      if (r.length !== keys.length) throw Error(`第 ${i + 2} 条记录列数不正确`);
      const values = Object.fromEntries(keys.map((k, j) => [k, r[j].replace(/^'(?=['=+\-@\t\r])/, '')]));
      try { return normalize({ name: values[headers[0]], brand: values[headers[1]], price: values[headers[2]], note: values[headers[3]] }); }
      catch (err) { throw Error(`第 ${i + 2} 条记录：${err.message}`); }
    });
  }
  function toCSV(items) {
    // Prefix spreadsheet formulas; parseCSV removes only this export escape for round trips.
    const cell = value => '"' + String(value).replace(/^['=+\-@\t\r]/, c => "'" + c).replaceAll('"', '""') + '"';
    return '\uFEFF' + [headers, ...items.map(d => [d.name, d.brand, d.price, d.note])].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  const ALL_SHOPS = '__all_shops__';
  const teaCategories = ['咖啡', '奶茶', '果茶', '其他'];
  function teaCategory(item) {
    const name = item.name || '';
    // 按饮品名识别，咖啡店也有非咖啡；水果咖啡优先归咖啡。
    if (/咖啡|美式|澳白|卡布奇诺|摩卡|冷萃|浓缩|espresso|americano/i.test(name) || /拿铁/.test(name) && !/抹茶|红茶|乌龙|纯奶/.test(name)) return '咖啡';
    if (/冰淇淋|方砖|麻薯|固体/.test(name)) return '其他';
    if (/柠|柚|橙|橘|葡萄|青提|芭乐|桃|莓|芒|杨枝甘露|杨桃|苹果|杏子|油柑|青柑|番茄|黄皮|橄榄|酸角|冬枣|菠萝|水果|榴莲|余甘|木梨/.test(name)) return '果茶';
    if (/奶|乳|珍奶|可可|抹茶|豆浆|生酪/.test(name)) return '奶茶';
    return '其他';
  }
  function teaScope(items, brand) {
    return items.filter(d => !d.custom && (brand === ALL_SHOPS || d.brand === brand));
  }
  function teaSelection(items, brand, category) {
    return teaScope(items, brand).filter(d => !category || teaCategory(d) === category);
  }
  const api = { normalize, parseCSV, toCSV, ALL_SHOPS, teaCategories, teaCategory, teaScope, teaSelection };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Inventory = api;
})(globalThis);
