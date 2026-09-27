// 五寸钉 / SLANT —— 每格画一条斜线，数字说"有几条线收在这里"。
//
// 规则只有两条：每格必须有一条斜线（"/" 或 "\"），带数字的交叉点四周恰好有那么多条线的
// 端点落在它上面。斜线只有两个取值、一个节点只管四格 —— 所以求解器不需要任何高级结构：
// 对每个带数字的点做一次"还差几条 / 还剩几格可放"的算账，就是人的全部推理路径。
//
// 生成顺序是"先画满盘 → 数字自然掉出来 → 一条条擦数字，擦完仍推得完才收刀"。
// 反着做（先给数字再求解）会造出一半无解盘，这里从根上避开：解是前提，题面是解的读数。
// 而"擦完仍推得完"这一条同时给了两样东西：唯一性（传播写下的每一笔在**所有**解里都成立，
// 能推满全盘 = 只剩一个解）和难度（一擦就推不动的那一刀不留下）。计数求解器只做保险丝，
// 它存在的意义是"证明这两件事还没走散"，不是出题的门槛。
//
// par = n×n：每格都欠一子，一次落子最多定一格。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, roundRect, label, crossMark, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const OPEN = 0;
// 屏幕坐标 y 向下："/" 从左下走到右上，"\" 从左上走到右下。每条规则、每个数字、每次落笔
// 都读这一句话，所以渲染和判定不会各说各话。
export const SLASH = 1;
export const BACK = 2;
// 节点的"没有数字"必须是独立哨兵：0 在这儿是真线索（"没有线收在这里"），
// 拿 0 当空会把盘上所有的 0 悄悄删掉。
export const NO_CLUE = -1;

const other = (v) => (v === SLASH ? BACK : SLASH);
const VALUES = [SLASH, BACK];

// 节点 (x,y) 四周的格子，以及"这格要把线收到这个节点上"所必须取的值。
export function nodeAt(n, x, y) {
  const out = [];
  if (y > 0 && x > 0) out.push([(y - 1) * n + (x - 1), BACK]);   // 左上那格的线往右下走才够得到
  if (y > 0 && x < n) out.push([(y - 1) * n + x, SLASH]);         // 右上那格的线往左下走
  if (y < n && x > 0) out.push([y * n + (x - 1), SLASH]);         // 左下那格
  if (y < n && x < n) out.push([y * n + x, BACK]);                // 右下那格
  return out;
}

// 节点拓扑只跟 n 有关，算一次存下来：求解器每个候选盘都要跑几百遍。
const TOPO = new Map();
function topo(n) {
  let t = TOPO.get(n);
  if (!t) {
    const nodes = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) nodes.push(nodeAt(n, x, y));
    t = { nodes, nn: (n + 1) * (n + 1), n2: n * n };
    TOPO.set(n, t);
  }
  return t;
}

// 一个解隐含的全部数字：生成器用它出题；判定不读它（rulesOk 只认题面写的数）。
export function cluesFrom(n, solution) {
  const t = topo(n);
  const out = new Int8Array(t.nn);
  for (let i = 0; i < t.nn; i++) {
    let k = 0;
    for (const [cell, want] of t.nodes[i]) if (solution[cell] === want) k++;
    out[i] = k;
  }
  return out;
}

// ---- 判定：直接照规则数一遍 ------------------------------------------------------

// 填满是"每格有线"，判胜是"每个数字如实"。这里不看推导结果、也不看唯一解，
// 所以传播里写错一笔不可能伪造通关。
export function rulesOk(n, clue, cells) {
  const t = topo(n);
  for (let i = 0; i < t.n2; i++) if (cells[i] === OPEN) return false;
  for (let i = 0; i < t.nn; i++) {
    const want = clue[i];
    if (want === NO_CLUE) continue;
    let have = 0;
    for (const [cell, value] of t.nodes[i]) if (cells[cell] === value) have++;
    if (have !== want) return false;
  }
  return true;
}

// 已经与题面打架的节点：线多了，或者剩下的空格全收过来也凑不满。
// 单独给它一个出口，是因为只标格子的话玩家得自己反查"究竟哪个数字被我数坏了"。
export function violatedNodes(n, clue, cells) {
  const t = topo(n);
  const out = [];
  for (let i = 0; i < t.nn; i++) {
    const want = clue[i];
    if (want === NO_CLUE) continue;
    let have = 0;
    let open = 0;
    for (const [cell, value] of t.nodes[i]) {
      if (cells[cell] === OPEN) open++;
      else if (cells[cell] === value) have++;
    }
    if (have > want || have + open < want) out.push(i);
  }
  return out;
}

