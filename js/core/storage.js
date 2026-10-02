// Everything the player earns survives a reload: best times, daily streak, settings.
// localStorage is the only store here — no account, no server.

const KEY = 'nikoli.save.v1';

const shape = {
  settings: { sound: true, reduceMotion: false },
  records: {},   // "nonogram:10" → { bestMs, bestMoves, solves, noHintSolves }
  daily: {},     // "2026-09-27" → { nonogram: true, ... }
  stats: { solves: 0, noHint: 0, hints: 0 },
  streak: { day: '', count: 0, best: 0 },
};

let cache = null;

// The disk and the import box are both player-editable, so nothing read back is trusted to be
// an object: `{"records":7}` used to pass the import guard and then crash the win handler with
// "Cannot create property 'nonogram:5' on number '7'" — on every reload, because the bad save
// was still what read() picked up.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const objOr = (v, fallback) => (isObj(v) ? v : fallback);
const boolOr = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
// 计数与纪录只有"非负有限数"这一种合法形状。字符串、负数、Infinity、NaN 一律回 0：
// 留着它们，下一次 `prev.solves + 1` 就写成 NaN，然后整张结算面板跟着谎。
const countOr = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const strOr = (v) => (typeof v === 'string' ? v : '');

function blank() {
  return {
    settings: { ...shape.settings },
    records: {},
    daily: {},
    stats: { ...shape.stats },
    streak: { ...shape.streak },
  };
}

function normalize(p) {
  const records = {};
  for (const [id, v] of Object.entries(objOr(p.records, {}))) {
    if (!isObj(v)) continue;   // 一条记录写成 7 / "x" / null：丢掉这一条，别丢整张表
    records[id] = { bestMs: countOr(v.bestMs), bestMoves: countOr(v.bestMoves), solves: countOr(v.solves), noHintSolves: countOr(v.noHintSolves) };
  }
  const daily = {};
  for (const [day, v] of Object.entries(objOr(p.daily, {}))) {
    if (!isObj(v)) continue;   // markDaily 要往这一行上写属性，非对象会在点每日挑战时当场抛
    const row = {};
    for (const [mode, done] of Object.entries(v)) if (done) row[mode] = true;
    if (Object.keys(row).length) daily[day] = row;
  }
  const st = objOr(p.stats, {});
  const sk = objOr(p.streak, {});
  const se = objOr(p.settings, {});
  return {
    settings: {
      sound: boolOr(se.sound, shape.settings.sound),
      reduceMotion: boolOr(se.reduceMotion, shape.settings.reduceMotion),
    },
    records,
    daily,
    stats: { solves: countOr(st.solves), noHint: countOr(st.noHint), hints: countOr(st.hints) },
    streak: { day: strOr(sk.day), count: countOr(sk.count), best: countOr(sk.best) },
  };
}

function read() {
  if (cache) return cache;
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { raw = null; }
  if (raw) {
    try {
      cache = normalize(JSON.parse(raw));
      return cache;
    } catch { /* corrupt or written by a newer build — start clean */ }
  }
  cache = blank();
  return cache;
}

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(read())); } catch { /* private mode: play on, nothing persists */ }
}

// A streak is consecutive calendar days with at least one daily solved, so the
// boundary test is "the day before this one", not "24 hours ago".
function dayBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export const store = {
  get settings() { return read().settings; },
  set(key, value) {
    read().settings[key] = value;
    write();
  },
  record(id) { return read().records[id] || null; },
  totalSolves() { return read().stats.solves; },
  statsObj() { return { ...read().stats }; },
  // A streak is alive if it was extended today or yesterday — the counter has not
  // silently died at midnight.
  streak(day = '') {
    const s = read().streak;
    return { ...s, alive: !!s.day && (s.day === day || s.day === dayBefore(day)) };
  },
  // Returns the new streak length when this completion started a new day's entry.
  markDaily(day, mode) {
    const db = read().daily;
    const had = db[day] || (db[day] = {});
    const fresh = !Object.keys(had).length;
    had[mode] = true;
    let bumped = 0;
    if (fresh) {
      const s = read().streak;
      s.count = s.day === dayBefore(day) ? s.count + 1 : 1;
      s.day = day;
      s.best = Math.max(s.best, s.count);
      bumped = s.count;
    }
    write();
    return bumped;
  },
  dailyDone(day) { return { ...(read().daily[day] || {}) }; },
  finish(id, { ms, moves, hints = 0 }) {
    const db = read().records;
    const prev = db[id] || { bestMs: 0, bestMoves: 0, solves: 0, noHintSolves: 0 };
    const cur = {
      solves: prev.solves + 1,
      noHintSolves: prev.noHintSolves + (hints ? 0 : 1),
      bestMs: !prev.bestMs || ms < prev.bestMs ? ms : prev.bestMs,
      bestMoves: !prev.bestMoves || moves < prev.bestMoves ? moves : prev.bestMoves,
    };
    db[id] = cur;
    const st = read().stats;
    st.solves += 1;
    st.hints += hints;
    if (!hints) st.noHint += 1;
    write();
    return cur;
  },
  exportText() { return JSON.stringify(read()); },
  importText(text) {
    const p = JSON.parse(text);
    // 导入是玩家主动做的事，认不出脸就拒（读盘反过来：能救的一律救）
    if (!isObj(p) || !isObj(p.records)) throw new Error('not a nikoli save');
    cache = normalize(p);
    write();
  },
  reset() { cache = blank(); write(); },
};
