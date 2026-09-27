// 黑白 / AKBANE —— 每格不是黑就是白；带数的格子报出它"看见"的同色格数。
//
// 看见 = 沿上下左右四条直线走，走到第一个异色格为止（那一格不算看见，自己也不算）。
// 另有一条前提：任何 2×2 都不许四格同色 —— 这条不是可选规则，是玩法成立的地基，测试专门钉它。
//
// 求解器是"传播 + 猜"，两件事在这里都靠它：
//   · 传播：2×2 里三格同色 → 第四格反色；某条数字的四向"下限和 = 数字" → 各方向第一个未知格必反色；
//     "上限和 = 数字" → 各方向可能范围内的未知格全染成本色。人的推理就是这两下，所以盘面纯逻辑可解。
//   · 计数：猜一格、再传播，数到第二种就早停；预算烧完置 capped —— 半截的计数不配当唯一性证明。
// 生成器因此是"染一盘 → 全部标数 → 一条条擦数，擦完仍只剩一种涂法才继续擦"，
// 交出去的题面一定被穷尽数过（永远不返回 null：最后一次"证过唯一"的题面就是兜底）。
//
// par = 题面之外的格数，依据：一次落子最多把一格的颜色定下来，其余格子每格都欠一手。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, roundRect, label, crossMark, rgba, easeOut, clamp, pulse, paper, inkCell } from '../core/paper.js';

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

const idx = (x, y, n) => y * n + x;
const xyOf = (i, n) => [i % n, (i - (i % n)) / n];
const opp = (c) => (c === BLACK ? WHITE : c === WHITE ? BLACK : EMPTY);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DX = Int8Array.from([1, -1, 0, 0]);
const DY = Int8Array.from([0, 0, 1, -1]);
const COLORS = [BLACK, WHITE];
const shuffled = (rng, list) => rng.shuffle(list.slice());

// 题面里的数字带符号：正 = 黑格上的数，负 = 白格上的数（0 = 这格没数，颜色由玩家定）
export const clueColor = (c) => (c > 0 ? BLACK : c < 0 ? WHITE : EMPTY);
export const clueValue = (c) => (c < 0 ? -c : c);

// 传播：三条人手规则轮着刷，刷到再也推不动为止
//   ① 2×2 里三格同色 → 第四格反色
//   ② 某数字四向"铁定看见的"之和 = 数字 → 各方向第一个未知格必反色（再多一格就数超了）
//   ③ 四向"顶多能看见的"之和 = 数字 → 各方向可能范围内的未知格全染成本色
// mn = 只数已经铁定是本色的领头格（碰到未知就停）；mx = 本色或未知的领头格数（碰到已定异色才停）。
// 计数求解器每个节点都要跑一遍这里，所以热路径上一个临时对象都不造。
function propagate(n, clues, grid, clueIdx) {
  const list = clueIdx || clues.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y + 1 < n; y++) {
      const r0 = y * n;
      const r1 = r0 + n;
      for (let x = 0; x + 1 < n; x++) {
        const a = grid[r0 + x];
        const b = grid[r0 + x + 1];
        const c = grid[r1 + x];
        const d = grid[r1 + x + 1];
        if (a && a === b && a === c && !d) { grid[r1 + x + 1] = 3 - a; changed = true; }
        if (b && b === a && b === d && !c) { grid[r1 + x] = 3 - b; changed = true; }
        if (c && c === a && c === d && !b) { grid[r0 + x + 1] = 3 - c; changed = true; }
        if (d && d === b && d === c && !a) { grid[r0 + x] = 3 - d; changed = true; }
      }
    }
    for (let t = 0; t < list.length; t++) {
      const j = list[t];
      const col = clues[j] > 0 ? BLACK : WHITE;
      const want = clues[j] > 0 ? clues[j] : -clues[j];
      if (grid[j] === EMPTY) { grid[j] = col; changed = true; }
      else if (grid[j] !== col) return false;
      const x = j % n;
      const y = (j - x) / n;
      let mn = 0;
      let mx = 0;
      for (let d = 0; d < 4; d++) {
        const dx = DX[d];
        const dy = DY[d];
        let cx = x;
        let cy = y;
        let lead = true;
        for (;;) {
          cx += dx;
          cy += dy;
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
          const v = grid[cy * n + cx];
          if (v === col) { mx++; if (lead) mn++; }
          else if (v === EMPTY) { mx++; lead = false; }
          else break;
        }
      }
      if (mn > want || mx < want) return false;
      if (mn === want) {
        for (let d = 0; d < 4; d++) {
          const dx = DX[d];
          const dy = DY[d];
          let cx = x;
          let cy = y;
          for (;;) {
            cx += dx;
            cy += dy;
            if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
            const v = grid[cy * n + cx];
            if (v === EMPTY) { grid[cy * n + cx] = 3 - col; changed = true; break; }
            if (v !== col) break;
          }
        }
      }
      if (mx === want) {
        for (let d = 0; d < 4; d++) {
          const dx = DX[d];
          const dy = DY[d];
          let cx = x;
          let cy = y;
          for (;;) {
            cx += dx;
            cy += dy;
            if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
            const i = cy * n + cx;
            const v = grid[i];
            if (v === EMPTY) { grid[i] = col; changed = true; }
            else if (v !== col) break;
          }
        }
      }
    }
  }
  return true;
}