// ---- 传播：人手的那两下算账 --------------------------------------------------------

// 对每个带数字的点：已经收在这儿的有 have 条，还空着的有 open 格。
//   need = 数字 − have：need == 0 → 空格一条都不许收过来（全画成反方向）
//                        need == open → 空格每一条都必须收过来（全画成这个方向）
// 这两条结论对**任何**解都成立 —— 这正是"推得完 ⇒ 唯一"的依据。
//
// 四种逼法分开记账，因为它们在人手里的分量不一样：
//   zero  数字是 0，四周全画反             —— 一眼，权重 1
//   full  数字 4，四周全画过来             —— 一眼，权重 1
//   done  数字已经凑满，剩下的画反         —— 要先数一遍才知道够，权重 1.5
//   need  还差 k 条而只剩 k 格可放         —— 要做一次减法，权重 1.5
// 这个加权和是**唯一**有用的难度尺子：推导笔数不是（可推到底的盘永远恰好写满 n² 格，
// 每格一笔，所以笔数恒等于格数，拿它挑题等于没挑）。
const RULE_W = { zero: 1, full: 1, done: 1.5, need: 1.5 };

function sweep(n, clue, st, writes) {
  const t = topo(n);
  let changed = false;
  for (let i = 0; i < t.nodes.length; i++) {
    const want = clue[i];
    if (want === NO_CLUE) continue;
    const list = t.nodes[i];
    let have = 0;
    let open = 0;
    for (const [cell, value] of list) {
      if (st[cell] !== OPEN) { if (st[cell] === value) have++; } else open++;
    }
    const need = want - have;
    if (need < 0 || need > open) return { conflict: i, changed };
    if (!open || (need !== 0 && need !== open)) continue;
    const kind = need === 0 ? (want === 0 ? 'zero' : 'done') : open === list.length ? 'full' : 'need';
    for (const [cell, value] of list) {
      if (st[cell] !== OPEN) continue;
      st[cell] = need === open ? value : other(value);
      changed = true;
      if (writes) writes.push([cell, st[cell], i, kind]);
    }
  }
  return { conflict: -1, changed };
}

// 铅笔路径：一路刷到再也推不动。返回 { conflict, rounds }：conflict 是第一个自相矛盾的
// 节点下标（-1 = 没有），rounds 是刷了几遍 —— 越费遍数说明越要靠后面的格子反推前面的。
// 传 writes 就记下每一笔（哪格、什么方向、被哪个数字逼出来、用的哪条规则），提示照着说。
// 每轮至少写一笔，所以 n² 轮之内必定收敛；到顶就停，不靠它保证什么。
function derive(n, clue, st, writes) {
  for (let round = 1; round <= n * n + 1; round++) {
    const r = sweep(n, clue, st, writes);
    if (r.conflict >= 0) return { conflict: r.conflict, rounds: round };
    if (!r.changed) return { conflict: -1, rounds: round };
  }
  return { conflict: -1, rounds: n * n + 1 };
}

// 从空盘推到满盘：成功 ⇒ 题面唯一，并且纯逻辑可解（这就是生成器的验收单）。
export function logicSolve(n, clue) {
  const t = topo(n);
  const st = new Int8Array(t.n2);
  if (derive(n, clue, st, null).conflict >= 0) return null;
  for (let i = 0; i < t.n2; i++) if (st[i] === OPEN) return null;
  return rulesOk(n, clue, st) ? Array.from(st) : null;
}

// 拿玩家已经画下的线当已知数再刷一遍：冲突说明这一笔画死了自己。
export function reachable(n, clue, cells) {
  const g = Int8Array.from(cells);
  return derive(n, clue, g, null).conflict < 0;
}

// ---- 计数求解器：唯一性的第二套说法 --------------------------------------------------

