// 孔明棋 / Peg Solitaire（独立钻石）—— 横或竖跳过相邻一子、落进前方空孔，被跳过的子拿出盘。
// 目标：盘上最后只剩一子。
//
// 状态天生是位图。37 个孔 = 37 位，这里用 (lo, hi) 两个 32 位整数而不是 BigInt：合并成
// `hi * 2^32 + lo` 是一个不超过 2^37 的 Number，能直接当记忆化的 key，比 BigInt 在 DFS
// 里快一个量级（求解器一次要摸几十万个局面）。二维数组更不行 —— 它当不了 key，还会把
// "谁是谁的邻居"退化成每步现算。所以：孔位坐标表按行优先编号、编号即位序，邻居表与
// 跳跃表在造盘面时一次算完，之后引擎和求解器只查表。
//
// 三件事共用同一张有向跳跃表 {a→b→c}：
//   · solve()     —— DFS + 记忆化，节点数封顶。宁可提示不出来，也不能把主线程卡死。
//   · generate()  —— 从"只剩一子"的终局**倒放**（a 有子、b 与 c 都空 → 挪走 a、补上
//                    b 与 c），倒出来的开局天然有解；再用 solve() 正放复核一遍，
//                    倒放写反了会在这一步露馅。
//   · hint()      —— 玩家还在生成时记下的最优走法上就照着给；一旦偏离就现搜，现搜不
//                    出来就返回 null（外壳会提示"这条路堵住了"）。
//
// 每步恰好吃掉一子，所以"起始子数 − 1"是**可证明**的步数下界：任何通关打法都不可能少
// 于它，par 因此跟着起始子数走，而不是拍出来的常数。也正因为如此，任何一条完整走法都是
// 最优走法 —— 提示只要能带着玩家走到只剩一子，就自动保住了三星的步数线。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { roundRect, rgba, lerp, easeOut, clamp, pulse, paper, rules } from '../core/paper.js';

const TAU = Math.PI * 2;

const JUMP_MS = 230;      // 一次跳跃的位移时长：看得出"这颗子飞过去了"，又不挡住连点
const REVERSE_CAP = 200000;  // 倒放的节点预算（每档从目标子数往下退，超了就降一档重来）
const HINT_CAP = 120000;  // 提示现搜的预算：最坏耗时要留在手机可接受的范围里
const SOLVE_FLOOR = 12;   // 起始子数下界：再低就不像一局棋了

// ---- 位图：两个 32 位整数 ------------------------------------------------------------
//
// hi 最多用到第 4 位（37 孔），永远碰不到符号位；lo 会，所以比较全在同一侧做，
// 只有跨边界（记忆化 key、对外 JSON）时才 `>>> 0` 转成无符号。

const POP = new Uint8Array(1 << 16);
for (let i = 1; i < POP.length; i++) POP[i] = POP[i >> 1] + (i & 1);

export function popcount(lo, hi) {
  const l = lo >>> 0;
  return POP[l & 0xffff] + POP[l >>> 16] + POP[(hi >>> 0) & 0xffff];
}

const keyOf = (lo, hi) => (hi >>> 0) * 4294967296 + (lo >>> 0);
const bitsOfKey = (key) => [(key % 4294967296) | 0, Math.floor(key / 4294967296) | 0];
const bitOf = (i) => (i < 32 ? { lo: 1 << i, hi: 0 } : { lo: 0, hi: 1 << (i - 32) });

export function holesToBits(list) {
  let lo = 0;
  let hi = 0;
  for (const i of list) {
    if (i < 32) lo |= 1 << i;
    else hi |= 1 << (i - 32);
  }
  return [lo | 0, hi | 0];
}

export function bitsToHoles(lo, hi) {
  const out = [];
  const l = lo >>> 0;
  const h = hi >>> 0;
  for (let i = 0; i < 32; i++) if ((l >>> i) & 1) out.push(i);
  for (let i = 0; i < 16; i++) if ((h >>> i) & 1) out.push(32 + i);
  return out;
}

// ---- 盘面：孔位坐标表 + 预计算跳跃表 --------------------------------------------------
//
// 形状写成行字符串（和数织的像素图同一手法，肉眼可校对）：'#' 是孔。改形状可以，把老
// spec 的位图喂给新形状不行 —— "行优先编号即位序"是这里唯一的存档兼容契约。

const SHAPES = {
  // 25 孔小十字：5×5 十字（21 孔）向四个尖各伸出一格，每行 1,3,5,7,5,3,1
  cross: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  // 33 孔英式：7×7 挖掉四个 2×2 的角；中心空即经典开局
  english: ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
  // 37 孔法式：英式在四个"内角"上各加一孔（即把 2×2 的缺口切成斜角）。
  // 注意加的不是最外面那四个角 —— 7×7 的绝对角孔不属于任何一条跳跃线，落在那儿的子
  // 既跳不走也吃不掉，开局一旦填满就永远解不到只剩一子。
  french: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function shapeHoles(shape) {
  const holes = [];
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape.length; x++) if (shape[y][x] === '#') holes.push([x, y]);
  }
  return holes;
}

