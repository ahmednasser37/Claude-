// xer-parser.js — pure text -> tables. No DOM, no imports.
//
// XER grammar (verified against P6 exports):
//   ERMHDR\t<version>\t<date>\t...          one informational header line
//   %T\t<TableName>                          starts a table block
//   %F\t<f1>\t<f2>\t...                      field names for the rows that follow
//   %R\t<v1>\t<v2>\t...                      one row
//   %E                                       end of file marker (optional)
//
// A logical table may be split across multiple %T blocks with the same name:
// rows are APPENDED to the existing array, never overwritten.

export function parseXER(text) {
  const tables = {};
  let header = null;
  let cur = null;
  let fields = null;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const cells = line.split('\t');
    switch (cells[0]) {
      case 'ERMHDR':
        header = { version: cells[1], exportDate: cells[2], raw: cells.slice(1) };
        break;
      case '%T': {
        const name = cells[1];
        if (!tables[name]) tables[name] = [];
        cur = tables[name];       // append on repeat blocks, never reassign
        fields = null;
        break;
      }
      case '%F':
        fields = cells.slice(1);
        break;
      case '%R': {
        if (!cur || !fields) break;
        const row = {};
        for (let i = 0; i < fields.length; i++) {
          const v = cells[i + 1];
          // trailing empty cells are common: short row => undefined, not ''
          row[fields[i]] = v === undefined || v === '' ? undefined : v;
        }
        cur.push(row);
        break;
      }
      case '%E':
        cur = null;
        fields = null;
        break;
    }
  }
  return { tables, header };
}

// Numeric coercion contract: NaN / empty / absent => undefined, never 0.
// Zero is a valid value; "field absent" is a different thing.
export function num(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}