// 猜一格再传播，数到 limit 个解就收手；预算烧完置 capped —— 半截的计数不配当证明。
export function countSolutions(spec, cap = 30000, opts = {}) {
  const n = spec.n;
  const clue = spec.clue;
  const limit = opts.limit || 2;
  const t = topo(n);
  const start = new Int8Array(t.n2);
  if (opts.given) for (let i = 0; i < t.n2; i++) if (opts.given[i] !== OPEN) start[i] = opts.given[i];
  let nodes = 0;
  let capped = false;
  let count = 0;
  let witness = null;

  const search = (state) => {
    if (capped || count >= limit) return;
    if (++nodes > cap) { capped = true; return; }
    const g = Int8Array.from(state);
    if (derive(n, clue, g, null).conflict >= 0) return;
    let pick = -1;
    for (let i = 0; i < t.n2; i++) {
      if (g[i] !== OPEN) continue;
      if (pick < 0) pick = i;
      const x = i % n;
      const y = (i - x) / n;
      // 挑贴着已有线的那个空格：猜它能最快把矛盾暴露出来
      if ((x > 0 && g[i - 1] !== OPEN) || (y > 0 && g[i - n] !== OPEN)) { pick = i; break; }
    }
    if (pick < 0) {
      if (rulesOk(n, clue, g)) {
        count++;
        if (!witness) witness = Array.from(g);
      }
      return;
    }
    for (const v of VALUES) {
      g[pick] = v;
      search(g);
      g[pick] = OPEN;
      if (capped || count >= limit) return;
    }
  };

  search(start);
  return { count, capped, nodes, witness };
}

// ---- 出题 -------------------------------------------------------------------------