// 造一张盘面表：格坐标 ↔ 孔索引互查、有向跳跃三元组、按起点/中点/落点分好类的索引表。
export function makeBoard(name, holes, side) {
  const s = side || holes.reduce((a, h) => Math.max(a, h[0] + 1, h[1] + 1), 1);
  const n = holes.length;
  const index = new Int16Array(s * s).fill(-1);
  holes.forEach(([x, y], i) => { index[y * s + x] = i; });
  const at = (x, y) => (x < 0 || y < 0 || x >= s || y >= s ? -1 : index[y * s + x]);
  const center = at(s >> 1, s >> 1);
  if (center < 0) throw new Error(`盘面 ${name} 的中心 ${s >> 1},${s >> 1} 不是孔`);

  // 起点固定、方向固定，所以每条三线恰好产出两个有向跳法（正向与反向），不重不漏 ——
  // "跳跃表双向对称"这条测试断言的就是它。
  const list = [];
  const degree = new Int32Array(n);
  for (let a = 0; a < n; a++) {
    const [ax, ay] = holes[a];
    for (const [dx, dy] of DIRS) {
      const b = at(ax + dx, ay + dy);
      const c = at(ax + 2 * dx, ay + 2 * dy);
      if (b < 0 || c < 0) continue;
      list.push({ a, b, c });
      degree[a]++; degree[b]++; degree[c]++;
    }
  }
  list.sort((p, q) => p.a - q.a || p.b - q.b || p.c - q.c);

  const J = list.length;
  const abLo = new Int32Array(J);   // 起+中：正放要求这两格都有子
  const abHi = new Int32Array(J);
  const bLo = new Int32Array(J);    // 倒放要逐格判空，所以中点也得单独存一份
  const bHi = new Int32Array(J);
  const cLo = new Int32Array(J);    // 落点：正倒两向都要求它空着
  const cHi = new Int32Array(J);
  const mLo = new Int32Array(J);    // 三格合并掩码：异或一次就完成移动（正倒同一条）
  const mHi = new Int32Array(J);
  const ja = new Int32Array(J);
  const jb = new Int32Array(J);
  const jc = new Int32Array(J);
  const byFrom = Array.from({ length: n }, () => []);
  list.forEach((m, k) => {
    const A = bitOf(m.a);
    const B = bitOf(m.b);
    const C = bitOf(m.c);
    ja[k] = m.a; jb[k] = m.b; jc[k] = m.c;
    abLo[k] = (A.lo | B.lo) | 0; abHi[k] = (A.hi | B.hi) | 0;
    bLo[k] = B.lo | 0; bHi[k] = B.hi | 0;
    cLo[k] = C.lo | 0; cHi[k] = C.hi | 0;
    mLo[k] = (A.lo | B.lo | C.lo) | 0; mHi[k] = (A.hi | B.hi | C.hi) | 0;
    byFrom[m.a].push(k);
  });

  const [allLo, allHi] = holesToBits(Array.from({ length: n }, (_, i) => i));
  const cb = bitOf(center);

  // 求解器的候选顺序。单一顺序的 DFS 会在"看起来不错其实走进死地"的分枝上烧掉几十万
  // 节点，而换一种顺序往往几百节点就出解 —— 所以一次造好几种，solve() 依次试、
  // 共用同一份"已判无解"集合（前一序的失败证明对后一序同样成立）。
  const cc = (s - 1) / 2;
  const dist = holes.map(([x, y]) => Math.hypot(x - cc, y - cc));
  const by = (cmp) => {
    const idx = Array.from({ length: J }, (_, i) => i).sort((p, q) => cmp(p, q) || p - q);
    return Int32Array.from(idx);
  };
  const orders = [
    by((p, q) => p - q),                                   // 表序（孔索引升序）：稳定、可复现
    by((p, q) => dist[ja[q]] - dist[ja[p]]),               // 先剥外圈：起手段离中心越远越先走
    by((p, q) => dist[jc[p]] - dist[jc[q]]),               // 先落中心：往里收，别把子送出去
    by((p, q) => (dist[ja[q]] - dist[jc[q]]) - (dist[ja[p]] - dist[jc[p]])),   // 先做"向内位移最大"的跳
  ];

  return {
    name, side: s, count: n, holes, index, center, degree, list, byFrom, orders,
    ja, jb, jc, abLo, abHi, bLo, bHi, cLo, cHi, mLo, mHi,
    allLo, allHi, centerLo: cb.lo | 0, centerHi: cb.hi | 0,
  };
}