// 独立于求解器的判据：直接按规则数一遍。生成器交卷前、引擎判胜时都走这条。
export function visibleCount(n, grid, x, y) {
  const col = grid[idx(x, y, n)];
  if (col === EMPTY) return -1;
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let cx = x;
    let cy = y;
    for (;;) {
      cx += dx;
      cy += dy;
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
      if (grid[cy * n + cx] !== col) break;
      total++;
    }
  }
  return total;
}

export function hasMonoSquare(n, grid) {
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const a = grid[idx(x, y, n)];
      if (a === EMPTY) continue;
      if (grid[idx(x + 1, y, n)] === a && grid[idx(x, y + 1, n)] === a && grid[idx(x + 1, y + 1, n)] === a) return true;
    }
  }
  return false;
}

// 一张涂满的盘是否满足题面：颜色齐全、无 2×2 同色、每个数字都如实。
export function verifyColoring(n, clues, grid) {
  for (let i = 0; i < n * n; i++) if (grid[i] === EMPTY) return false;
  if (hasMonoSquare(n, grid)) return false;
  for (let j = 0; j < n * n; j++) {
    if (!clues[j]) continue;
    if (grid[j] !== clueColor(clues[j])) return false;
    if (visibleCount(n, grid, j % n, (j - (j % n)) / n) !== clueValue(clues[j])) return false;
  }
  return true;
}

// ---- 计数求解器 -----------------------------------------------------------------

// 猜一格再传播，数到 limit 就收手；预算烧完置 capped。witness 是找到的第一个解，给提示用。
export function countSolutions(spec, cap = 20000, opts = {}) {
  const n = spec.n;
  const clues = spec.clues;
  const limit = opts.limit || 2;
  const total = n * n;
  const clueIdx = [];
  for (let i = 0; i < total; i++) if (clues[i]) clueIdx.push(i);
  const base = new Int8Array(total);
  for (let i = 0; i < total; i++) base[i] = clues[i] ? clueColor(clues[i]) : EMPTY;
  if (opts.given) for (let i = 0; i < total; i++) {
    const g = opts.given[i];
    if (!g) continue;
    if (base[i] !== EMPTY && base[i] !== g) return { count: 0, capped: false, nodes: 0, witness: null };
    base[i] = g;
  }

  let nodes = 0;
  let capped = false;
  let witness = null;
  let count = 0;

  const search = (grid) => {
    if (capped || count >= limit) return;
    if (++nodes > cap) { capped = true; return; }
    const g = Int8Array.from(grid);
    if (!propagate(n, clues, g, clueIdx)) return;
    let pick = -1;
    let bestScore = -1;
    for (let i = 0; i < total; i++) {
      if (g[i] !== EMPTY) continue;
      const x = i % n;
      let around = 0;
      if (x > 0 && g[i - 1] !== EMPTY) around++;
      if (x < n - 1 && g[i + 1] !== EMPTY) around++;
      if (i >= n && g[i - n] !== EMPTY) around++;
      if (i < total - n && g[i + n] !== EMPTY) around++;
      if (around > bestScore) { bestScore = around; pick = i; if (around === 4) break; }
    }
    if (pick < 0) {
      if (verifyColoring(n, clues, g)) {
        count++;
        if (!witness) witness = Array.from(g);
      }
      return;
    }
    for (const c of COLORS) {
      g[pick] = c;
      search(g);
      g[pick] = EMPTY;
      if (capped || count >= limit) return;
    }
  };

  search(base);
  return { count, capped, nodes, witness };
}

// ---- 出题 -----------------------------------------------------------------------

