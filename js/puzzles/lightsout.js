// 点灯 / Lights Out —— 按一下，它和上下左右一起翻；目标是一盏都不灭。
//
// 这个玩法的数学是 GF(2) 上的线性方程组，求解器因此可以做到"穷尽"而不是"试探"：
//   · 按压可交换、自抵消（同一格按两次等于没按），所以一个解就是一个按压力集
//   · 首行一定，其后每一行都被上一行的暗格逼出来 —— light chasing
//   · 于是枚举 2^n 个首行方案就穷尽所有解：不猜、不漏、不用回溯
//
// 和数织一样，求解器在这里负三责：判胜负（全亮即终局）、出提示（最短解里的一步）、
// 生成期筛（把"两步就完"的题面挡在门外，并把 par 记进 spec）。
// 翻转矩阵在 5×5、6×6 上是降秩的（零空间维数 2 和 4），所以同一盘面会有多个解 ——
// 这是数学给的，不是 bug；par 一律按其中最少步的那个算。
//
// 行用位掩码存：一行的灯压成一个整数，追赶就退化成几行位运算，枚举 2^n 个首行才
// 便宜到能在生成器里反复调用（n≤15 时一格一位，本玩法最大 7×7 绰绰有余）。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, roundRect, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const LIT = 1;
export const DARK = 0;

const FLIP_MS = 150;   // 一次翻转的时长：短到不打断连续按压，长到看得出五格同时动

const maskOf = (n) => (1 << n) - 1;
const popcount = (bits) => { let c = 0; while (bits) { bits &= bits - 1; c++; } return c; };
const weight = (p) => p.reduce((a, r) => a + popcount(r), 0);

// (x,y) 自己 + 上下左右：一按就同时翻的那几格（边角的邻居本来就少）。
export function plusCells(x, y, n) {
  const out = [[x, y]];
  if (y > 0) out.push([x, y - 1]);
  if (x > 0) out.push([x - 1, y]);
  if (x < n - 1) out.push([x + 1, y]);
  if (y < n - 1) out.push([x, y + 1]);
  return out;
}

// 就地按一次：返回被翻到的格子索引，调用方拿去做动画。
export function pressCell(board, x, y, n) {
  const touched = [];
  for (const [px, py] of plusCells(x, y, n)) {
    const i = py * n + px;
    board[i] ^= 1;
    touched.push(i);
  }
  return touched;
}

// 从全亮出发按完这组按压后的盘面 —— 生成器和测试都用它构造"一定可解"的题面。
export function boardFromPresses(n, presses) {
  const board = new Uint8Array(n * n).fill(LIT);
  for (const i of presses) pressCell(board, i % n, (i - (i % n)) / n, n);
  return board;
}

export function toRows(board, n) {
  const rows = new Int32Array(n);
  for (let y = 0; y < n; y++) {
    let r = 0;
    for (let x = 0; x < n; x++) if (board[y * n + x]) r |= 1 << x;
    rows[y] = r;
  }
  return rows;
}

export function isSolved(board, n) {
  for (let i = 0; i < n * n; i++) if (!board[i]) return false;
  return true;
}

// 所有解，每个解是按压格索引数组（行优先升序）。无解返回空数组 —— 本玩法的题面
// 都由 boardFromPresses 倒推得来，理论上不会走到那条路上，但引擎不假设这一点。
export function solveAll(board, n) {
  const rows = toRows(board, n);
  const m = maskOf(n);
  const out = [];
  const p = new Int32Array(n);
  for (let p0 = 0; p0 <= m; p0++) {
    p[0] = p0;
    let prev = 0;
    let cur = p0;
    for (let y = 0; y < n - 1; y++) {
      const next = m ^ rows[y] ^ cur ^ ((cur << 1) & m) ^ (cur >> 1) ^ prev;
      prev = cur;
      cur = next;
      p[y + 1] = next;
    }
    if ((rows[n - 1] ^ cur ^ ((cur << 1) & m) ^ (cur >> 1) ^ prev) !== m) continue;
    out.push(indicesOf(p, n));
  }
  return out;
}