export const BOARDS = {};
for (const name of Object.keys(SHAPES)) {
  BOARDS[name] = makeBoard(name, shapeHoles(SHAPES[name]), SHAPES[name].length);
}

// create() 认 spec 里的孔表：手工题面（测试里的死局、三孔小盘）也能直接跑，代价只是
// 一次查表构造。同一张孔表只造一遍，缓存在 boardCache 里。
const boardCache = new Map();

export function boardFrom(spec) {
  const named = spec.board ? BOARDS[spec.board] : null;
  if (!spec.holes || !spec.holes.length) {
    if (!named) throw new Error(`spec 既没有孔位表也没有可认的盘型名：${spec.board}`);
    return named;
  }
  if (named && named.count === spec.holes.length && named.side === (spec.side || named.side)) return named;
  const side = spec.side || spec.holes.reduce((a, h) => Math.max(a, h[0] + 1, h[1] + 1), 1);
  const key = `${side}|${spec.holes.map((h) => `${h[0]},${h[1]}`).join(';')}`;
  let b = boardCache.get(key);
  if (!b) {
    b = makeBoard(spec.board || 'custom', spec.holes, side);
    boardCache.set(key, b);
  }
  return b;
}

export function holeAt(board, x, y) {
  const s = board.side;
  if (x < 0 || y < 0 || x >= s || y >= s) return -1;
  return board.index[y * s + x];
}

export function has(board, lo, hi, i) {
  return i < 32 ? ((lo >>> i) & 1) === 1 : ((hi >>> (i - 32)) & 1) === 1;
}

const blocked = (lo, hi, l, h) => (lo & l) !== 0 || (hi & h) !== 0;
const holding = (lo, hi, l, h) => (lo & l) === l && (hi & h) === h;

// 正放：a、b 有子且 c 空着。
export function legalMoves(board, lo, hi) {
  const out = [];
  for (let k = 0; k < board.list.length; k++) {
    if (!holding(lo, hi, board.abLo[k], board.abHi[k])) continue;
    if (blocked(lo, hi, board.cLo[k], board.cHi[k])) continue;
    out.push({ ...board.list[k], k });
  }
  return out;
}

// 倒放：a 有子、b 与 c 都空着 —— 和正放同为"异或掩码"，只是可应用的条件互斥。
// 同一条三元组在这两个判定下必居其一或都不成立，所以倒放序列整体取反就是合法正解。
export function reverseMoves(board, lo, hi) {
  const out = [];
  for (let k = 0; k < board.list.length; k++) {
    if (!has(board, lo, hi, board.ja[k])) continue;
    if (blocked(lo, hi, board.bLo[k] | board.cLo[k], board.bHi[k] | board.cHi[k])) continue;
    out.push({ ...board.list[k], k });
  }
  return out;
}

export function applyMove(board, k, lo, hi) {
  return [(lo ^ board.mLo[k]) | 0, (hi ^ board.mHi[k]) | 0];
}

// 反查：给定三个孔找那条有向跳法（spec 里的 plan 只存孔索引，落子要换算成掩码下标）。
export function jumpIndex(board, a, b, c) {
  for (const k of board.byFrom[a]) if (board.jb[k] === b && board.jc[k] === c) return k;
  return -1;
}

// ---- 求解器 ------------------------------------------------------------------------
//
// DFS + 只记"已判定无解"局面的记忆化。集合里每一项都是一个证明，所以只要没超节点上限，
// 返回 null 就等于"这条路真的堵死了"；超上限时证明不完整，用 capped 让整层立刻展开，
// 不把半成品当成结论。递归深度 = 剩余步数 ≤ 36，不需要手动栈。
// 候选顺序按 board.orders 换着试：同一个局面在表序下要烧二十万节点，换成"先剥外圈"可能
// 三百节点就出解，而跨顺序累积的失败证明让第二遍不是重头再来。

export function solve(board, lo, hi, cap = HINT_CAP, stats = null) {
  const dead = new Set();
  const path = [];
  let nodes = 0;
  let capped = false;
  let best = null;

  const go = (l, h, order) => {
    if (capped) return false;
    if (popcount(l, h) === 1) return true;
    const key = keyOf(l, h);
    if (dead.has(key)) return false;
    if (++nodes > cap) { capped = true; return false; }
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      if (!holding(l, h, board.abLo[k], board.abHi[k])) continue;
      if (blocked(l, h, board.cLo[k], board.cHi[k])) continue;
      path.push(k);
      if (go((l ^ board.mLo[k]) | 0, (h ^ board.mHi[k]) | 0, order)) return true;
      path.pop();
      if (capped) return false;
    }
    if (!capped) dead.add(key);
    return false;
  };

  for (const order of board.orders) {
    // cap 是整次调用的预算，不是每一序的预算：烧完就是没烧完，换个候选顺序也不能把
    // 半成品结论洗成证明。所以这里一旦触顶就如实带着 capped=true 收工。
    if (nodes >= cap) { capped = true; break; }
    if (go(lo | 0, hi | 0, order)) { best = path.map((k) => ({ ...board.list[k], k })); break; }
  }
  if (stats) { stats.nodes = nodes; stats.dead = dead.size; stats.capped = capped; }
  return best;
}