// cap = 擦一刀时给计数求解器的节点预算：预算内数完 = 唯一性证毕；超预算就退回那一刀（宁可多留一个数）。
// 它是"肯擦多深"的口径，不是正确性开关 —— 交卷前还要用更大的预算把最终题面重数一遍。
const TIERS = [
  { key: 6, label: '6×6', tier: '入门', cap: 1500, tries: 8 },
  { key: 8, label: '8×8', tier: '进阶', cap: 2000, tries: 8 },
  { key: 10, label: '10×10', tier: '烧脑', cap: 1500, tries: 8 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

// 逐格染色，遇到 2×2 将成同色就被逼反 —— 生成期就用规则本身保证地基不塌。
function randomColoring(n, rng) {
  const grid = new Int8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let c = rng.int(2) ? BLACK : WHITE;
      const l = x > 0 ? grid[idx(x - 1, y, n)] : EMPTY;
      const u = y > 0 ? grid[idx(x, y - 1, n)] : EMPTY;
      const ul = x > 0 && y > 0 ? grid[idx(x - 1, y - 1, n)] : EMPTY;
      if (l !== EMPTY && u !== EMPTY && ul !== EMPTY && l === u && u === ul) c = opp(l);
      grid[idx(x, y, n)] = c;
    }
  }
  return grid;
}

function specOf(n, cfg, clues, solution, seed, count, capped) {
  let given = 0;
  for (const c of clues) if (c) given++;
  return {
    kind: 'akabane',
    n,
    clues: clues.slice(),
    solution: Array.from(solution),
    par: n * n - given,
    cluesGiven: given,
    solutions: count,
    capped,
    seed: String(seed),
    tier: cfg.tier,
  };
}