function indicesOf(p, n) {
  const cells = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (p[y] & (1 << x)) cells.push(y * n + x);
  }
  return cells;
}

// 按压数最少的那个解；并列时取首行编号最小的（枚举顺序即 p0 递增），
// 于是同一盘面每次 hint 都指同一格，玩家不会觉得提示在躲。
export function minSolution(board, n) {
  let best = null;
  for (const s of solveAll(board, n)) if (!best || s.length < best.length) best = s;
  return best;
}

// 零空间维数：全亮盘面上"按了等于没按"的按压有多少种 = 2^nullity。
// 标准 5×5 是 2 —— 每个可解盘面因此有 4 个解。
export function nullity(n) {
  return Math.log2(solveAll(new Uint8Array(n * n).fill(LIT), n).length);
}

// ---- 出题 -----------------------------------------------------------------------

// 按压数从区间里抽：太少两步就完，太多一上手满盘皆暗、看不出差距。
// 门槛卡的是"最少要按几下"（par），不是"抽了几下"—— 降秩的尺寸里同一盘面有
// 更省手的等价解，只有 par 才是玩家真正的代价。
const TIERS = [
  { key: 4, label: '4×4', tier: '入门', par: 4, press: [5, 8] },
  { key: 5, label: '5×5', tier: '经典', par: 6, press: [8, 14] },
  { key: 6, label: '6×6', tier: '进阶', par: 9, press: [12, 22] },
  { key: 7, label: '7×7', tier: '烧脑', par: 12, press: [16, 28] },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

export function generate(seed, sizeKey = 5) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  const all = Array.from({ length: n * n }, (_, i) => i);
  let best = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const count = rng.range(cfg.press[0], cfg.press[1]);
    const board = boardFromPresses(n, rng.shuffle(all.slice()).slice(0, count));
    const solutions = solveAll(board, n);
    let par = n * n + 1;
    for (const s of solutions) if (s.length < par) par = s.length;
    if (!solutions.length || par === 0) continue;   // 翻回全亮了，那不是一道题
    const spec = {
      kind: 'lightsout',
      n,
      board: Array.from(board),
      par,
      solutions: solutions.length,
      nullity: nullity(n),
      seed: String(seed),
      tier: cfg.tier,
    };
    if (!best || spec.par > best.par) best = spec;
    if (spec.par >= cfg.par) return spec;
  }
  return best || { ...generate(`${seed}#retry`, sizeKey) };
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const n = spec.n;
  const total = n * n;
  const src = spec.board && spec.board.length === total ? spec.board : new Array(total).fill(LIT);
  let lit = Uint8Array.from(src, (v) => (v ? LIT : DARK));
  let pressed = new Uint8Array(total);   // 每格被按过几次 —— 纸上那枚淡墨点
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let litCount = 0;
  for (const v of lit) litCount += v;
  let moves = 0;
  let doneAt = 0;
  let tap = null;   // { i, at }：最近被按下的那一格，只有它带指环

  const reCount = () => {
    let c = 0;
    for (const v of lit) c += v;
    litCount = c;
  };

  function snapshot() {
    undoStack.push({ lit: Uint8Array.from(lit), pressed: Uint8Array.from(pressed), moves });
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
  }

  function press(x, y) {
    for (const i of pressCell(lit, x, y, n)) anim.set(i, nowMs());
    const i = y * n + x;
    pressed[i] = Math.min(250, pressed[i] + 1);
    tap = { i, at: nowMs() };
    reCount();
    if (!doneAt && litCount === total) doneAt = nowMs();
  }

  function restore(snap) {
    lit = Uint8Array.from(snap.lit);
    pressed = Uint8Array.from(snap.pressed);
    moves = snap.moves;
    reCount();
    doneAt = 0;
  }

  const solved = () => litCount === total;

  const engine = {
    id: 'lightsout',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.26, t: 0.26, r: 0.26, b: 0.26 } },
    stats: () => ({ moves, par: spec.par || 0, done: litCount, total }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    cellState: (x, y) => lit[y * n + x],
    pressCount: (x, y) => pressed[y * n + x],
    // 点灯没有"与题面矛盾"的格子：任何按压组合都能继续按下去，翻错只是绕远。
    // 与其编一个假的红框，不如什么都不闪。
    badCells: () => [],

    down(x, y) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      snapshot();
      press(x, y);
      moves++;
      return true;
    },

    // 没有连笔：一次按下就是一步求解，拖动若也计入就会在指尖下把盘面搅乱。
    move() { return false; },
    up() { return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push({ lit: Uint8Array.from(lit), pressed: Uint8Array.from(pressed), moves });
      restore(undoStack.pop());
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push({ lit: Uint8Array.from(lit), pressed: Uint8Array.from(pressed), moves });
      const snap = redoStack.pop();
      lit = Uint8Array.from(snap.lit);
      pressed = Uint8Array.from(snap.pressed);
      reCount();
      // 快照里存的是这一步之后的按压数，直接取回，别再用 +1 猜一遍
      moves = snap.moves;
      if (litCount === total) doneAt = nowMs();
      return true;
    },

    hint() {
      if (solved()) return null;
      const best = minSolution(lit, n);
      if (!best || !best.length) return null;
      snapshot();
      const i = best[0];
      const x = i % n;
      const y = (i - x) / n;
      press(x, y);
      moves++;
      return {
        cells: [[x, y]],
        note: `这是最短解里的一步：按它（连同四邻一起翻），最短还差 ${best.length - 1} 步全亮`,
      };
    },

    draw(ctx, v, t) {
      render(ctx, v, { lit, pressed, anim, t, reveal: 0, done: solved(), tap });
    },
    celebrate(ctx, v, t, k) {
      render(ctx, v, { lit, pressed, anim, t, reveal: k, done: true, tap: null });
    },
  };

  return engine;
}