// ---- 生成器：从终局倒放 --------------------------------------------------------------

// 从"只剩一子"的随机终局出发，随机倒放 depth 步（每步加一子），返回落点局面与把它正放
// 回终局的走法 —— 倒放出来的开局天然有解，走法序列反着念就是解。
//   · opts.goal(lo, hi) 在到达指定深度时判定局面是否合格（默认只看深度）。一个局面只要
//     试过走不通就进 seen，换起始那颗子也不再进去：跨终局共享记忆化，才让"再试一个终局"
//     不是从头再来。
//   · 候选按"经过线条少的孔先补"排序：角孔和尖孔只有在特定三线全空时才补得进去，留到
//     后面几乎必卡。随机序打底再按难度升序，等于给随机搜索加了一条最难优先的贪心。
// 找不到合格局面就返回 null，调用方把目标子数降一档再来。
export function reversePlay(board, depth, rng, opts = {}) {
  const cap = opts.cap || REVERSE_CAP;
  const goal = opts.goal || null;
  const seen = new Set();
  const used = [];
  let nodes = 0;
  let stop = false;
  let found = null;

  const dfs = (l, h) => {
    if (stop) return false;
    const key = keyOf(l, h);
    if (seen.has(key)) return false;
    if (++nodes > cap) { stop = true; return false; }
    seen.add(key);
    if (used.length === depth) {
      if (goal && !goal(l, h)) return false;
      found = [l, h];
      return true;
    }
    const cand = [];
    for (let k = 0; k < board.list.length; k++) {
      if (!has(board, l, h, board.ja[k])) continue;
      if (blocked(l, h, board.bLo[k] | board.cLo[k], board.bHi[k] | board.cHi[k])) continue;
      cand.push(k);
    }
    if (!cand.length) return false;
    rng.shuffle(cand);
    cand.sort((p, q) => (board.degree[board.jb[p]] + board.degree[board.jc[p]])
      - (board.degree[board.jb[q]] + board.degree[board.jc[q]]));
    for (const k of cand) {
      used.push(k);
      if (dfs((l ^ board.mLo[k]) | 0, (h ^ board.mHi[k]) | 0)) return true;
      used.pop();
    }
    return false;
  };

  for (const t of rng.shuffle(Array.from({ length: board.count }, (_, i) => i))) {
    const b = bitOf(t);
    if (dfs(b.lo | 0, b.hi | 0)) {
      // 倒放序列整体取反就是正解：a→b→c 的逆是 c→b→a。
      const plan = used.map((k) => [board.jc[k], board.jb[k], board.ja[k]]);
      plan.reverse();
      return { start: found, plan, nodes };
    }
  }
  return null;
}

