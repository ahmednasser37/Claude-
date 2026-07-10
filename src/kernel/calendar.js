// calendar.js — P6 clndr_data parsing + working-day math. Pure, no DOM.
//
// All date math is UTC-based. P6 date strings ('YYYY-MM-DD HH:MM') are parsed
// with Date.UTC and read back with getUTC* only — never bare new Date(str),
// which the JS spec parses as UTC midnight and local getters then shift by a
// day anywhere west of UTC.

export const DAY_MS = 86400000;
// Lotus/Excel serial epoch, confirmed by decoding real P6 exception serials.
export const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function parseP6Date(s) {
  if (s === undefined || s === null || s === '') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export function serialToUTC(serial) {
  return SERIAL_EPOCH_MS + serial * DAY_MS;
}

export function dayFloor(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(ms) {
  if (ms === undefined || ms === null) return 'N/A';
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---- clndr_data recursive-descent parser -----------------------------------
// Grammar (fixed): node = '(' index '||' NAME '(' args ')' '(' children* ')' ')'
// args never contain parentheses; children are nodes.

export function parseClndrTree(s, i = 0) {
  while (i < s.length && s[i] !== '(') i++;
  if (i >= s.length) return null;
  i++; // consume '('
  let j = s.indexOf('||', i);
  if (j === -1) return null;
  i = j + 2;
  j = s.indexOf('(', i);
  const name = s.slice(i, j).trim();
  i = j + 1;
  j = s.indexOf(')', i); // args contain no parens in this grammar
  const args = s.slice(i, j);
  i = j + 1;
  while (i < s.length && /\s/.test(s[i])) i++;
  const children = [];
  if (s[i] === '(') {
    i++;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      if (s[i] === ')') { i++; break; }
      const r = parseClndrTree(s, i);
      if (!r) break;
      children.push(r.node);
      i = r.pos;
    }
  }
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] === ')') i++;
  return { node: { name, args, children }, pos: i };
}

function shiftHours(args) {
  // args like 's|08:00|f|16:00' — possibly multiple s/f pairs
  const parts = args.split('|');
  const shifts = [];
  for (let k = 0; k < parts.length - 3; k++) {
    if (parts[k] === 's' && parts[k + 2] === 'f') {
      shifts.push({ s: parts[k + 1], f: parts[k + 3] });
      k += 3;
    }
  }
  return shifts;
}

function hhmmToHours(t) {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

export function shiftsToHours(shifts) {
  let hrs = 0;
  for (const sh of shifts) {
    const d = hhmmToHours(sh.f) - hhmmToHours(sh.s);
    if (d > 0) hrs += d;
  }
  return hrs;
}

// parseClndrData(str) -> { week: {1..7: shifts[]}, exceptions: Map(dayMs -> shifts[]) }
// P6 weekday numbering: 1 = Sunday ... 7 = Saturday (jsDate.getUTCDay() + 1).
export function parseClndrData(str) {
  const week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  const exceptions = new Map();
  if (!str) return { week, exceptions };
  const root = parseClndrTree(str);
  if (!root) return { week, exceptions };
  const walk = (node) => {
    if (node.name === 'DaysOfWeek') {
      for (const day of node.children) {
        const n = parseInt(day.name, 10);
        if (n >= 1 && n <= 7) {
          const shifts = [];
          for (const sh of day.children) shifts.push(...shiftHours(sh.args));
          week[n] = shifts;
        }
      }
      return;
    }
    if (node.name === 'Exceptions') {
      for (const ex of node.children) {
        const m = /d\|(\d+)/.exec(ex.args);
        if (!m) continue;
        const dayMs = serialToUTC(parseInt(m[1], 10));
        const shifts = [];
        for (const sh of ex.children) shifts.push(...shiftHours(sh.args));
        exceptions.set(dayMs, shifts); // empty shifts = full holiday
      }
      return;
    }
    for (const c of node.children) walk(c);
  };
  walk(root.node);
  return { week, exceptions };
}

// ---- Calendar object --------------------------------------------------------

export function makeCalendar(row) {
  const data = parseClndrData(row.clndr_data);
  const dayHrs = row.day_hr_cnt !== undefined ? parseFloat(row.day_hr_cnt) : 8;
  return {
    id: row.clndr_id,
    name: row.clndr_name || `Calendar ${row.clndr_id}`,
    dayHrs: Number.isNaN(dayHrs) ? 8 : dayHrs,
    week: data.week,
    exceptions: data.exceptions,
    _hoursCache: new Map(),
  };
}

// Documented fallback when a clndr_id doesn't resolve: Mon–Fri, 8h days.
export function defaultCalendar() {
  const week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const d of [2, 3, 4, 5, 6]) week[d] = [{ s: '08:00', f: '16:00' }]; // Mon..Fri
  return {
    id: '__default', name: 'Default (Mon–Fri 8h — fallback)', dayHrs: 8,
    week, exceptions: new Map(), _hoursCache: new Map(),
  };
}

