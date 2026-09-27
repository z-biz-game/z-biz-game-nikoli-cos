// 数织 / Nonogram —— 行与列的连段长度唯一地决定图形。
//
// 一个求解器同时负三责：
//   · 判胜负   —— 题面本身就是判据，不需要藏答案
//   · 出提示   —— 给人"下一步推得出的格"，而不是偷看答案
//   · 生成期筛 —— 只有纯逻辑可解的题面才会被放出来，唯一解是这个约束的副产品
//
// 题面：小盘面用手工像素图形（通关那一下"啊，是爱心"是本玩法的爽点），
// 大盘面用镜像 blob 程序生成后过求解器。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, inkCell, crossMark, label, roundRect, rgba, easeOut, pulse, paper } from '../core/paper.js';

export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = -1;

const ENUM_CAP = 4000;

export function normalizeClues(clues) {
  return clues.length === 1 && clues[0] === 0 ? [] : clues;
}

export function cluesFromLine(line) {
  const out = [];
  let c = 0;
  // 只认 FILLED：EMPTY 是 -1，写成 `if (v)` 会把叉当成黑格。
  for (const v of line) {
    if (v > 0) c++;
    else if (c) { out.push(c); c = 0; }
  }
  if (c) out.push(c);
  return normalizeClues(out);
}

const clueKey = (c) => normalizeClues(c).join(',');
const sum = (a) => a.reduce((x, y) => x + y, 0);

// 所有与 known 相容的摆放。truncated 表示枚举被上限截断，
// 此时"所有摆放都不含此格"不再等于"此格必空"，调用方必须放弃推断。
export function arrangements(n, clues, known, cap = ENUM_CAP) {
  const list = [];
  const cl = normalizeClues(clues);
  if (!cl.length) {
    for (let i = 0; i < n; i++) if (known[i] === FILLED) return { list, truncated: false };
    return { list: [new Uint8Array(n)], truncated: false };
  }
  const need = new Array(cl.length + 1).fill(0);
  for (let i = cl.length - 1; i >= 0; i--) need[i] = need[i + 1] + cl[i] + (i === cl.length - 1 ? 0 : 1);
  if (need[0] > n) return { list, truncated: false };

  const res = new Uint8Array(n);
  let truncated = false;

  const fits = () => {
    for (let i = 0; i < n; i++) {
      if (known[i] === FILLED && !res[i]) return false;
      if (known[i] === EMPTY && res[i]) return false;
    }
    return true;
  };

  const rec = (ci, pos) => {
    if (truncated) return;
    if (ci === cl.length) {
      if (!fits()) return;
      if (list.length >= cap) { truncated = true; return; }
      list.push(res.slice());
      return;
    }
    const len = cl[ci];
    for (let s = pos; s <= n - need[ci]; s++) {
      if (s > 0 && known[s - 1] === FILLED) continue;   // 块前必须留白
      let bad = false;
      for (let k = s; k < s + len; k++) if (known[k] === EMPTY) { bad = true; break; }
      if (bad) continue;
      for (let k = s; k < s + len; k++) res[k] = FILLED;
      rec(ci + 1, s + len + 1);
      for (let k = s; k < s + len; k++) res[k] = 0;
      if (truncated) return;
    }
  };
  rec(0, 0);
  return { list, truncated };
}

// 交集：所有摆放都涂的格必涂，所有摆放都不涂的格必空。
export function deduceLine(n, clues, known) {
  const { list, truncated } = arrangements(n, clues, known);
  if (truncated) return { contradiction: false, filled: [], empty: [], count: -1 };
  if (!list.length) return { contradiction: true, filled: [], empty: [], count: 0 };
  const filled = [];
  const empty = [];
  for (let i = 0; i < n; i++) {
    if (known[i] !== UNKNOWN) continue;
    let all = true;
    let none = true;
    for (const a of list) {
      if (a[i]) none = false; else all = false;
      if (!all && !none) break;
    }
    if (all) filled.push(i);
    else if (none) empty.push(i);
  }
  return { contradiction: false, filled, empty, count: list.length };
}

