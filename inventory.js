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
  const api = { normalize, parseCSV, toCSV };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Inventory = api;
})(globalThis);