// 档位：key 用孔数（"33 孔"比"7×7"诚实 —— 7×7 上住着 33 与 37 两种盘，25 孔也在 7×7 里）。
// pegs 是起始子数：越贴近满盘越像真的棋，但倒放要在预算内收得住、而且中心必须空着 ——
// 满盘缺中心那一档（英式的经典开局）正放几千节点就能解，倒放却几乎撞不到那个唯一局面，
// 所以这里取"随机倒放稳定够得着"的最满一档。tries 是在同一档上重掷倒放路线的次数上限，
// floor 只往下退的保险，实测走不到。hard 既是"提示现搜得够快"的质量门槛，也直接当复核
// 求解的预算 —— 超过它的题反正要被丢掉，拿它当上限就不浪费一分算力（法式档的最坏值因此
// 从 ~600ms 掉到 ~275ms，见测试里的时间预算断言）。
const TIERS = [
  { key: 25, board: 'cross', label: '25 孔 · 小十字', tier: '入门', pegs: 18, tries: 8, hard: 60000, floor: 12 },
  { key: 33, board: 'english', label: '33 孔 · 英式', tier: '经典', pegs: 26, tries: 8, hard: 60000, floor: 14 },
  { key: 37, board: 'french', label: '37 孔 · 法式', tier: '进阶', pegs: 28, tries: 8, hard: 60000, floor: 16 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key || t.board === key) || TIERS[1];

// 一道题都没有比难题更难处理：外壳拿到 null 只能崩给它看。所以严格一趟找不到就松开
// 门槛再找一遍 —— 中心空的开局约定、提示现搜的节点上限都是**质量**要求，不是正确性
// 要求；正确性只由"倒放天然有解 + solve() 正放复核"这两条撑着，宽松模式下它们一条不少。
// opts.strict = false 直接走宽松一趟（测试用它确认退路真的能落地）。
export function generate(seed, sizeKey = 33, opts = {}) {
  const cfg = tierOf(sizeKey);
  const strict = opts.strict === false ? null : hunt(cfg, seed, true);
  if (strict) return strict;
  const loose = hunt(cfg, `${seed}|loose`, false);
  loose.degraded = true;
  return loose;
}

function hunt(cfg, seed, strict) {
  const board = BOARDS[cfg.board];
  const rng = rngFrom(seed);
  const stats = {};
  // 开局约定：中心空着 —— 英式/法式的经典开局都是这么起的，25 孔小十字沿用同一句话。
  const want = (l, h) => !has(board, l, h, board.center);
  const floor = strict ? Math.max(cfg.floor, SOLVE_FLOOR) : 2;
  for (let target = Math.min(cfg.pegs, board.count - 1); target >= floor; target--) {
    for (let tryNo = 0, tries = strict ? cfg.tries : 24; tryNo < tries; tryNo++) {
      const got = reversePlay(board, target - 1, rng, strict ? { goal: want, cap: REVERSE_CAP } : { cap: REVERSE_CAP });
      if (!got) break;                       // 这一档倒放已经收不住了，往下退一层
      const [lo, hi] = got.start;
      // 复核：倒放保证有解，正放若解不出来就是把哪一步写反了 —— 这道题不能放出去。
      // 复核的预算直接取质量门槛：门槛之上解出来的东西照样要丢掉，多烧的节点是纯浪费。
      // （实测这一条把法式档位的最坏值从 ~600ms 压到 ~275ms。）
      const proof = solve(board, lo, hi, strict ? cfg.hard : HINT_CAP, stats);
      if (!proof || proof.length !== target - 1) continue;
      if (strict && stats.nodes > cfg.hard) continue;
      if (popcount(lo, hi) !== target) continue;
      if (strict && has(board, lo, hi, board.center)) continue;
      const empty = bitsToHoles((board.allLo & ~lo) | 0, (board.allHi & ~hi) | 0);
      return {
        kind: 'pegsolitaire',
        board: board.name,
        side: board.side,
        holes: board.holes.map(([x, y]) => [x, y]),
        start: [lo >>> 0, hi >>> 0],
        pegs: target,
        par: target - 1,
        empty,
        plan: proof.map((m) => [m.a, m.b, m.c]),
        nodes: stats.nodes,
        reverseNodes: got.nodes,
        tries: tryNo + 1,
        seed: String(seed),
        tier: cfg.tier,
        label: cfg.label,
      };
    }
  }
  return null;
}

// ---- 引擎 --------------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const board = boardFrom(spec);
  const side = board.side;
  let lo;
  let hi;
  if (Array.isArray(spec.start) && spec.start.length === 2) {
    lo = spec.start[0] | 0;
    hi = spec.start[1] | 0;
  } else {
    // 没给起始位图就是最经典那一局：满盘、中心空。
    lo = (board.allLo & ~board.centerLo) | 0;
    hi = (board.allHi & ~board.centerHi) | 0;
  }
  const startPegs = popcount(lo, hi);
  // par = 起始子数 − 1：每步恰好吃掉一子，这个下界是算出来的不是估出来的。
  const par = startPegs - 1;
  let pegs = startPegs;
  let moves = 0;
  let doneAt = 0;
  let sel = -1;
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  const search = {};

  // 生成时记下的最优走法：局面 key → 它在该路线上的第几步。undo 之后局面自然回到某个
  // 前缀上，所以查表就够，不必另存"玩家有没有走偏"的标志。
  let plan = null;
  const planStep = new Map();
  if (Array.isArray(spec.plan) && spec.plan.length) {
    const steps = [];
    let l = lo;
    let h = hi;
    planStep.set(keyOf(l, h), 0);
    let ok = true;
    for (const [a, b, c] of spec.plan) {
      const k = jumpIndex(board, a, b, c);
      if (k < 0 || !holding(l, h, board.abLo[k], board.abHi[k]) || blocked(l, h, board.cLo[k], board.cHi[k])) {
        ok = false;   // 题面里的路线和起始位图对不上：宁可不要这条路线，hint 改成现搜
        break;
      }
      steps.push(k);
      [l, h] = applyMove(board, k, l, h);
      planStep.set(keyOf(l, h), steps.length);
    }
    if (ok) plan = steps;
  }

  const snapshot = () => {
    undoStack.push(keyOf(lo, hi));
    if (undoStack.length > 400) undoStack.shift();
    redoStack.length = 0;
  };

  function jump(k) {
    snapshot();
    const from = board.ja[k];
    const over = board.jb[k];
    const to = board.jc[k];
    [lo, hi] = applyMove(board, k, lo, hi);
    pegs--;
    moves++;                    // 只记"跳了几步"，撤销不回退它：浪费的就是浪费的
    const at = nowMs();
    anim.set(to, { at, from });
    anim.set(over, { at, gone: true });
    anim.set(from, { at, left: true });
    sel = -1;
    if (pegs === 1) doneAt = at;   // 判胜即锁输入
    return { from, over, to };
  }

  const landingsOf = (i) => {
    const out = [];
    for (const k of board.byFrom[i]) {
      if (!holding(lo, hi, board.abLo[k], board.abHi[k])) continue;
      if (blocked(lo, hi, board.cLo[k], board.cHi[k])) continue;
      out.push(k);
    }
    return out;
  };

  const cellPair = (i) => [board.holes[i][0], board.holes[i][1]];

  const engine = {
    id: 'pegsolitaire',
    spec,
    board: { cols: side, rows: side, margin: { l: 0.52, t: 0.52, r: 0.52, b: 0.52 } },
    stats: () => ({ moves, par, done: startPegs - pegs, total: par }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved: () => doneAt > 0,
    badCells: () => [],   // 走法只有合法/不合法两态，没有"与题面矛盾"的中间状态可闪红

    // 读接口（外壳不用，测试与无障碍提示用）
    boardTable: board,
    bitmap: () => [lo >>> 0, hi >>> 0],
    pegCount: () => pegs,
    cellState: (x, y) => {
      const i = holeAt(board, x, y);
      return i < 0 ? -1 : (has(board, lo, hi, i) ? 1 : 0);
    },
    selected: () => sel,
    // 格坐标 → 该孔上所有合法落点的格坐标：输入与渲染共用这一条真相
    legalTargets: (x, y) => {
      const i = holeAt(board, x, y);
      if (i < 0 || !has(board, lo, hi, i)) return [];
      return landingsOf(i).map((k) => cellPair(board.jc[k]));
    },

    down(x, y, btn) {
      if (doneAt) return false;                 // 判胜后锁输入，改笔必须走撤销
      const i = holeAt(board, x, y);
      if (i < 0) return false;                  // 不在盘面内的格坐标当没看见
      if (btn === 1) { sel = -1; return false; }   // 副笔：取消选中
      if (sel === i) { sel = -1; return false; }
      if (sel >= 0) {
        const k = landingsOf(sel).find((j) => board.jc[j] === i);
        if (k !== undefined) { jump(k); return true; }
      }
      // 非法落点：有子就把选中转移过去（人手会做的"那换这颗跳"），空孔就清空选中
      sel = has(board, lo, hi, i) ? i : -1;
      return false;
    },

    // 没有连笔：一次跳跃是两步点选（起手 + 落点），拖动若也生效就会在指尖下误跳。
    move() { return false; },
    // 抬手不清选中 —— 键盘光标走的是 down() 紧跟 up()，两点成一段必须跨过一次 up 活着。
    up() { return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(keyOf(lo, hi));
      [lo, hi] = bitsOfKey(undoStack.pop());
      pegs = popcount(lo, hi);
      sel = -1;
      doneAt = 0;
      anim.clear();
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(keyOf(lo, hi));
      [lo, hi] = bitsOfKey(redoStack.pop());
      pegs = popcount(lo, hi);
      sel = -1;
      anim.clear();
      doneAt = pegs === 1 ? nowMs() : 0;
      return true;
    },

    hint() {
      if (doneAt) return null;
      const step = planStep.get(keyOf(lo, hi));
      let k = -1;
      let note;
      if (plan && step !== undefined && step < plan.length) {
        k = plan[step];
        note = `开局算好的路线第 ${step + 1} 步：照这条线走完正好 ${par} 步`;
      } else {
        const path = solve(board, lo, hi, HINT_CAP, search);
        if (!path || !path.length) return null;   // 现搜不出解：交给外壳说"这条路堵住了"
        k = path[0].k;
        note = step === undefined
          ? `已经不在原路线上了，现搜确认这条路还走得通`
          : `这条路走完了原路线，现搜还救得回来`;
      }
      const { from, over, to } = jump(k);
      return {
        cells: [cellPair(from), cellPair(over), cellPair(to)],
        note: `${note}：吃掉 (${board.holes[over][0]},${board.holes[over][1]}) 那枚，跳完剩 ${pegs} 子`,
      };
    },

    draw(ctx, v, t) { render(ctx, v, board, { lo, hi, sel, anim, t, reveal: 0, reduce: v.reduce, landings: sel >= 0 ? landingsOf(sel) : [] }); },
    celebrate(ctx, v, t, k) { render(ctx, v, board, { lo, hi, sel: -1, anim, t, reveal: k, reduce: v.reduce, landings: [] }); },
  };

  return engine;
}

// ---- 渲染：木盘上的玻璃珠 ------------------------------------------------------------

function render(ctx, v, board, s) {
  const { cell, ox, oy, cols, rows } = v;
  paper(ctx, ox - v.cell * 0.52, oy - v.cell * 0.52, cols * cell + cell * 1.04, rows * cell + cell * 1.04, cell * 0.28);
  rules(ctx, v, rgba(T.rule, 0.5), 0);
  plate(ctx, v, board);

  const mid = (i) => [ox + board.holes[i][0] * cell + cell / 2, oy + board.holes[i][1] * cell + cell / 2];
  const gone = [];
  let flying = null;

  for (let i = 0; i < board.count; i++) socket(ctx, mid(i)[0], mid(i)[1], cell);

  // 选中时把所有合法落点画成空心圈：这是本玩法最值钱的教学提示
  if (s.landings.length) {
    const pu = s.reduce ? 0.5 : pulse(s.t);
    for (const k of s.landings) {
      const [x, y] = mid(board.jc[k]);
      landingRing(ctx, x, y, cell, 0.3 + 0.16 * pu);
    }
  }

  for (const [i, a] of s.anim) {
    if (!a.gone) continue;
    gone.push([mid(i), clamp((s.t - a.at) / JUMP_MS, 0, 1)]);
  }

  for (let i = 0; i < board.count; i++) {
    if (!has(board, s.lo, s.hi, i)) continue;
    const [x, y] = mid(i);
    const a = s.anim.get(i);
    const fly = a && a.from != null && !s.reduce ? clamp((s.t - a.at) / JUMP_MS, 0, 1) : 1;
    if (fly < 1) { flying = { x, y, a, at: fly }; continue; }
    const bump = i === s.sel && !s.reduce ? 1 + 0.05 * pulse(s.t) : 1;
    marble(ctx, x, y, cell, { scale: bump, sel: i === s.sel, t: s.t, reveal: s.reveal, glow: revealGlow(s, board, i) });
  }

  // 飞行的珠子最后画：它要盖过沿途的孔和其他珠子
  if (flying) {
    const [fx, fy] = mid(flying.a.from);
    const p = easeOut(flying.at);
    const lift = Math.sin(Math.PI * p);
    marble(ctx, lerp(fx, flying.x, p), lerp(fy, flying.y, p) - cell * 0.14 * lift, cell, { lift, sel: false, t: s.t });
  }

  if (s.sel >= 0 && !s.reduce) {
    const [x, y] = mid(s.sel);
    const pu = pulse(s.t);
    ctx.save();
    ctx.strokeStyle = rgba(T.accent, 0.55 + 0.3 * pu);
    ctx.lineWidth = Math.max(1.5, cell * 0.055);
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.40 + 0.035 * pu), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  if (v.hover && !s.reveal) {
    const i = holeAt(board, v.hover.x, v.hover.y);
    if (i >= 0 && has(board, s.lo, s.hi, i) && i !== s.sel) {
      const [x, y] = mid(i);
      ctx.save();
      ctx.strokeStyle = rgba(T.ink, 0.18 + 0.1 * (s.reduce ? 0 : pulse(s.t)));
      ctx.lineWidth = Math.max(1, cell * 0.03);
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.38, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const [[x, y], p] of gone) {
    if (p >= 1) continue;
    marble(ctx, x, y, cell, { alpha: 1 - easeOut(p), scale: 1 - 0.35 * easeOut(p), dim: true });
  }
}

// 木盘：按行取连续孔段，一段一个圆角矩形 —— 十字的四个臂、法式的四个角耳都是这么"长"出来的。
function plate(ctx, v, board) {
  const { cell, ox, oy } = v;
  const pad = cell * 0.44;
  ctx.save();
  ctx.shadowColor = rgba('#5a3a1c', 0.28);
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  for (let y = 0; y < board.side; y++) {
    let x = 0;
    while (x < board.side) {
      if (board.index[y * board.side + x] < 0) { x++; continue; }
      let end = x;
      while (end + 1 < board.side && board.index[y * board.side + end + 1] >= 0) end++;
      const gx = ox + x * cell - pad;
      const gy = oy + y * cell - pad;
      const gw = (end - x + 1) * cell + pad * 2;
      const gh = cell + pad * 2;
      const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
      g.addColorStop(0, '#b98153');
      g.addColorStop(0.55, '#9c6739');
      g.addColorStop(1, '#855429');
      ctx.fillStyle = g;
      roundRect(ctx, gx, gy, gw, gh, cell * 0.3);
      ctx.fill();
      x = end + 1;
    }
  }
  ctx.restore();

  // 木纹：几道几乎看不见的横线，让木不是纯色块
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = '#4a2c12';
  ctx.lineWidth = 1;
  for (let y = 0; y < board.side; y++) {
    for (let i = 0; i < 2; i++) {
      const yy = oy + y * cell + cell * (0.22 + i * 0.42);
      ctx.beginPath();
      ctx.moveTo(ox, yy);
      ctx.lineTo(ox + board.side * cell, yy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 孔：内凹暗影圆。左上暗、右下亮 —— 光从左上来，凹坑的远端壁才照得到。
function socket(ctx, cx, cy, cell) {
  const r = cell * 0.315;
  ctx.save();
  const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.36, r * 0.1, cx, cy, r * 1.18);
  g.addColorStop(0, rgba('#2b2118', 0.72));
  g.addColorStop(0.6, rgba('#6b4c2c', 0.5));
  g.addColorStop(1, rgba('#e8c79a', 0.5));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba('#3a2411', 0.3);
  ctx.lineWidth = Math.max(0.8, cell * 0.016);
  ctx.stroke();
  ctx.restore();
}

function landingRing(ctx, cx, cy, cell, alpha) {
  ctx.save();
  ctx.fillStyle = rgba(T.accent, alpha * 0.1);
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(T.accent, alpha);
  ctx.lineWidth = Math.max(1.2, cell * 0.045);
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.3, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(T.accent, alpha * 0.55);
  ctx.lineWidth = Math.max(1, cell * 0.02);
  ctx.beginPath();
  ctx.arc(cx, cy, cell * 0.42, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// 玻璃珠：外深内浅的径向渐变 + 左上高光 + 底部一圈反光，落影随"起飞高度"扩散。
function marble(ctx, cx, cy, cell, o = {}) {
  const r = cell * 0.3 * (o.scale == null ? 1 : o.scale);
  const lift = o.lift || 0;
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.fillStyle = rgba(T.ink, 0.22 * (1 - 0.5 * lift));
  ctx.beginPath();
  ctx.ellipse(cx + lift * cell * 0.06, cy + cell * 0.06 + lift * cell * 0.1, r * (1 + 0.35 * lift), r * 0.62, 0, 0, TAU);
  ctx.fill();

  const g = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.4, r * 0.12, cx, cy, r * 1.16);
  if (o.dim) {
    g.addColorStop(0, rgba('#ffffff', 0.7));
    g.addColorStop(0.5, rgba(T.inkSoft, 0.5));
    g.addColorStop(1, rgba('#241d16', 0.55));
  } else {
    g.addColorStop(0, rgba('#ffffff', 0.98));
    g.addColorStop(0.26, rgba('#dcefe8', 0.96));
    g.addColorStop(0.66, rgba(T.accent, 0.9));
    g.addColorStop(1, rgba('#0d3b31', 0.96));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();

  ctx.fillStyle = rgba('#ffffff', o.dim ? 0.4 : 0.85);
  ctx.beginPath();
  ctx.arc(cx - r * 0.32, cy - r * 0.38, r * 0.24, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba('#ffffff', 0.22);
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, Math.PI * 0.15, Math.PI * 0.75);
  ctx.stroke();

  if (o.glow) {
    const halo = r * (1.9 + 0.5 * o.glow);
    const h = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, halo);
    h.addColorStop(0, rgba('#fff4cf', 0.75 * o.glow));
    h.addColorStop(0.5, rgba(T.gold, 0.4 * o.glow));
    h.addColorStop(1, rgba(T.gold, 0));
    ctx.fillStyle = h;
    ctx.beginPath();
    ctx.arc(cx, cy, halo, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// 通关波：那枚留下的珠子先亮，光顺着半径推出去
function revealGlow(s, board, i) {
  if (!s.reveal) return 0;
  const [x, y] = board.holes[i];
  const c = (board.side - 1) / 2;
  const d = Math.hypot(x - c, y - c) / (board.side || 1);
  return easeOut(clamp(s.reveal * 1.6 - d * 0.5, 0, 1));
}

export default {
  id: 'pegsolitaire',
  title: '孔明棋',
  latin: 'PEG SOLITAIRE',
  tagline: '一路跳着吃掉别人，最后只留自己',
  unit: '子',
  rules: [
    '横或竖跳过相邻的一枚珠子，落进它前方那个空孔；被跳过的珠子同时被吃掉。',
    '开局中心空着，之后盘面只会越来越空 —— 目标是最后只剩一枚。',
    '先点一枚珠子，它所有能落的地方会亮成空心圈；再点其中一个就跳过去。点另一枚珠子是把选中挪过去，副笔（右键）取消选中。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