const readRow = (g, w, y) => g.subarray(y * w, y * w + w);
function readCol(g, w, h, x) {
  const out = new Int8Array(h);
  for (let y = 0; y < h; y++) out[y] = g[y * w + x];
  return out;
}

// 反复扫行扫列到不动点。depth 记录途中最难的一条线有多少种摆法，
// 用来给题面定难度；maxDepth 让生成器可以要求"只用简单推理就能推到底"。
export function logicSolve(grid, w, h, rowClues, colClues, opts = {}) {
  const g = Int8Array.from(grid);
  const maxDepth = opts.maxDepth || Infinity;
  let depth = 0;
  let passes = 0;
  let changed = true;

  while (changed) {
    changed = false;
    if (++passes > 300) break;
    for (let y = 0; y < h; y++) {
      const d = deduceLine(w, rowClues[y], readRow(g, w, y));
      if (d.contradiction) return { grid: g, solved: false, contradiction: true, depth, passes };
      if (d.count > depth) depth = d.count;
      if (d.count > maxDepth) continue;
      for (const i of d.filled) { g[y * w + i] = FILLED; changed = true; }
      for (const i of d.empty) { g[y * w + i] = EMPTY; changed = true; }
    }
    for (let x = 0; x < w; x++) {
      const d = deduceLine(h, colClues[x], readCol(g, w, h, x));
      if (d.contradiction) return { grid: g, solved: false, contradiction: true, depth, passes };
      if (d.count > depth) depth = d.count;
      if (d.count > maxDepth) continue;
      for (const i of d.filled) { g[i * w + x] = FILLED; changed = true; }
      for (const i of d.empty) { g[i * w + x] = EMPTY; changed = true; }
    }
  }
  for (let i = 0; i < g.length; i++) if (g[i] === UNKNOWN) return { grid: g, solved: false, contradiction: false, depth, passes };
  return { grid: g, solved: true, contradiction: false, depth, passes };
}

// ---- 题面 -----------------------------------------------------------------------

export function pictureToSpec(pic) {
  const h = pic.length;
  const w = pic[0].length;
  const rowClues = pic.map((row) => cluesFromLine([...row].map((c) => (c === '#' ? 1 : 0))));
  const colClues = [];
  for (let x = 0; x < w; x++) {
    const col = new Array(h);
    for (let y = 0; y < h; y++) col[y] = pic[y][x] === '#' ? 1 : 0;
    colClues.push(cluesFromLine(col));
  }
  return { kind: 'nonogram', w, h, rowClues, colClues, picture: pic.join('\n') };
}

const ICONS = {
  5: [
    ['##.##', '#####', '#####', '.###.', '..#..'],
    ['..#..', '.###.', '#####', '.###.', '..#..'],
    ['..#..', '..#..', '#####', '..#..', '..#..'],
    ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    ['#####', '#...#', '#.###', '#...#', '#####'],
    ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
    ['#####', '..#..', '..#..', '..#..', '..#..'],
    ['#....', '#....', '#....', '#....', '#####'],
    ['.###.', '..#..', '..#..', '..#..', '.###.'],
    ['..##.', '.##..', '###..', '.##..', '..##.'],
    ['##.##', '##.##', '.....', '##.##', '##.##'],
    ['..#..', '#.#.#', '#####', '#.#.#', '..#..'],
    ['.###.', '#...#', '#...#', '#...#', '.###.'],
    ['#..#.', '##.##', '.###.', '##.##', '#..#.'],
  ],
  7: [
    ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
    ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
    ['...#...', '..###..', '#######', '.#####.', '..#.#..', '.#...#.', '#.....#'],
    ['...#...', '..###..', '.#####.', '#######', '#.....#', '#.....#', '#######'],
    ['...#...', '..###..', '...#...', '.#####.', '..###..', '...#...', '..###..'],
    ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
    ['..###..', '.#####.', '#######', '...#...', '...#...', '...#...', '..##...'],
    ['...#...', '...#...', '...#...', '.#.#.#.', '#######', '.#####.', '..###..'],
    ['#######', '#.....#', '#.....#', '.#...#.', '..###..', '...#...', '..###..'],
    ['#.###.#', '#######', '#######', '.#####.', '..###..', '..###..', '..###..'],
    ['..#.#..', '.#####.', '.#####.', '..###..', '..###..', '..#.#..', '.##.##.'],
    ['##...##', '##...##', '#######', '.#####.', '..###..', '..###..', '..###..'],
    ['.#####.', '##..###', '#....##', '#....##', '##...#.', '.#####.', '..###..'],
    ['..###..', '.#...#.', '#.....#', '#.....#', '.#...#.', '..###..', '...#...'],
  ],
};