export function generate(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const total = n * n;
  const rng = rngFrom(seed);
  let fallback = null;
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const sub = rng.fork(`a${attempt}`);
    const solution = randomColoring(n, sub);
    // 满题面（每格都标数）必然唯一：颜色全写在脸上了。从它开始一条条擦。
    const full = new Array(total).fill(0);
    for (let i = 0; i < total; i++) {
      const k = visibleCount(n, solution, i % n, (i - (i % n)) / n);
      if (k > 0) full[i] = solution[i] === BLACK ? k : -k;
    }
    const clues = full.slice();
    for (const i of shuffled(sub, [...Array(total).keys()])) {
      if (!clues[i]) continue;
      const keep = clues[i];
      clues[i] = 0;
      const { count, capped } = countSolutions({ n, clues }, cfg.cap);
      if (capped || count !== 1) clues[i] = keep;      // 没数完就等于没证明，宁可多留一个数
    }
    const { count, capped } = countSolutions({ n, clues }, 4 * cfg.cap);
    if (!capped && count === 1 && verifyColoring(n, clues, solution)) {
      const spec = specOf(n, cfg, clues, solution, seed, count, false);
      if (spec.par >= n) return spec;
      if (!fallback) fallback = spec;
    }
  }
  // 擦得太狠、或者验算预算烧完：交一张能收得住的桌 —— 满题面永远唯一，只是没得可涂。
  if (fallback) return fallback;
  const solution = randomColoring(n, rngFrom(`${seed}#fb`));
  const clues = new Array(total).fill(0);
  for (let i = 0; i < total; i++) {
    const k = visibleCount(n, solution, i % n, (i - (i % n)) / n);
    if (k > 0) clues[i] = solution[i] === BLACK ? k : -k;
  }
  const { count, capped } = countSolutions({ n, clues }, 4 * cfg.cap);
  return specOf(n, cfg, clues, solution, seed, count, capped);
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const n = spec.n;
  const total = n * n;
  const clues = spec.clues;
  let cells = new Uint8Array(total);
  let marks = new Uint8Array(total);        // 副笔的小叉：记事用，不是落子
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let doneAt = 0;

  for (let i = 0; i < total; i++) if (clues[i]) cells[i] = clueColor(clues[i]);

  const freeCells = () => {
    let c = 0;
    for (let i = 0; i < total; i++) if (!clues[i]) c++;
    return c;
  };
  const filled = () => {
    let c = 0;
    for (let i = 0; i < total; i++) if (cells[i] !== EMPTY) c++;
    return c;
  };
  const solved = () => filled() === total && verifyColoring(n, clues, cells);

  function snapshot() {
    undoStack.push({ cells: Uint8Array.from(cells), marks: Uint8Array.from(marks) });
    if (undoStack.length > 400) undoStack.shift();
    redoStack.length = 0;
  }

  const apply = (snap) => {
    cells = Uint8Array.from(snap.cells);
    marks = Uint8Array.from(snap.marks);
    doneAt = 0;
  };

  const toFree = (i) => {
    cells[i] = EMPTY;
    marks[i] = 0;
  };

  // 玩家已定的格与唯一解抵触的那几格（题面唯一 ⇒ 任何合法涂法都等于解，所以这判据是硬结论）
  const wrongCells = () => {
    const out = [];
    for (let i = 0; i < total; i++) if (!clues[i] && cells[i] !== EMPTY && cells[i] !== spec.solution[i]) out.push(i);
    return out;
  };

  const engine = {
    id: 'akabane',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.26, t: 0.26, r: 0.26, b: 0.26 } },
    stats: () => ({ moves, par: spec.par || freeCells(), done: filled() - (total - freeCells()), total: freeCells() }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    cellState: (x, y) => cells[idx(x, y, n)],
    isClue: (x, y) => !!clues[idx(x, y, n)],

    // 与题面矛盾的格子：2×2 四格同色，或者某个数字已经数超了。
    badCells() {
      const bad = new Set();
      for (let y = 0; y + 1 < n; y++) {
        for (let x = 0; x + 1 < n; x++) {
          const q = [idx(x, y, n), idx(x + 1, y, n), idx(x, y + 1, n), idx(x + 1, y + 1, n)];
          const a = cells[q[0]];
          if (a === EMPTY) continue;
          if (q.every((i) => cells[i] === a)) for (const i of q) bad.add(i);
        }
      }
      for (let j = 0; j < total; j++) {
        if (!clues[j]) continue;
        if (cells[j] === EMPTY) continue;
        const seen = visibleCount(n, cells, j % n, (j - (j % n)) / n);
        if (seen > clueValue(clues[j])) {
          bad.add(j);
          // 数超了：把这条路上多出来的同色格一起标出来，玩家才知道该改谁
          const [x, y] = xyOf(j, n);
          for (const [dx, dy] of DIRS) {
            let cx = x;
            let cy = y;
            const run = [];
            for (;;) {
              cx += dx;
              cy += dy;
              if (cx < 0 || cy < 0 || cx >= n || cy >= n || cells[idx(cx, cy, n)] !== cells[j]) break;
              run.push(idx(cx, cy, n));
            }
            for (const i of run.slice(clueValue(clues[j]))) bad.add(i);
          }
        }
      }
      return [...bad].sort((p, q) => p - q).map((i) => xyOf(i, n));
    },

    down(x, y, btn = 0) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      const i = idx(x, y, n);
      if (clues[i]) return false;                     // 题面给的格子颜色已定，涂不动也擦不掉
      if (btn === 1) {
        if (cells[i] !== EMPTY) return false;         // 已经定了色就不必再打叉
        snapshot();
        marks[i] = marks[i] ? 0 : 1;                  // 叉是记事本：不收步
        anim.set(i, nowMs());
        return true;
      }
      snapshot();
      const next = cells[i] === EMPTY ? BLACK : cells[i] === BLACK ? WHITE : EMPTY;
      if (cells[i] === EMPTY) moves++;                // 空格里落一子才结账；改色、擦除都是手滑
      marks[i] = 0;
      cells[i] = next;
      anim.set(i, nowMs());
      if (solved()) doneAt = nowMs();
      return true;
    },

    // 涂色是一格一格的判断，拖动会把路过全格的色连着翻 —— 只认按下。
    move() { return false; },
    up() { return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push({ cells: Uint8Array.from(cells), marks: Uint8Array.from(marks) });
      apply(undoStack.pop());
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push({ cells: Uint8Array.from(cells), marks: Uint8Array.from(marks) });
      apply(redoStack.pop());
      if (solved()) doneAt = nowMs();
      return true;
    },

    hint() {
      if (solved()) return null;
      // 涂得跟唯一解不一样的那一格最要紧：它还在盘上，后面任何推理都是空中楼阁。
      const wrong = wrongCells();
      if (wrong.length) {
        const i = wrong[0];
        snapshot();
        toFree(i);
        anim.set(i, nowMs());
        const [x, y] = xyOf(i, n);
        return { cells: [[x, y]], note: '这一格与唯一解冲突，先擦掉它 —— 擦除不退已经付的那一步' };
      }
      // 盘面干净时给人该自己看出的那一格：拿当前盘面跑一遍传播，逼出来的就是下一步。
      const g = Int8Array.from(cells);
      if (propagate(n, clues, g)) {
        const forced = [];
        for (let i = 0; i < total; i++) if (g[i] !== EMPTY && cells[i] === EMPTY) forced.push(i);
        if (forced.length) return paint(forced[0], g[forced[0]], '规则逼出来的格子：这一格的颜色没有别的可能');
      }
      // 传播推不动、盘面又没错：这题到这儿需要试手了，交出一格，不倒整份答案。
      for (let i = 0; i < total; i++) {
        if (cells[i] === EMPTY) return paint(i, spec.solution[i], '唯一解里这一格该涂的颜色');
      }
      return null;
    },

    draw(ctx, v, t) {
      render(ctx, v, { clues, cells, marks, anim, t, reveal: 0, done: solved() });
    },
    celebrate(ctx, v, t, k) {
      render(ctx, v, { clues, cells, marks, anim, t, reveal: k, done: true });
    },
  };

  function paint(i, color, why) {
    snapshot();
    if (cells[i] === EMPTY) moves++;
    marks[i] = 0;
    cells[i] = color;
    anim.set(i, nowMs());
    if (solved()) doneAt = nowMs();
    const [x, y] = xyOf(i, n);
    return { cells: [[x, y]], note: `${why}，还差 ${total - filled()} 格涂满` };
  }

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
      const i = idx(x, y, cols);
      const t0 = s.anim.get(i);
      const p = !t0 || v.reduce ? 1 : clamp((s.t - t0) / 170, 0, 1);
      const wave = s.reveal ? 0.5 + 0.5 * easeOut(clamp(s.reveal * 2 - Math.hypot(x - c0, y - c1) / span, 0, 1)) : 1;
      const color = s.cells[i];
      const shown = p < 1 && p > 0 ? (p < 0.5 ? EMPTY : color) : color;
      if (shown === BLACK) inkCell(ctx, v, x, y, rgba(T.ink, 0.92 * wave), 0.94);
      else if (shown === WHITE) whiteDisc(ctx, v, x, y, wave);
      else if (s.marks[i]) crossMark(ctx, v, x, y, rgba(T.inkSoft, 0.75), 0.72);
    }
  }

  // 数字压在色块上：黑底白字 / 白底黑字，一眼分得清这个数字数的是哪种颜色
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const clue = s.clues[idx(x, y, cols)];
      if (!clue) continue;
      const dark = clueColor(clue) === BLACK;
      label(ctx, String(clueValue(clue)), ox + x * cell + cell / 2, oy + y * cell + cell / 2 + cell * 0.02, {
        size: cell * 0.46,
        color: dark ? rgba(T.card, 0.96) : rgba(T.ink, 0.92),
        bold: true,
      });
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

  if (v.hover && !s.reveal && !s.done) {
    const { x, y } = v.hover;
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      const i = idx(x, y, cols);
      if (s.clues[i]) ring(ctx, v, x, y, rgba(T.warn, 0.5));                     // 题面给的色，涂不动
      else if (s.cells[i] === EMPTY) ghost(ctx, v, x, y, BLACK, s.t);            // 点一下先变黑
      else ghost(ctx, v, x, y, opp(s.cells[i]), s.t);                           // 再点变白、再点擦掉
    }
  }
}