const TIERS = [
  { key: 6, label: '6×6', tier: '入门', keep: 0.62, tries: 10, audit: 20000 },
  { key: 8, label: '8×8', tier: '进阶', keep: 0.5, tries: 10, audit: 20000 },
  { key: 10, label: '10×10', tier: '烧脑', keep: 0.42, tries: 8, audit: 20000 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

function randomSolution(n, rng) {
  const out = new Int8Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = rng.int(2) ? SLASH : BACK;
  return out;
}

// 贪心擦数字：顺序洗过，所以"哪些数字活下来"是 seed 的性质而不是扫描方向的性质。
// 每一刀都重跑铅笔路径 —— 擦完还推得完才收刀，否则把那个数字留回去。
function prune(n, clue, rng, target) {
  const out = Int8Array.from(clue);
  let kept = 0;
  for (const v of out) if (v !== NO_CLUE) kept++;
  const order = [];
  for (let i = 0; i < out.length; i++) if (out[i] !== NO_CLUE) order.push(i);
  for (const i of rng.shuffle(order)) {
    if (kept <= target) break;
    const before = out[i];
    out[i] = NO_CLUE;
    if (logicSolve(n, out) === null) out[i] = before;
    else kept--;
  }
  return out;
}

function specOf(n, cfg, clue, cells, seed, rank, solutions, capped) {
  let cluesGiven = 0;
  for (const v of clue) if (v !== NO_CLUE) cluesGiven++;
  return {
    kind: 'slant',
    n,
    clue: Array.from(clue),
    solution: Array.from(cells),
    par: n * n,
    cluesGiven,
    score: rank.score,
    rounds: rank.rounds,
    solutions,
    capped,
    seed: String(seed),
    tier: cfg.tier,
  };
}

// 难度读数：加权推导分 + 收敛遍数。两个都是"这张题面要人想多少下"的度量，只用来挑题，
// 不参与判定 —— 判定永远只看规则本身。
function deriveRank(n, clue) {
  const st = new Int8Array(n * n);
  const writes = [];
  const r = derive(n, clue, st, writes);
  let score = 0;
  for (const [, , , kind] of writes) score += RULE_W[kind];
  return { score: Math.round(score * 10) / 10, rounds: r.rounds };
}

export function generate(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  const target = Math.max(1, Math.round((n + 1) * (n + 1) * cfg.keep));
  const good = [];
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const sub = rng.fork(`s${attempt}`);
    const solution = randomSolution(n, sub);
    const clue = prune(n, cluesFrom(n, solution), sub, target);
    const cells = logicSolve(n, clue);
    if (!cells) continue;
    const { count, capped } = countSolutions({ n, clue }, cfg.audit);
    if (!capped && count !== 1) continue;                  // 数出第二个解：这种题面绝不交
    good.push(specOf(n, cfg, clue, solution, seed, deriveRank(n, clue), count, capped));
  }
  if (good.length) {
    // 篮子取样：挑"要来回刷几遍才推得完"的那半 —— 实测 6×6 的遍数是 3..6..11、10×10 是
    // 5..9..17，铺得很开；而推导分几乎不动（48..52），因为可推到底的盘必定写满 n² 格，
    // 只有"用的哪条规则"在变。所以遍数当主尺、分数只用来打破平手。
    good.sort((a, b) => b.rounds - a.rounds || b.score - a.score);
    return good[Math.min(good.length - 1, rng.int(Math.ceil(good.length / 2)))];
  }
  // 兜底：满数字盘（每个点都标数）必然推得完、必然唯一，只是没意思。宁可交无聊，不交错题。
  const solution = randomSolution(n, rngFrom(`${seed}#fb`));
  const clue = cluesFrom(n, solution);
  const { count, capped } = countSolutions({ n, clue }, cfg.audit);
  return specOf(n, cfg, clue, solution, seed, { score: n * n, rounds: 1 }, count, capped);
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const n = spec.n;
  const clue = Int8Array.from(spec.clue);
  const t = topo(n);
  const total = t.n2;
  let cells = new Uint8Array(total);
  let marks = new Uint8Array(total);        // 副笔记的事：记事用，不是落子
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let stroke = null;                        // 拖动途中沿用按下那一下的取值
  let doneAt = 0;

  const filled = () => {
    let c = 0;
    for (let i = 0; i < total; i++) if (cells[i] !== OPEN) c++;
    return c;
  };
  const solved = () => rulesOk(n, clue, cells);

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

  // 空格定下方向才收一步；换方向、擦掉都是手滑，不再另计一次（同数织的口径）。
  function setCell(i, next) {
    if (cells[i] === next) return false;
    snapshot();
    if (next !== OPEN && cells[i] === OPEN) moves++;
    marks[i] = 0;
    cells[i] = next;
    anim.set(i, nowMs());
    if (solved()) doneAt = nowMs();
    return true;
  }

  const nextOf = (v) => (v === OPEN ? SLASH : v === SLASH ? BACK : OPEN);

  const engine = {
    id: 'slant',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.46, t: 0.46, r: 0.46, b: 0.46 } },
    stats: () => ({ moves, par: spec.par || total, done: filled(), total }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    cellState: (x, y) => cells[y * n + x],
    nodeIndex: (x, y) => y * (n + 1) + x,

    // 报"哪几格正在让某个数字对不上"：只标矛盾节点上那些确实收到该点的格。
    badCells() {
      const bad = new Set();
      for (const i of violatedNodes(n, clue, cells)) {
        for (const [cell, value] of t.nodes[i]) if (cells[cell] === value) bad.add(cell);
      }
      return [...bad].sort((p, q) => p - q).map((i) => [i % n, (i - (i % n)) / n]);
    },

    down(x, y, btn = 0) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      const i = y * n + x;
      if (btn === 1) {
        if (cells[i] !== OPEN) return false;               // 已经定了线，不必再记
        snapshot();
        marks[i] = marks[i] ? 0 : 1;
        anim.set(i, nowMs());
        return true;
      }
      stroke = nextOf(cells[i]);
      return setCell(i, stroke);
    },

    // 按住拖过一片格：把起手那一笔的方向刷过去。五寸钉的解里常有成排的同一向，
    // 一笔画过去比逐格点十次更像人做事。
    move(x, y) {
      if (stroke === null || x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      return setCell(y * n + x, stroke);
    },

    up() { stroke = null; return false; },

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
      // 画错的一律先擦：拿错的线当已知数去做推理，推出来的"必然"全是空中楼阁。
      const wrong = [];
      for (let i = 0; i < total; i++) if (cells[i] !== OPEN && cells[i] !== spec.solution[i]) wrong.push(i);
      if (wrong.length) {
        const i = wrong[0];
        setCell(i, OPEN);
        return { cells: [[i % n, (i - (i % n)) / n]], note: '这一条与唯一解冲突，先擦掉它 —— 擦除不退已经付的那一步' };
      }
      const g = Int8Array.from(cells);
      const writes = [];
      if (derive(n, clue, g, writes).conflict < 0 && writes.length) {
        const [cell, value, node] = writes[0];
        if (setCell(cell, value)) {
          const nx = node % (n + 1);
          const ny = (node - nx) / (n + 1);
          return {
            cells: [[cell % n, (cell - (cell % n)) / n]],
            note: `第${ny + 1}行${nx + 1}列的数字逼出这一笔：它没有别的方向可画`,
          };
        }
      }
      for (let i = 0; i < total; i++) {
        if (cells[i] === OPEN && setCell(i, spec.solution[i])) {
          return { cells: [[i % n, (i - (i % n)) / n]], note: '规则推不动了，先要这一格：唯一解里它是这个方向' };
        }
      }
      return null;
    },

    draw(ctx, v, tt) {
      render(ctx, v, { clue, cells, marks, anim, t: tt, reveal: 0, done: solved() });
    },
    celebrate(ctx, v, tt, k) {
      render(ctx, v, { clue, cells, marks, anim, t: tt, reveal: k, done: true });
    },
  };

  return engine;
}