// 镜像生长的小团块：孤立像素会让一条线的线索全是一串 1，看起来像噪点不像画，
// 所以从种子向四周扩散而不是逐格撒点。
function blobPicture(n, rng, { density = 0.44, symmetry = 'both' } = {}) {
  const g = Array.from({ length: n }, () => new Array(n).fill(0));
  const mx = symmetry === 'both' || symmetry === 'x';
  const my = symmetry === 'both' || symmetry === 'y';
  const halfW = mx ? Math.ceil(n / 2) : n;
  const halfH = my ? Math.ceil(n / 2) : n;
  const put = (x, y) => {
    g[y][x] = 1;
    if (mx) g[y][n - 1 - x] = 1;
    if (my) g[n - 1 - y][x] = 1;
    if (mx && my) g[n - 1 - y][n - 1 - x] = 1;
  };
  const seeds = [];
  for (let i = 0, n2 = Math.max(2, Math.round(n / 3)); i < n2; i++) {
    seeds.push([rng.int(halfW), rng.int(halfH)]);
  }
  for (const [x, y] of seeds) put(x, y);
  const front = seeds.slice();
  const target = Math.round(n * n * density * (mx && my ? 0.28 : mx || my ? 0.4 : 0.5));
  let guard = 0;
  while (guard++ < 6000) {
    let filled = 0;
    for (const row of g) for (const v of row) filled += v;
    if (filled >= target) break;
    const [bx, by] = front[rng.int(front.length)];
    const x = bx + rng.pick([1, -1, 0, 0]);
    const y = by + rng.pick([0, 0, 1, -1]);
    if (x < 0 || y < 0 || x >= halfW || y >= halfH) continue;
    if (g[y][x]) continue;
    put(x, y);
    front.push([x, y]);
  }
  return g.map((r) => r.map((v) => (v ? '#' : '.')).join(''));
}

// 出题的硬门槛：纯逻辑能推到底，且黑格密度在"看得出画"的区间里。
export function isGoodSpec(spec, maxDepth = Infinity) {
  const { w, h, rowClues, colClues } = spec;
  const res = logicSolve(new Int8Array(w * h), w, h, rowClues, colClues, { maxDepth });
  if (!res.solved) return false;
  const density = sum(rowClues.flat()) / (w * h);
  return density > 0.14 && density < 0.88;
}