export function hoursOnDay(cal, dayMs) {
  dayMs = dayFloor(dayMs);
  const cached = cal._hoursCache.get(dayMs);
  if (cached !== undefined) return cached;
  let hrs;
  if (cal.exceptions.has(dayMs)) {
    hrs = shiftsToHours(cal.exceptions.get(dayMs));
  } else {
    const p6Day = new Date(dayMs).getUTCDay() + 1; // 1=Sun..7=Sat
    hrs = shiftsToHours(cal.week[p6Day] || []);
  }
  cal._hoursCache.set(dayMs, hrs);
  return hrs;
}

export function isWorkingDay(cal, dayMs) {
  return hoursOnDay(cal, dayMs) > 0;
}

// Count working days in the half-open range [startMs, endMs).
export function workingDaysBetween(cal, startMs, endMs) {
  if (startMs === undefined || endMs === undefined) return undefined;
  let a = dayFloor(startMs), b = dayFloor(endMs), sign = 1;
  if (a > b) { [a, b] = [b, a]; sign = -1; }
  let n = 0;
  for (let d = a; d < b; d += DAY_MS) if (isWorkingDay(cal, d)) n++;
  return n * sign;
}

// Inclusive working-day duration of a date span (start and end both counted).
export function workingDaySpan(cal, startMs, endMs) {
  const n = workingDaysBetween(cal, startMs, endMs + DAY_MS);
  return n === undefined ? undefined : Math.max(n, 0);
}

// Date reached after advancing n working days from startMs (n=0 -> first
// working day at or after start; n=1 -> the next working day after that).
export function addWorkingDays(cal, startMs, n) {
  let d = dayFloor(startMs);
  let guard = 0;
  while (!isWorkingDay(cal, d)) { d += DAY_MS; if (++guard > 3660) return d; }
  let left = n;
  guard = 0;
  while (left > 0) {
    d += DAY_MS;
    if (isWorkingDay(cal, d)) left--;
    if (++guard > 36600) break;
  }
  return d;
}

// ---- Period bucketing --------------------------------------------------------

export function periodKey(ms, gran) {
  const d = new Date(dayFloor(ms));
  if (gran === 'week') {
    // Week anchored on Sunday (matches the Sun–Thu site calendars this tool
    // most often sees; purely a display bucket, not schedule logic).
    const start = dayFloor(ms) - d.getUTCDay() * DAY_MS;
    const s = new Date(start);
    return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodStart(key, gran) {
  if (gran === 'week') {
    const [y, m, dd] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  }
  const [y, m] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, 1);
}

// Spread `amount` across [startMs, endMs] (inclusive) proportionally to each
// working day's hours, bucketed by period. If the span has no working days,
// the whole amount lands in the start's period (a real zero-duration event).
export function spreadAcrossPeriods(cal, startMs, endMs, amount, gran, into = new Map()) {
  if (startMs === undefined || endMs === undefined || amount === undefined) return into;
  const a = dayFloor(Math.min(startMs, endMs));
  const b = dayFloor(Math.max(startMs, endMs));
  let totalHrs = 0;
  for (let d = a; d <= b; d += DAY_MS) totalHrs += hoursOnDay(cal, d);
  if (totalHrs === 0) {
    const k = periodKey(a, gran);
    into.set(k, (into.get(k) || 0) + amount);
    return into;
  }
  for (let d = a; d <= b; d += DAY_MS) {
    const h = hoursOnDay(cal, d);
    if (h === 0) continue;
    const k = periodKey(d, gran);
    into.set(k, (into.get(k) || 0) + amount * (h / totalHrs));
  }
  return into;
}