// 白子：不能只留白纸一张，否则"我涂过白了"和"这格还空着"分不开
function whiteDisc(ctx, v, x, y, wave = 1) {
  const cx = v.ox + x * v.cell + v.cell / 2;
  const cy = v.oy + y * v.cell + v.cell / 2;
  const r = v.cell * 0.36;
  ctx.save();
  ctx.fillStyle = rgba('#ffffff', 0.98);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(T.ink, 0.5 * wave);
  ctx.lineWidth = Math.max(1, v.cell * 0.045);
  ctx.stroke();
  ctx.restore();
}

function ghost(ctx, v, x, y, color, t) {
  const k = 0.12 + 0.07 * pulse(t);
  if (color === BLACK) inkCell(ctx, v, x, y, rgba(T.ink, k), 0.9);
  else {
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3 * pulse(t);
    whiteDisc(ctx, v, x, y);
    ctx.restore();
  }
}

function ring(ctx, v, x, y, color) {
  const cx = v.ox + x * v.cell + v.cell / 2;
  const cy = v.oy + y * v.cell + v.cell / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, v.cell * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, v.cell * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'akabane',
  title: '黑白',
  latin: 'AKBANE',
  tagline: '数字数它看见的同色格，2×2 不许一个色',
  unit: '格',
  rules: [
    '每格要么涂黑、要么涂白；带数字的格子颜色题面已经给定。',
    '数字 = 从这格沿上下左右看出去的同类格子总数：看到第一个异色格就停，自己不算进去。',
    '任何 2×2 都不许四格同色 —— 这一条是整个玩法的地基。',
    '主笔在空格里点出黑、再点白、再点擦掉（只有空格定色算一步）；副笔打个小叉做记号，不算落子。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