export function generate(seed, sizeKey = 5) {
  const rng = rngFrom(seed);
  const n = sizeKey;
  const tier = n <= 5 ? 0 : n <= 7 ? 1 : n <= 10 ? 2 : n <= 12 ? 3 : 4;
  const icons = ICONS[n];
  if (icons) {
    for (const idx of rng.shuffle(icons.map((_, i) => i))) {
      const spec = pictureToSpec(icons[idx]);
      if (isGoodSpec(spec)) return { ...spec, seed: String(seed), tier };
    }
  }
  const densities = n <= 8 ? [0.34, 0.42, 0.5] : n <= 12 ? [0.38, 0.46, 0.54] : [0.4, 0.46, 0.52];
  const symmetries = n <= 8 ? ['both', 'both', 'x'] : ['both', 'x', 'none'];
  for (let i = 0; i < 400; i++) {
    const spec = pictureToSpec(blobPicture(n, rng, { density: rng.pick(densities), symmetry: rng.pick(symmetries) }));
    if (isGoodSpec(spec, n <= 7 ? 40 : 120)) return { ...spec, seed: String(seed), tier };
  }
  return { ...pictureToSpec(blobPicture(n, rng, { density: 0.44, symmetry: 'both' })), seed: String(seed), tier };
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const { w, h, rowClues, colClues } = spec;
  const rowSum = rowClues.map(sum);
  const colSum = colClues.map(sum);
  const total = sum(rowSum);
  const maxRowItems = rowClues.reduce((a, c) => Math.max(a, normalizeClues(c).length), 1);
  const maxColItems = colClues.reduce((a, c) => Math.max(a, normalizeClues(c).length), 1);

  let grid = new Int8Array(w * h);
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let paint = 0;          // 0 停, 1 涂, 2 画叉
  let last = null;
  let doneAt = 0;
  let cache = null;

  const mark = (x, y) => anim.set(y * w + x, nowMs());

  function snapshot() {
    undoStack.push(Int8Array.from(grid));
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    cache = null;
  }

  function setCell(x, y, v, count = true) {
    const i = y * w + x;
    if (grid[i] === v) return false;
    grid[i] = v;
    mark(x, y);
    // moves 是单调累加的"落子次数"：涂错再涂对要算两次，这样效率星级才测得出人在试错。
    if (count && v === FILLED) moves++;
    return true;
  }

  function countFilled() {
    let n = 0;
    for (const v of grid) if (v === FILLED) n++;
    return n;
  }

  // 一条线一旦凑满就把剩下的未知格自动打叉：这是人手会做的收尾动作，
  // 省下来的是摩擦，不是推理。
  function autoCross() {
    for (let y = 0; y < h; y++) {
      const line = readRow(grid, w, y);
      let c = 0;
      for (const v of line) if (v === FILLED) c++;
      if (c === rowSum[y]) for (let x = 0; x < w; x++) if (line[x] === UNKNOWN) setCell(x, y, EMPTY, false);
    }
    for (let x = 0; x < w; x++) {
      const line = readCol(grid, w, h, x);
      let c = 0;
      for (const v of line) if (v === FILLED) c++;
      if (c === colSum[x]) for (let y = 0; y < h; y++) if (line[y] === UNKNOWN) setCell(x, y, EMPTY, false);
    }
  }

  function clueMatch() {
    for (let y = 0; y < h; y++) if (clueKey(cluesFromLine(readRow(grid, w, y))) !== clueKey(rowClues[y])) return false;
    for (let x = 0; x < w; x++) if (clueKey(cluesFromLine(readCol(grid, w, h, x))) !== clueKey(colClues[x])) return false;
    return true;
  }

  function afterChange() {
    autoCross();
    if (doneAt) return;
    if (countFilled() === total && clueMatch()) doneAt = nowMs();
  }

  function deduction() {
    if (cache) return cache;
    const cells = [];
    const bad = [];
    let any = false;
    for (let y = 0; y < h; y++) {
      const line = readRow(grid, w, y);
      const d = deduceLine(w, rowClues[y], line);
      if (d.contradiction) for (let x = 0; x < w; x++) if (line[x] === FILLED) bad.push([x, y]);
      for (const i of d.filled) { cells.push([i, y, FILLED]); any = true; }
      for (const i of d.empty) { cells.push([i, y, EMPTY]); }
    }
    for (let x = 0; x < w; x++) {
      const line = readCol(grid, w, h, x);
      const d = deduceLine(h, colClues[x], line);
      if (d.contradiction) for (let y = 0; y < h; y++) if (line[y] === FILLED) bad.push([x, y]);
      for (const i of d.filled) { cells.push([x, i, FILLED]); any = true; }
      for (const i of d.empty) { cells.push([x, i, EMPTY]); }
    }
    let lookahead = false;
    if (!any) {
      const la = lookAhead();
      if (la) { cells.push(...la); lookahead = true; }
    }
    cache = { cells, bad, lookahead };
    return cache;
  }

  // 交叉推理 stalled 时的兜底：把这个格假设成两种值各推一遍，看哪支会矛盾。
  function lookAhead() {
    const unknowns = [];
    for (let i = 0; i < grid.length; i++) if (grid[i] === UNKNOWN) unknowns.push(i);
    for (const i of unknowns.slice(0, 120)) {
      const x = i % w;
      const y = (i - x) / w;
      for (const v of [FILLED, EMPTY]) {
        const trial = Int8Array.from(grid);
        trial[i] = v;
        if (logicSolve(trial, w, h, rowClues, colClues).contradiction) {
          const other = v === FILLED ? EMPTY : FILLED;
          const t2 = Int8Array.from(grid);
          t2[i] = other;
          if (!logicSolve(t2, w, h, rowClues, colClues).contradiction) return [[x, y, other]];
        }
      }
    }
    return null;
  }

  const engine = {
    id: 'nonogram',
    spec,
    board: { cols: w, rows: h, margin: { l: maxRowItems + 0.4, t: maxColItems * 0.5 + 0.4, r: 0.25, b: 0.25 } },
    // par = 必须涂黑的格数：每次 down/move 最多涂一格，所以它是个真正的下界。
    // 画叉不计入 moves —— 那是玩家的记号，不是试错。
    stats: () => ({ moves, par: total, done: countFilled(), total }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved: () => doneAt > 0,
    cellState: (x, y) => grid[y * w + x],
    badCells: () => deduction().bad,

    down(x, y, btn) {
      if (x < 0 || y < 0 || x >= w || y >= h || doneAt) return false;
      snapshot();
      const i = y * w + x;
      const wantMark = btn === 1;
      paint = wantMark ? (grid[i] === EMPTY ? 0 : 2) : (grid[i] === FILLED ? 0 : 1);
      last = { x, y };
      const changed = setCell(x, y, paint === 1 ? FILLED : paint === 2 ? EMPTY : UNKNOWN);
      if (changed) afterChange(); else undoStack.pop();
      return changed;
    },

    move(x, y) {
      if (!paint || doneAt) return false;
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (last && last.x === x && last.y === y) return false;
      const from = last || { x, y };
      let changed = false;
      for (const [px, py] of bresenham(from.x, from.y, x, y)) {
        const i = py * w + px;
        if (grid[i] === UNKNOWN) {
          if (!changed) snapshot();
          setCell(px, py, paint === 1 ? FILLED : EMPTY);
          changed = true;
        }
        last = { x: px, y: py };
      }
      if (changed) afterChange();
      return changed;
    },

    up() { paint = 0; last = null; return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(Int8Array.from(grid));
      grid = Int8Array.from(undoStack.pop());
      cache = null;
      doneAt = 0;
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(Int8Array.from(grid));
      grid = Int8Array.from(redoStack.pop());
      cache = null;
      afterChange();
      return true;
    },

    hint() {
      if (doneAt) return null;
      const d = deduction();
      const useful = d.cells.filter(([x, y, v]) => grid[y * w + x] !== v);
      if (!useful.length) return null;
      snapshot();
      const shown = useful.slice(0, 6);
      for (const [x, y, v] of shown) setCell(x, y, v);
      afterChange();
      cache = null;
      return { cells: shown.map(([x, y]) => [x, y]), note: d.lookahead ? '反证：另一种假设会推出自相矛盾' : '这条线只剩一种摆法' };
    },

    draw(ctx, v, t) { render(ctx, v, engine, { grid, rowClues, colClues, anim, t, doneAt, w, h, reveal: 0 }); },
    celebrate(ctx, v, t, k) { render(ctx, v, engine, { grid, rowClues, colClues, anim, t, doneAt, w, h, reveal: k }); },
  };

  return engine;
}

function bresenham(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 128; i++) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

// ---- 渲染 -----------------------------------------------------------------------

function render(ctx, v, engine, s) {
  const { cell, ox, oy, cols, rows } = v;
  const ml = engine.board.margin.l * cell;
  const mt = engine.board.margin.t * cell;
  const fs = Math.max(9, cell * 0.44);
  const reveal = s.reveal;

  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 5);

  for (let y = 0; y < rows; y++) {
    const clues = normalizeClues(s.rowClues[y]);
    const line = s.grid.subarray(y * cols, y * cols + cols);
    let filled = 0;
    for (const c of line) if (c === FILLED) filled++;
    const done = filled === clues.reduce((a, b) => a + b, 0);
    clues.forEach((c, i) => {
      label(ctx, String(c), ox - ml + (i + 0.5) * (ml / Math.max(1, maxItems(s.rowClues))), oy + (y + 0.55) * cell,
        { size: fs, color: done ? T.inkFaint : T.ink, bold: !done });
    });
  }
  for (let x = 0; x < cols; x++) {
    const clues = normalizeClues(s.colClues[x]);
    let filled = 0;
    for (let y = 0; y < rows; y++) if (s.grid[y * cols + x] === FILLED) filled++;
    const done = filled === clues.reduce((a, b) => a + b, 0);
    clues.forEach((c, i) => {
      label(ctx, String(c), ox + (x + 0.5) * cell, oy - mt + (i + 0.72) * fs * 1.06,
        { size: fs, color: done ? T.inkFaint : T.ink, bold: !done });
    });
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const val = s.grid[y * cols + x];
      const t0 = s.anim.get(y * cols + x);
      const k = t0 ? easeOut(Math.min(1, (s.t - t0) / 150)) : 1;
      if (reveal) {
        if (val === FILLED) {
          const wave = easeOut(Math.max(0, Math.min(1, reveal * 2 - (x + y) / (cols + rows))));
          inkCell(ctx, v, x, y, T.accent, 0.25 + 0.75 * wave);
          continue;
        }
        if (val === EMPTY) continue;
      }
      if (val === FILLED) inkCell(ctx, v, x, y, T.accent, 0.26 + 0.74 * k);
      else if (val === EMPTY) crossMark(ctx, v, x, y, T.inkFaint, 0.55 + 0.45 * k);
    }
  }

  if (v.bad && v.bad.length) {
    ctx.save();
    ctx.strokeStyle = T.warn;
    ctx.lineWidth = 2;
    for (const [x, y] of v.bad) {
      roundRect(ctx, ox + x * cell + 1.5, oy + y * cell + 1.5, cell - 3, cell - 3, cell * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (v.hover && !reveal) {
    ctx.save();
    ctx.strokeStyle = rgba(T.ink, 0.2 + 0.12 * pulse(s.t));
    ctx.lineWidth = 1.6;
    roundRect(ctx, ox + v.hover.x * cell + 1, oy + v.hover.y * cell + 1, cell - 2, cell - 2, cell * 0.16);
    ctx.stroke();
    ctx.restore();
  }
}

function maxItems(clues) {
  return clues.reduce((a, c) => Math.max(a, normalizeClues(c).length), 1);
}

export default {
  id: 'nonogram',
  title: '数织',
  latin: 'NONOGRAM',
  tagline: '行列的数字，就是图形的轮廓',
  unit: '格',
  rules: [
    '每行/每列前头的数字，是这条线上连续涂黑格的长度；数字之间至少隔一格。',
    '主笔涂黑、副笔画叉。涂满的线会自动把余下的空格打上叉，数字也会淡下去。',
    '画错一格就会推不出后面的数字 —— 红色描边表示这条线已经不可能成立。',
  ],
  sizes: [
    { key: 5, label: '5×5', tier: '图形' },
    { key: 7, label: '7×7', tier: '图形' },
    { key: 10, label: '10×10', tier: '进阶' },
    { key: 12, label: '12×12', tier: '推理' },
    { key: 15, label: '15×15', tier: '大片' },
  ],
  generate,
  create,
};