// ---- 渲染 -----------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  const c0 = (cols - 1) / 2;
  const c1 = (rows - 1) / 2;
  const span = Math.hypot(c0, c1) || 1;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const on = s.lit[i] === LIT;
      const t0 = s.anim.get(i);
      const p = !t0 || v.reduce ? 1 : clamp((s.t - t0) / FLIP_MS, 0, 1);
      const k = easeOut(p);
      // 通关波：离中心近的先生长，一圈圈推出去
      const wave = s.reveal
        ? 0.42 + 0.58 * easeOut(clamp(s.reveal * 2 - Math.hypot(x - c0, y - c1) / span, 0, 1))
        : 1;
      // 翻到一半先演旧值：卡片缩进去的是原来那盏，长出来的是新的
      const shown = p < 1 && p > 0 ? (p < 0.5 ? !on : on) : on;
      const scale = 1 - 0.24 * Math.sin(Math.PI * p);
      lamp(ctx, v, x, y, shown, scale, wave, p, s.pressed[i]);
    }
  }

  if (s.tap && !v.reduce) {
    const p = clamp((s.t - s.tap.at) / FLIP_MS, 0, 1);
    if (p > 0 && p < 1) ring(ctx, v, s.tap.i % cols, (s.tap.i - (s.tap.i % cols)) / cols, easeOut(p));
  }

  if (v.hover && !s.reveal && !s.done && !v.reduce) preview(ctx, v, v.hover.x, v.hover.y, s.t);
}

