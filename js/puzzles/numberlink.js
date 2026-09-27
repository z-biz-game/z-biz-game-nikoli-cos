// 数链 / Number Link —— 同色两端连成一条线，并且整盘一格不留。
//
// 难点不在"怎么连"，在"怎么出一道只有一种连法的题"。生成器两步走：
//   · 构造：先要一条哈密顿路径（走遍 n² 格、每格恰一次），把它切成 k 段，
//     每段两端就是一对圆点。k 段正好铺满那条路径，所以"有解"是构造给的，不用搜。
//   · 证明：用 countSolutions 逐条线枚举全部自avoiding走法，数到第二种就丢题重造。
// 只验第一条路径不够 —— 那只能证明有解；唯一解才是数链作为一道题的全部价值，
// 因为它让"提示"有唯一答案，也让玩家的每条线一旦连上就不用再动别人。
//
// 剪枝是一条硬账：每条未排的线至少要占 manhattan+1 格，空格不够这个总数就当场折回。
// 下界对网格上任何不重复路径都成立，所以它只砍掉走不通的分支，不会误杀真解。
// 预算耗尽时返回 exhausted —— 生成器据此丢题，绝不把"没搜完"当成"只有一种解"。
//
// par = n²：通关必须覆盖 n² 格，而 moves 数的是"空格变满"这件事发生了几次，
// 所以任何通关都 ≥ n²，一次干净的拖完正好等于 n²。擦掉重画要再记一遍 ——
// 浪费的是手，不是格子。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, rgba, pulse, paper } from '../core/paper.js';

export const EMPTY = -1;

const idx = (x, y, n) => y * n + x;
const xyOf = (i, n) => [i % n, (i - (i % n)) / n];

export function neighbors(i, n) {
  const [x, y] = xyOf(i, n);
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y > 0) out.push(i - n);
  if (y < n - 1) out.push(i + n);
  return out;
}

const manhattan = (a, b, n) => {
  const [ax, ay] = xyOf(a, n);
  const [bx, by] = xyOf(b, n);
  return Math.abs(ax - bx) + Math.abs(ay - by);
};

// ---- 构造：哈密顿路径 + 切段 ----------------------------------------------------

// 随机深度优先。网格图上哈密顿路径极常见，随机序通常几步退让就走通；
// 给它节点预算，超了退回确定的蛇形路径 —— 蛇形一定走遍每格，所以生成器不会"造不出题"。
export function hamiltonianPath(n, rng, maxNodes = 40000) {
  const total = n * n;
  const path = new Int32Array(total).fill(-1);
  const used = new Uint8Array(total);
  let nodes = 0;
  path[0] = rng.int(total);
  used[path[0]] = 1;

  const step = (depth) => {
    if (depth === total) return true;
    for (const v of rng.shuffle(neighbors(path[depth - 1], n))) {
      if (++nodes > maxNodes) return false;
      if (used[v]) continue;
      path[depth] = v;
      used[v] = 1;
      if (step(depth + 1)) return true;
      used[v] = 0;
      path[depth] = -1;
    }
    return false;
  };

  return step(1) ? Array.from(path) : serpentine(n);
}

// 蛇形：逐行走、行间换向。随机挑行序仍然是哈密顿的（相邻行同列相接）
function serpentine(n) {
  const out = [];
  for (let y = 0; y < n; y++) {
    for (let j = 0; j < n; j++) {
      const x = y % 2 ? n - 1 - j : j;
      out.push(idx(x, y, n));
    }
  }
  return out;
}

// 切成 k 段：每段至少 2 格（单格段的两端重合，那不是一对讲法）。
// 余量随机分给前几段，最后一段兜住误差 —— 段和恒等于 n²。
export function cutPath(path, k, rng) {
  const min = 2;
  if (k * min > path.length) k = Math.floor(path.length / min);
  let left = path.length - k * min;
  const lens = [];
  for (let t = 0; t < k; t++) {
    const give = t === k - 1 ? left : rng.range(0, left);   // range 两端都含，取 left 才不越账
    lens.push(min + give);
    left -= give;
  }
  const segs = [];
  let at = 0;
  for (const len of lens) {
    segs.push(path.slice(at, at + len));
    at += len;
  }
  return segs;
}