// ---- 渲染 -----------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  const n = cols;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  const c0 = (cols - 1) / 2;
  const c1 = (rows - 1) / 2;
  const span = Math.hypot(c0, c1) || 1;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * n + x;
      const t0 = s.anim.get(i);
      const p = !t0 || v.reduce ? 1 : clamp((s.t - t0) / 190, 0, 1);
      const wave = s.reveal ? 0.55 + 0.45 * easeOut(clamp(s.reveal * 2 - Math.hypot(x - c0, y - c1) / span, 0, 1)) : 1;
      const value = s.cells[i];
      if (value === OPEN) {
        if (s.marks[i]) crossMark(ctx, v, x, y, rgba(T.inkSoft, 0.5), 0.42);
        continue;
      }
      strokeDiagonal(ctx, v, x, y, value, p, rgba(T.ink, 0.9 * wave));
    }
  }

  // 数字画在交叉点上：先垫一块纸色圆，否则四条线穿过数字就糊了
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      const clue = s.clue[y * (n + 1) + x];
      if (clue === NO_CLUE) continue;
      const px = ox + x * cell;
      const py = oy + y * cell;
      ctx.save();
      ctx.fillStyle = rgba(T.card, 0.94);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      label(ctx, String(clue), px, py + cell * 0.02, { size: cell * 0.4, color: rgba(T.ink, 0.92), bold: true, mono: true });
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
      const i = y * n + x;
      const next = s.cells[i] === OPEN ? SLASH : s.cells[i] === SLASH ? BACK : OPEN;
      // 预览就是下一次点下去的样子：要变出的线画成主色，要被擦掉的线用告警色淡抹
      if (next === OPEN) strokeDiagonal(ctx, v, x, y, s.cells[i], 1, rgba(T.warn, 0.3 + 0.14 * pulse(s.t)));
      else strokeDiagonal(ctx, v, x, y, next, 1, rgba(T.accent, 0.26 + 0.16 * pulse(s.t)));
    }
  }
}

// p 是"这一笔正在画"的进度：从格心往两端长出来，落笔才有手感。
function strokeDiagonal(ctx, v, x, y, value, p, color) {
  const { cell, ox, oy } = v;
  const x0 = ox + x * cell;
  const y0 = oy + y * cell;
  const a = value === SLASH ? [x0, y0 + cell] : [x0, y0];
  const b = value === SLASH ? [x0 + cell, y0] : [x0 + cell, y0 + cell];
  const k = easeOut(clamp(p, 0, 1));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.6, cell * 0.11);
  ctx.beginPath();
  ctx.moveTo(mx + (a[0] - mx) * k, my + (a[1] - my) * k);
  ctx.lineTo(mx + (b[0] - mx) * k, my + (b[1] - my) * k);
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'slant',
  title: '五寸钉',
  latin: 'SLANT',
  tagline: '每格一条斜线，数字数它周围的线头',
  unit: '格',
  rules: [
    '每个格子都要画一条斜线，要么 "/"、要么 "\\"，不能有格子空着。',
    '交叉点上的数字 = 四周四条线里端点收在这个点上的条数；0 也是真数字，意思是"一条都不许收到这儿"。',
    '斜线只有两个方向，所以每个数字只是一道加法：还差几条、还剩几格可放。',
    '主笔在空格里点出 "/"，再点换成 "\\"，再点擦掉（只有空格定下方向算一步）；按住拖动可以把同一方向一路画过去。',
    '副笔在空格上记一个小叉，只当备忘录，不算落子。',
  ],
  sizes: TIERS.map(({ key, label: lb, tier }) => ({ key, label: lb, tier })),
  generate,
  create,
};