function lamp(ctx, v, x, y, on, scale, bright, flip, marks) {
  const cell = v.cell;
  const cx = v.ox + x * cell + cell / 2;
  const cy = v.oy + y * cell + cell / 2;
  const size = cell * 0.78 * scale;
  const r = size * 0.28;
  const glow = on ? bright * (0.86 + 0.14 * (1 - flip)) : 0;

  ctx.save();
  if (glow > 0.01) {
    // 暖色径向光晕：先有光，卡片才像是从光里浮出来的；半径超出卡片边界，灯才会互相"连成一片"
    const halo = cell * (0.58 + 0.2 * glow);
    const g = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, halo);
    g.addColorStop(0, rgba('#fff4cf', 0.9 * glow));
    g.addColorStop(0.5, rgba(T.gold, 0.32 * glow));
    g.addColorStop(1, rgba(T.gold, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, halo, 0, Math.PI * 2);
    ctx.fill();
  }

  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, r);
  if (on) {
    ctx.fillStyle = rgba('#fdf4da', 0.97);
    ctx.fill();
    ctx.strokeStyle = rgba(T.gold, 0.55);
    ctx.lineWidth = 1 / v.dpr;
    ctx.stroke();
  } else {
    ctx.fillStyle = rgba(T.inkSoft, 0.17);        // 暗纸色
    ctx.fill();
    ctx.strokeStyle = rgba(T.inkSoft, 0.42);
    ctx.lineWidth = 1 / v.dpr;
    ctx.stroke();
  }

  // 灯泡本体：亮时实心暖黄带一点高光，灭时只留一圈轮廓 —— 一眼能数清还剩几盏要救
  const br = size * 0.29;
  if (on) {
    const b = ctx.createRadialGradient(cx - br * 0.35, cy - br * 0.4, br * 0.15, cx, cy, br * 1.2);
    b.addColorStop(0, rgba('#fff8e2', 0.98 * bright));
    b.addColorStop(1, rgba('#f0b93c', 0.95 * bright));
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(cx, cy, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#fffdf6', 0.7);
    ctx.beginPath();
    ctx.arc(cx - br * 0.32, cy - br * 0.36, br * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = rgba(T.inkSoft, 0.5);
    ctx.lineWidth = Math.max(1, size * 0.055);
    ctx.beginPath();
    ctx.arc(cx, cy, br, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (marks > 0) {
    // 玩家真正的记号：这格按过几下。按两下等于没按，所以这枚墨点是给自己看的。
    ctx.fillStyle = rgba(T.ink, Math.min(0.5, 0.22 + 0.08 * marks));
    ctx.beginPath();
    ctx.arc(cx + size * 0.31, cy + size * 0.31, size * 0.085 * Math.min(1.6, 0.8 + 0.2 * marks), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function ring(ctx, v, x, y, k) {
  const cell = v.cell;
  const cx = v.ox + x * cell + cell / 2;
  const cy = v.oy + y * cell + cell / 2;
  ctx.save();
  ctx.strokeStyle = rgba(T.ink, 0.34 * (1 - k));
  ctx.lineWidth = Math.max(1, cell * 0.05 * (1 - k * 0.5));
  ctx.beginPath();
  ctx.arc(cx, cy, cell * (0.34 + 0.34 * k), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// 悬停时把"这一按会翻到那五格"淡淡描出来 —— 规则只有一句话，但要用手指确认一次。
function preview(ctx, v, x, y, t) {
  if (x < 0 || y < 0 || x >= v.cols || y >= v.rows) return;
  ctx.save();
  ctx.strokeStyle = rgba(T.accent, 0.2 + 0.12 * pulse(t));
  ctx.lineWidth = Math.max(1, v.cell * 0.045);
  for (const [px, py] of plusCells(x, y, v.cols)) {
    const size = v.cell * 0.78;
    roundRect(ctx, v.ox + px * v.cell + (v.cell - size) / 2, v.oy + py * v.cell + (v.cell - size) / 2, size, size, size * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

export default {
  id: 'lightsout',
  title: '点灯',
  latin: 'LIGHTS OUT',
  tagline: '一盏动，四邻跟着翻；目标是一盏都不灭',
  unit: '盏',
  rules: [
    '按下一盏灯：它自己和上下左右四格同时翻转，亮变灭、灭变亮。',
    '目标是把整片灯全部点亮。同一格按两下等于没按，所以按过的位置会留下淡墨点。',
    '首行一定，后面每一行都被上一行的暗格逼着走 —— 提示给的是最短解里的一步。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