// ---- 证明：数清有几种连法 -------------------------------------------------------

// 逐条线放置。order 按直线距离升序：越受限的线先排，分支因子掉得最快。
// 返回 { count, exhausted, witness }：witness 是第一遍找到的完整铺法（按 order 的顺序）。
export function countSolutions(n, pairs, { limit = 2, budget = 200000 } = {}) {
  const total = n * n;
  const occupied = new Int8Array(total).fill(EMPTY);
  const owner = new Int8Array(total).fill(EMPTY);       // 端点归属：别人的端点不能踩
  pairs.forEach((p, t) => { owner[p[0]] = t; owner[p[1]] = t; });

  const order = pairs
    .map((p, t) => ({ t, d: manhattan(p[0], p[1], n) }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.t);
  const need = order.map((t) => manhattan(pairs[t][0], pairs[t][1], n) + 1);
  const suffix = new Array(order.length + 1).fill(0);   // 第 j 条之后所有线的最小占地
  for (let j = order.length - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + need[j];

  let nodes = 0;
  let count = 0;
  let exhausted = false;
  let witness = null;
  const placed = order.map(() => []);

  const dfs = (oj, freeLeft) => {
    if (++nodes > budget) { exhausted = true; return true; }
    if (oj === order.length) {
      if (freeLeft > 0) return false;                   // 经典规则：一格都不许空着
      count++;
      if (!witness) witness = placed.map((p) => p.slice());
      return count >= limit;
    }
    const t = order[oj];
    const [a, b] = pairs[t];
    const line = new Int32Array(total).fill(-1);
    const onPath = new Uint8Array(total);
    line[0] = a;
    onPath[a] = 1;
    occupied[a] = t;

    const walk = (cur, depth) => {
      if (cur === b) {
        const cells = Array.from(line.slice(0, depth + 1));
        if (freeLeft - cells.length < suffix[oj + 1]) return false;
        for (const c of cells) occupied[c] = t;
        placed[oj] = cells;
        const stop = dfs(oj + 1, freeLeft - cells.length);
        for (const c of cells) occupied[c] = EMPTY;
        return stop;
      }
      for (const v of neighbors(cur, n)) {
        if (++nodes > budget) { exhausted = true; return true; }
        if (owner[v] !== EMPTY && owner[v] !== t) continue;   // 别人的圆点不能踩
        if (occupied[v] !== EMPTY || onPath[v]) continue;     // 已排的线、自己的自交
        line[depth + 1] = v;
        onPath[v] = 1;
        const stop = walk(v, depth + 1);
        onPath[v] = 0;
        line[depth + 1] = -1;
        if (stop) return true;
      }
      return false;
    };

    const stop = walk(a, 0);
    occupied[a] = EMPTY;
    return stop;
  };

  dfs(0, total);
  return { count, exhausted, nodes, witness };
}

// 一条完整答案的体检：每对端点各自连成不重复的单位步折线、线之间不共用格子、并且铺满。
export function verifySolution(n, pairs, solution) {
  const seen = new Uint8Array(n * n);
  for (let t = 0; t < solution.length; t++) {
    const p = solution[t];
    if (p.length < 2) return false;
    const ends = [pairs[t][0], pairs[t][1]];
    if (!ends.includes(p[0]) || !ends.includes(p[p.length - 1]) || p[0] === p[p.length - 1]) return false;
    for (let d = 0; d < p.length; d++) {
      if (seen[p[d]]) return false;
      seen[p[d]] = 1;
      if (d && !neighbors(p[d - 1], n).includes(p[d])) return false;
    }
    if (new Set(p).size !== p.length) return false;
  }
  for (let i = 0; i < n * n; i++) if (!seen[i]) return false;
  return true;
}

// ---- 出题档位 -------------------------------------------------------------------
// 尺寸同时是预算档位：唯一性检查是指数级的，而且随机切段的命中率随尺寸断崖下跌。
// 实测（每档 300 次切段）4×4 四对约四成、5×5 五对约半成、6×6 十对约一分二，
// 7×7 三千次零中 —— 段数越多、每段越短，铺满的约束才越紧，唯一解才越常见。
// 所以这里只卖能保证唯一解的三档：与其悄悄上一道有两种连法的 7×7，不如没这档。
// tries 按 1/命中率 放大到千次量级：期望几十次就中，最坏有上限，不会把玩家卡在加载上。
const TIERS = [
  { key: 4, label: '4×4', tier: '入门', k: 4, budget: 60000, tries: 300 },
  { key: 5, label: '5×5', tier: '经典', k: 5, budget: 150000, tries: 1200 },
  { key: 6, label: '6×6', tier: '进阶', k: 10, budget: 200000, tries: 1500 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

export function generate(seed, sizeKey = 5) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const segs = cutPath(hamiltonianPath(n, rng.fork()), cfg.k, rng.fork());
    const pairs = segs.map((s) => [s[0], s[s.length - 1]]);
    const { count, exhausted } = countSolutions(n, pairs, { budget: cfg.budget });
    if (exhausted || count !== 1) continue;
    return {
      kind: 'numberlink',
      n,
      k: cfg.k,
      pairs,
      solution: segs,
      par: n * n,
      seed: String(seed),
      tier: cfg.tier,
    };
  }
  // 预算内没撞上唯一解（7×7 上不常见但不可能排除）。宁可给一道"只保证有解"的题，
  // 也不给一道无解的题：前者只是玩家也许会找到第二种连法，后者是程序坏了。
  const segs = cutPath(serpentine(n), cfg.k, rng);
  return {
    kind: 'numberlink',
    n,
    k: segs.length,
    pairs: segs.map((s) => [s[0], s[s.length - 1]]),
    solution: segs,
    par: n * n,
    seed: String(seed),
    tier: cfg.tier,
    degraded: true,
  };
}

// ---- 引擎 -----------------------------------------------------------------------

export function create(spec) {
  const n = spec.n;
  const total = n * n;
  const k = spec.pairs.length;
  const owner = new Int8Array(total).fill(EMPTY);       // 哪格是谁的端点（画线时不可越界）
  spec.pairs.forEach((p, t) => { owner[p[0]] = t; owner[p[1]] = t; });

  let links = Array.from({ length: k }, () => []);      // links[t] = 从起手端点到线头的格子序列
  const cells = new Int8Array(total).fill(EMPTY);       // 反查：这格被哪条线占着
  let covered = 0;
  let moves = 0;
  let stroke = EMPTY;
  const undoStack = [];
  const redoStack = [];

  // 快照只搬盘面，不搬 moves：画了又擦是一次试错，那一笔得留在账上（四家同一口径）。
  const pack = () => ({ links: links.map((p) => p.slice()), covered });
  const push = (stack) => {
    stack.push(pack());
    if (stack.length > 200) stack.shift();
  };

  function apply(snap) {
    links = snap.links.map((p) => p.slice());
    cells.fill(EMPTY);
    covered = 0;
    links.forEach((p, t) => { for (const i of p) { cells[i] = t; covered++; } });
  }

  const clearLink = (t) => {
    for (const i of links[t]) { cells[i] = EMPTY; covered--; }
    links[t] = [];
  };

  const connected = (t) => {
    const p = links[t];
    if (p.length < 2) return false;
    const [a, b] = spec.pairs[t];
    return (p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a);
  };

  const solved = () => covered === total && links.every((_, t) => connected(t));

  function begin(i) {
    const t = owner[i];
    if (t === EMPTY) return false;          // 只有圆点能起手：从半路接笔会造出说不清的形状
    push(undoStack);
    redoStack.length = 0;
    if (connected(t)) clearLink(t);         // 连上了还点它 = 重画这条线
    const head = links[t].length ? links[t][links[t].length - 1] : EMPTY;
    if (head !== i) {
      if (head !== EMPTY) clearLink(t);     // 从另一端起手：先擦干净，方向只有一个
      links[t] = [i];
      if (cells[i] === EMPTY) { cells[i] = t; covered++; moves++; }
    }
    stroke = t;
    return true;
  }

  function extend(i) {
    if (stroke === EMPTY) return false;
    const t = stroke;
    const p = links[t];
    const head = p[p.length - 1];
    if (i === head || !neighbors(head, n).includes(i)) return false;   // 指针跳格不算，只认上下左右
    const back = p.indexOf(i);
    if (back >= 0) {
      // 拖回自己 = 截断。擦掉的格子会空出来，但 moves 不退账 —— 它数的是落子，不是存量
      for (let d = p.length - 1; d > back; d--) {
        const dead = p.pop();
        cells[dead] = EMPTY;
        covered--;
      }
      return true;
    }
    if (cells[i] !== EMPTY) return false;                              // 不穿别人的线
    if (owner[i] !== EMPTY && owner[i] !== t) return false;            // 也不踩别人的圆点
    p.push(i);
    cells[i] = t;
    covered++;
    moves++;
    return true;
  }

  const engine = {
    id: 'numberlink',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.2, t: 0.2, r: 0.2, b: 0.2 } },
    stats: () => ({ moves, par: spec.par || total, done: covered, total }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    cellState: (x, y) => cells[idx(x, y, n)] + 1,     // 0 = 空着，t+1 = 第 t 条线
    endpointOf: (x, y) => owner[idx(x, y, n)],
    pathOf: (t) => links[t].slice(),
    connected,
    // 数链没有"与题面矛盾"的格子：任何一条线都能从端点擦掉重画，绕远不是走错。
    // 与其编一个假的红框，不如什么都不闪（和点灯同一个理由）。
    badCells: () => [],

    down(x, y) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      return begin(idx(x, y, n));
    },
    move(x, y) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      return extend(idx(x, y, n));
    },
    up() {
      if (stroke === EMPTY) return false;
      stroke = EMPTY;
      return true;
    },

    undo() {
      if (!undoStack.length) return false;
      push(redoStack);
      apply(undoStack.pop());
      stroke = EMPTY;
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      push(undoStack);
      apply(redoStack.pop());
      stroke = EMPTY;
      return true;
    },

    hint() {
      if (solved()) return null;
      // 唯一解就存在 spec 里，所以提示可以只交出一格，而不是把答案整条倒出来。
      // 先修画歪的线（玩家离答案最近），再开一条没碰过的。
      let t = links.findIndex((p, j) => p.length && !isPrefix(p, spec.solution[j]));
      if (t < 0) t = links.findIndex((p) => !p.length);
      if (t < 0) t = links.findIndex((_, j) => !connected(j));
      if (t < 0) return null;
      push(undoStack);
      redoStack.length = 0;
      const want = orient(links[t], spec.solution[t]);
      const keep = commonPrefix(links[t], want);
      clearLink(t);
      let last = want[0];
      for (let d = 0; d <= keep + 1 && d < want.length; d++) {
        const i = want[d];
        links[t].push(i);
        if (cells[i] === EMPTY) { cells[i] = t; covered++; moves++; }
        last = i;
      }
      const [hx, hy] = xyOf(last, n);
      return {
        cells: [[hx, hy]],
        note: `第 ${t + 1} 号线接着走这一格（唯一解里的一步），整盘还差 ${total - covered} 格`,
      };
    },

    draw(ctx, v, t) {
      render(ctx, v, { links, owner, spec, k, n, t, reveal: 0, done: solved() });
    },
    celebrate(ctx, v, t, reveal) {
      render(ctx, v, { links, owner, spec, k, n, t, reveal, done: true });
    },
  };

  return engine;
}

// 玩家可以从任一端起手，所以比对之前先把唯一解摆成同向的那一条
function orient(p, want) {
  const rev = want.slice().reverse();
  return commonPrefix(p, rev) > commonPrefix(p, want) ? rev : want;
}

// links[t] 是否正好是唯一解那条线的前缀（两端方向都认）
function isPrefix(p, want) {
  return commonPrefix(p, want) === p.length || commonPrefix(p, want.slice().reverse()) === p.length;
}

export function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// ---- 渲染 -----------------------------------------------------------------------

const hueOf = (t) => T.hues[t % T.hues.length];

function center(v, i, n) {
  const [x, y] = xyOf(i, n);
  return [v.ox + x * v.cell + v.cell / 2, v.oy + y * v.cell + v.cell / 2];
}

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  // 通关波：按线的顺序一圈圈推出去，比整盘同时变亮更像"收笔"
  const wave = (t) => (s.reveal ? 0.35 + 0.65 * clamp01(s.reveal * (s.k + 1) - t) : 1);

  for (let t = 0; t < s.k; t++) {
    const p = s.links[t];
    if (p.length < 2) continue;
    ctx.save();
    ctx.globalAlpha = wave(t);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(hueOf(t), 0.22);
    ctx.lineWidth = cell * 0.46;
    trace(ctx, p, s.n, v);
    ctx.stroke();
    ctx.strokeStyle = rgba(hueOf(t), 0.95);
    ctx.lineWidth = cell * (v.reduce ? 0.22 : 0.3);
    trace(ctx, p, s.n, v);
    ctx.stroke();
    ctx.restore();
  }

  for (let t = 0; t < s.k; t++) nub(ctx, v, s, t, wave(t));

  if (v.hover && !s.reveal && !s.done && !v.reduce) {
    const i = idx(v.hover.x, v.hover.y, s.n);
    if (s.owner[i] >= 0) halo(ctx, v, i, s.n, s.t);
  }
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function trace(ctx, p, n, v) {
  ctx.beginPath();
  p.forEach((i, d) => {
    const [cx, cy] = center(v, i, n);
    if (d) ctx.lineTo(cx, cy);
    else ctx.moveTo(cx, cy);
  });
}

// 圆点：先垫一圈纸色把线"压"下去，再落本体和编号 —— 编号压在走线上会糊
function nub(ctx, v, s, t, alpha) {
  const [a, b] = s.spec.pairs[t];
  for (const i of [a, b]) {
    const [cx, cy] = center(v, i, s.n);
    const r = v.cell * 0.29;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(T.paper, 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, r + v.cell * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(hueOf(t), 0.98);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#fffdf6', 0.55);
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.34, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#fffdf6', 0.95);
    ctx.font = `${Math.round(v.cell * 0.32)}px ${T.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t + 1), cx, cy + 1);
    ctx.restore();
  }
}

// 还没起手的圆点给一圈呼吸的淡环：规则只有一句"从端点拖出去"，但要用手指确认一次
function halo(ctx, v, i, n, t) {
  const [cx, cy] = center(v, i, n);
  ctx.save();
  ctx.strokeStyle = rgba(T.accent, 0.24 + 0.14 * pulse(t));
  ctx.lineWidth = Math.max(1, v.cell * 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, v.cell * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'numberlink',
  title: '数链',
  latin: 'NUMBER LINK',
  tagline: '同色两端连成线，整盘一格不留',
  unit: '格',
  rules: [
    '每对同色圆点连成一条线：只能上下左右，不能穿过别的线，也不能压住自己的线。',
    '全部连上还不算赢 —— 经典规则要求整盘铺满，剩一格空着就还没解完。',
    '拖回自己已经画过的格子会把线截断，截断不退账，所以"落了几格"才是这关的代价。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
