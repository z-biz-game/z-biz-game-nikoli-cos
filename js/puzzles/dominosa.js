// 数邻 / Dominosa —— 一张印满数字的盘，切成骨牌，每一对数字恰好出现一次。
//
// 题面只有一样东西：`k×(k+1)` 的格子，每格印着 1..k 之一（内部一律存 0-based，画出来才 +1）。
// 解是把全盘切成 k(k+1)/2 张多米诺（1×2 或 2×1），使：
//   · 每一格恰好属于一块（不空、不重、不出格）
//   · 每一个**无序**数对 —— 含 a=a 这种双数 —— 恰好出现一次，一张不多、一张不少
// 这就是 Nikoli 原版的口径（外部核对过）。有些刊物另加一条"同一个数对的两块不许平行"，
// 本引擎**不实现**它：在这套题面上它是空话（数对本来就不重复），写进规则只会让人找不着北。
//
// 求解器同时负四责，和帐篷/数间一样是"人的规则"而不是搜索：
//   · propagate —— 三条人手规则刷到不动点（下面 P1/P2/P4）
//   · logicSolve —— 空盘推到不动点；推满全盘就是唯一性证明（三条规则都只下必然结论）
//   · countSolutions —— 带节点预算的分支计数，是唯一性的保险丝；capped 绝不当"无解"或"唯一"用
//   · validate —— 独立于前三者，照规则直接数一遍：覆盖成不成块、数对齐不齐；判胜负与出题复核都走它
//
// 铅笔三条规则（"合法落点"= 两端都还没进骨牌、这条界线没被划过、这个数对还没用过）：
//   P1 某个还没落地的数对，全盘合法落点只剩一处 → 落它（数对总得有个家）
//   P2 某个还没被覆盖的格，能配对的邻居只剩一个 → 落这一对
//   P4 共格锁定：某数对 p 的所有剩余落点都共用同一格 c → c 的搭档必在这些落点的另一端点里，
//      把 c 的其它候选划掉（划记号是持久的记事，不是落子）；收窄到只剩一个就落子，记这条为 P4
// 三条都只下"在任何解里都成立"的结论，所以 logicSolve 推满全盘 = 唯一性证明。
// 提示的阶梯：P1 → P2 → P4 →（还卡）一层反证（挑一格逐候选假设，只有"恰好一个候选活得下来"
// 才算推出东西，0 个或多个都如实当没结论）→（还卡）交出题面带着的那一种切法的一块。
// 账本：落一块骨牌收一步，par = k(k+1)/2 = W*H/2（一笔围两块，每块都得有人围一次）；
// 擦掉与副笔划线都不收账，但擦掉也不退账 —— moves - par 就是白花的步数。
//
// 出题为什么便宜：先随机种一套铺满全盘的骨牌，再把 k(k+1)/2 个数对**一一随机分配**给它们 ——
// 于是这张盘天生至少有一个解（就是种下的那套），不必事后筛合法性。然后把两块骨牌上的数字对调，
// 每调一次就用 countSolutions 数一遍：数到 1 收，数到 2 继续调，预算烧完（capped）就把这道题
// **丢掉**（绝不拿半截计数当证据）。因为"对调数字"不会破坏种下的那套铺法，count 恒 ≥ 1，
// 所以这条循环里没有"这题无解"那一支。随机只走 rngFrom(seed)，同一颗种子在任何设备上同一道题。
//
// 盘面最大 8×9 = 72 格、36 张骨牌，一格一位数字塞得下，但配对关系要按格存：状态一律 Int16Array。

import { rngFrom } from '../core/rng.js';
import { T, hueOf } from '../core/theme.js';
import { rules, roundRect, label, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const FREE = -1;    // 这一格还没进任何一块骨牌

// tries = 允许种几次盘，draws = 每次种盘最多对调几回，budget = 一回来的数解节点上限。
// 三档的实测读数（墙钟 p50/p95、对调次数、纯铅笔推满率）写在 test/dominosa.test.mjs 的头注释里。
const TIERS = [
  { key: 4, label: '4×5', tier: '入门', tries: 60, draws: 30, budget: 200000, audit: 600000 },
  { key: 6, label: '6×7', tier: '进阶', tries: 80, draws: 60, budget: 200000, audit: 600000 },
  { key: 8, label: '8×9', tier: '高手', tries: 120, draws: 120, budget: 300000, audit: 1000000 },
];

export const tierOf = (key) => TIERS.find((t) => String(t.key) === String(key)) || TIERS[0];

const NODE_BUDGET = 600000;

// ---- 盘的几何：邻居、界线、数对编号 ---------------------------------------------------------

// 拓扑只由 k 决定（格子、界线、数对表），数字盘换一万遍它也不变 —— 出题那一步每对调一次数字
// 就要重新数一遍解，所以这张表按 k 缓存；缓存的只是几何，没有任何随种子变化的内容。
const TOPO = new Map();

function topologyOf(k) {
  const hit = TOPO.get(k);
  if (hit) return hit;
  const w = k;
  const h = k + 1;
  const total = w * h;
  // 数对编号：(a,b) 与 (b,a) 是同一张骨牌，双数 a=a 也算一种
  const pairId = new Int16Array(k * k).fill(-1);
  const pairCells = [];
  for (let a = 0; a < k; a++) for (let b = a; b < k; b++) { pairId[a * k + b] = pairCells.length; pairCells.push([a, b]); }
  const pairs = pairCells.length;
  // 界线 = 相邻两格之间的那条边：横边 w-1 条 × h 行 + 竖边 w 列 × h-1 行
  const eA = [];
  const eB = [];
  const rightEdge = new Int16Array(total).fill(FREE);
  const downEdge = new Int16Array(total).fill(FREE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) { rightEdge[i] = eA.length; eA.push(i); eB.push(i + 1); }
      if (y + 1 < h) { downEdge[i] = eA.length; eA.push(i); eB.push(i + w); }
    }
  }
  const edgeCount = eA.length;
  const A = Int16Array.from(eA);
  const B = Int16Array.from(eB);
  const nbr = new Array(total);
  const nbrEdge = new Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ns = [];
      const es = [];
      if (x > 0) { ns.push(i - 1); es.push(rightEdge[i - 1]); }
      if (x + 1 < w) { ns.push(i + 1); es.push(rightEdge[i]); }
      if (y > 0) { ns.push(i - w); es.push(downEdge[i - w]); }
      if (y + 1 < h) { ns.push(i + w); es.push(downEdge[i]); }
      nbr[i] = Int16Array.from(ns);
      nbrEdge[i] = Int16Array.from(es);
    }
  }
  const topo = {
    k, w, h, total, pairs, pairCells, pairId, A, B, edgeCount, nbr, nbrEdge,
    edgeOf: (i, j) => (j === i + 1 ? rightEdge[i] : j === i - 1 ? rightEdge[j]
      : j === i + w ? downEdge[i] : j === i - w ? downEdge[j] : FREE),
  };
  TOPO.set(k, topo);
  return topo;
}

// 上下文 = 拓扑 + 这一份数字盘给每条界线编上的数对号。
function contextOf(spec) {
  const topo = topologyOf(spec.k);
  const { total, k, pairId } = topo;
  const num = new Int16Array(total);
  for (let i = 0; i < total; i++) num[i] = spec.nums[i];
  const pairOfEdge = new Int16Array(topo.edgeCount);
  for (let e = 0; e < topo.edgeCount; e++) {
    const a = num[topo.A[e]];
    const b = num[topo.B[e]];
    pairOfEdge[e] = a <= b ? pairId[a * k + b] : pairId[b * k + a];
  }
  return { ...topo, num, pairOfEdge };
}

function emptyState(c) {
  return {
    cover: new Int16Array(c.total).fill(FREE),   // cover[i] = 与 i 同块的邻居，FREE = 还没落地
    pairUsed: new Uint8Array(c.pairs),
    dead: new Uint8Array(c.edgeCount),          // 界线：这条边不许配对（玩家划的，或 P4 划的）
  };
}

// seedState 三种喂法都收：null / 扁平 partner 数组 / {cover, dead}。
function seedParts(seedState) {
  if (!seedState) return { cover: null, dead: null };
  if (Array.isArray(seedState) || ArrayBuffer.isView(seedState)) return { cover: seedState, dead: null };
  return { cover: seedState.cover || null, dead: seedState.dead || null };
}

// 从"盘面 + 界线"重建推导态：只认盘面上真实存在的块，别的内容一律不看。
function stateOf(c, cover, dead) {
  const st = emptyState(c);
  if (cover) {
    for (let i = 0; i < c.total; i++) {
      const j = cover[i] | 0;
      if (j < 0 || j >= c.total) continue;
      if ((cover[j] | 0) !== i) continue;
      st.cover[i] = j;
      if (i < j) {
        const e = c.edgeOf(i, j);
        if (e >= 0) st.pairUsed[c.pairOfEdge[e]] = 1;
      }
    }
  }
  if (dead) for (let e = 0; e < c.edgeCount; e++) if (dead[e]) st.dead[e] = 1;
  return st;
}

// 一条候选边：两端都空着、没被划界、这个数对也还没用过
function isLive(c, st, e) {
  if (st.dead[e]) return false;
  const i = c.A[e];
  const j = c.B[e];
  if (st.cover[i] >= 0 || st.cover[j] >= 0) return false;
  return !st.pairUsed[c.pairOfEdge[e]];
}

function spotsOf(c, st, p) {
  const out = [];
  for (let e = 0; e < c.edgeCount; e++) if (c.pairOfEdge[e] === p && isLive(c, st, e)) out.push(e);
  return out;
}

function candsOf(c, st, i) {
  const out = [];
  for (const e of c.nbrEdge[i]) if (isLive(c, st, e)) out.push(e);
  return out;
}

function placeEdge(c, st, e, rule, steps) {
  const i = c.A[e];
  const j = c.B[e];
  st.cover[i] = j;
  st.cover[j] = i;
  st.pairUsed[c.pairOfEdge[e]] = 1;
  steps.push({ i, j, e, rule });
}

const other = (c, e, i) => (c.A[e] === i ? c.B[e] : c.A[e]);

// ---- 传播：只下人推得出的结论 ---------------------------------------------------------------

// 就地刷到不动点；任何一步推出"数对无处可落 / 格子无人可配"就返回 false（判死，不判"没解"）。
// 每一处落子都往 steps 里塞一条 {i, j, e, rule}，rule ∈ P1/P2/P4 —— 提示要说得出是谁给的。
// 三条一轮地刷：P1 数对 → P2 格子 → P4 共格锁定 → 划完再查一遍格子。
function propagate(c, st, steps) {
  let changed = true;
  while (changed) {
    changed = false;
    // P1：数对的账 —— 全盘只剩一处落点，就只能落在这
    for (let p = 0; p < c.pairs; p++) {
      if (st.pairUsed[p]) continue;
      const sp = spotsOf(c, st, p);
      if (!sp.length) return false;
      if (sp.length === 1) { placeEdge(c, st, sp[0], 'P1', steps); changed = true; }
    }
    const r2 = cellSweep(c, st, steps, 'P2');          // P2：格子的账 —— 能配对的邻居只剩一个
    if (r2 < 0) return false;
    if (lockSweep(c, st)) changed = true;                 // P4：共格锁定，划掉那一格的其它候选
    const r4 = cellSweep(c, st, steps, 'P4');          // 被划到只剩一个候选的格当场落子（仍记 P4）
    if (r4 < 0) return false;
    if (r2 > 0 || r4 > 0) changed = true;
  }
  return true;
}

// 空格逐个查候选：0 个是死局，1 个就落子。返回 -1 推死 / 0 没动静 / 1 落了子。
function cellSweep(c, st, steps, rule) {
  let got = 0;
  for (let i = 0; i < c.total; i++) {
    if (st.cover[i] >= 0) continue;
    const op = candsOf(c, st, i);
    if (!op.length) return -1;
    if (op.length === 1) { placeEdge(c, st, op[0], rule, steps); got = 1; }
  }
  return got;
}

// P4 共格锁定：某数对 p 的剩余落点若全共用一格 u，则 u 的搭档必在那些落点的另一端点里
// —— 把 u 的其它候选一律划掉（划记号是持久的记事，不是落子，所以不收步、也不算块数）。
// 哪些落点共用 u ⟺ 第一处落点的两端里有一端出现在所有落点上。返回有没有划出新记号。
function lockSweep(c, st) {
  let cuts = 0;
  for (let p = 0; p < c.pairs; p++) {
    if (st.pairUsed[p]) continue;
    const sp = spotsOf(c, st, p);
    if (sp.length < 2) continue;
    const first = sp[0];
    for (const u of [c.A[first], c.B[first]]) {
      if (!sp.every((e) => c.A[e] === u || c.B[e] === u)) continue;
      const keep = new Set(sp.map((e) => other(c, e, u)));
      for (const e of candsOf(c, st, u)) if (!keep.has(other(c, e, u))) { st.dead[e] = 1; cuts++; }
    }
  }
  return cuts;
}

// ---- 求解器四职责 ---------------------------------------------------------------------------

// ② logicSolve：从（可选的）盘面推到不动点。铺满即唯一性证明：三条规则只下必然结论，
// 所以任何解都必须等于这一份。
export function logicSolve(spec, seedState = null) {
  const c = contextOf(spec);
  const seed = seedParts(seedState);
  const st = stateOf(c, seed.cover, seed.dead);
  const steps = [];
  const ok = propagate(c, st, steps);
  let open = 0;
  for (let i = 0; i < c.total; i++) if (st.cover[i] < 0) open++;
  return { cover: Array.from(st.cover), dead: Array.from(st.dead), steps, solved: ok && open === 0, contradiction: !ok, open };
}

// ④ validate：不搜索，直接照规则数一遍。判胜负与生成期复核都走它。
// solution 可以是扁平的 partner 数组（spec.solution 的形状），可以是骨牌清单
// [x1,y1,x2,y2]（spec.dominoes 的形状）、[[x1,y1],[x2,y2]]、[[i,j],…] —— 无头复验四种都喂得进去。
function coverOf(c, solution) {
  if (!solution || !solution.length) return null;
  const cover = new Int16Array(c.total).fill(FREE);
  const at = (x, y) => (Number.isInteger(x) && Number.isInteger(y) ? y * c.w + x : -1);
  const put = (i, j) => {
    if (i < 0 || j < 0 || i >= c.total || j >= c.total) return false;
    if (cover[i] !== FREE || cover[j] !== FREE) return false;   // 一格不许进两块
    cover[i] = j;
    cover[j] = i;
    return true;
  };
  if (typeof solution[0] === 'number') {
    if (solution.length !== c.total) return null;
    for (let i = 0; i < c.total; i++) {
      const j = solution[i] | 0;
      if (j === FREE) continue;
      if (j < 0 || j >= c.total || (solution[j] | 0) !== i) return null;
      cover[i] = j;
    }
    for (let i = 0; i < c.total; i++) if (cover[i] === FREE) return null;
    return cover;
  }
  if (Array.isArray(solution[0]) && solution[0].length === 4) {          // spec.dominoes：x1,y1,x2,y2
    for (const d of solution) {
      if (!put(at(d[0], d[1]), at(d[2], d[3]))) return null;
    }
  } else if (Array.isArray(solution[0]) && Array.isArray(solution[0][0])) {
    for (const d of solution) {
      if (!d || d.length !== 2) return null;
      if (!put(at(d[0][0], d[0][1]), at(d[1][0], d[1][1]))) return null;
    }
  } else {
    for (const d of solution) {
      if (!d || d.length !== 2) return null;
      if (!put(d[0] | 0, d[1] | 0)) return null;
    }
  }
  for (let i = 0; i < c.total; i++) if (cover[i] === FREE) return null;
  return cover;
}

// 覆盖成不成块、数对齐不齐：与 propagate / countSolutions 都不相干的一套数法。
function blocksValid(c, cover) {
  const used = new Uint8Array(c.pairs);
  let blocks = 0;
  for (let i = 0; i < c.total; i++) {
    const j = cover[i];
    if (j < 0 || cover[j] !== i) return false;             // 每格都得成块，且两两相认
    if (i >= j) continue;
    const e = c.edgeOf(i, j);
    if (e < 0) return false;                               // 不是横竖相邻 = 不是骨牌
    const p = c.pairOfEdge[e];
    if (used[p]) return false;                             // 同一个数对落了两块
    used[p] = 1;
    blocks++;
  }
  return blocks === c.pairs && used.every((x) => x === 1);
}

export function validate(spec, solution) {
  const c = contextOf(spec);
  const cover = coverOf(c, solution);
  if (!cover) return false;
  return blocksValid(c, cover);
}

// ③ countSolutions：带节点预算的分支计数。找最靠左上的空格，一张一张试；
// 数到 cap 就早停，预算烧完置 capped —— 半截的计数不配当唯一性证明。
export function countSolutions(spec, cap = 2, seedState = null, budget = NODE_BUDGET) {
  const c = contextOf(spec);
  const seed = seedParts(seedState);
  const st = stateOf(c, seed.cover, seed.dead);
  const limit = Math.max(1, cap);
  const used = Uint8Array.from(st.pairUsed);
  const cover = Int16Array.from(st.cover);
  const freeCount = (() => { let n = 0; for (let i = 0; i < c.total; i++) if (cover[i] < 0) n++; return n; })();
  let nodes = 0;
  let count = 0;
  let capped = false;
  let witness = null;

  // from 是"第一个空格的搜索起点"：每次落子填的都是当时第一个空格 i，而它的搭档 j 必 > i
  //（i 之前的格子都已成块），所以下一层从 i+1 起找就够 —— 省掉的是每个节点一次全盘扫描。
  const walk = (from) => {
    if (capped || count >= limit) return;
    if (++nodes > budget) { capped = true; return; }
    let i = from;
    while (i < c.total && cover[i] >= 0) i++;
    if (i === c.total) {
      if (blocksValid(c, cover)) {
        count++;
        if (!witness) witness = Array.from(cover);
      }
      return;
    }
    const nbrEdge = c.nbrEdge[i];
    for (let n = 0; n < nbrEdge.length; n++) {
      const e = nbrEdge[n];
      if (st.dead[e]) continue;                             // 玩家划的界线也是计数的输入
      const j = other(c, e, i);
      if (cover[j] >= 0) continue;
      const p = c.pairOfEdge[e];
      if (used[p]) continue;
      used[p] = 1;
      cover[i] = j;
      cover[j] = i;
      walk(i + 1);
      cover[i] = FREE;
      cover[j] = FREE;
      used[p] = 0;
      if (capped || count >= limit) return;
    }
  };

  if (freeCount % 2 === 0) walk(0);
  return { count, capped, nodes, witness };
}

// ---- 出题 -------------------------------------------------------------------------------

// 随机种一套铺满全盘的骨牌：按读序找第一个空格，随机挑一个还没被占的右邻或下邻配成一块。
// 配不上就整盘重来（这一盘长不出完美覆盖）——实测很少重来，代价可以忽略。
export function plant(w, h, rng, tries = 400) {
  const total = w * h;
  for (let t = 0; t < tries; t++) {
    const free = new Uint8Array(total).fill(1);
    const dom = [];
    let ok = true;
    for (let i = 0; i < total && ok; i++) {
      if (!free[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      const cand = [];
      if (x + 1 < w && free[i + 1]) cand.push(i + 1);
      if (y + 1 < h && free[i + w]) cand.push(i + w);
      if (!cand.length) { ok = false; break; }
      const j = rng.pick(cand);
      free[i] = 0;
      free[j] = 0;
      dom.push([i, j]);
    }
    if (ok && dom.length === total / 2) return dom;
  }
  return null;
}

// 把 k(k+1)/2 个数对一一随机分配给骨牌：这样种下的那套铺法本身就是这道盘的一个解。
export function labelNums(k, dom, rng) {
  const pairs = [];
  for (let a = 0; a < k; a++) for (let b = a; b < k; b++) pairs.push([a, b]);
  rng.shuffle(pairs);
  const nums = new Int16Array(dom.length * 2);
  dom.forEach((d, i) => { nums[d[0]] = pairs[i][0]; nums[d[1]] = pairs[i][1]; });
  return nums;
}

function dominoList(c, cover) {
  const out = [];
  for (let i = 0; i < c.total; i++) {
    const j = cover[i];
    if (j <= i) continue;
    out.push([i % c.w, (i - (i % c.w)) / c.w, j % c.w, (j - (j % c.w)) / c.w]);
  }
  return out;
}

function specOf(k, nums, cover, cfg, seed, extra) {
  const w = k;
  const h = k + 1;
  const c = contextOf({ k, w, h, nums: Array.from(nums) });
  return {
    kind: 'dominosa',
    k,
    w,
    h,
    nums: Array.from(nums),
    solution: Array.from(cover),
    dominoes: dominoList(c, cover),
    par: c.pairs,
    count: 0,
    capped: false,
    seed: String(seed),
    tier: cfg.tier,
    ...extra,
  };
}

export function generate(seed, sizeKey = 4) {
  const cfg = tierOf(sizeKey);
  const k = cfg.key;
  const w = k;
  const h = k + 1;
  const rng = rngFrom(seed);
  let cappedTries = 0;
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const sub = rng.fork(`d${attempt}`);
    const dom = plant(w, h, sub);
    if (!dom) continue;
    const nums = labelNums(k, dom, sub);
    let acc = null;
    let draws = 0;
    for (let t = 0; t < cfg.draws; t++) {
      // 随机对调两块骨牌上的数字：种下的那套铺法依旧合法，所以盘不会变成无解
      const a = sub.int(dom.length);
      const b = sub.int(dom.length);
      if (a !== b) {
        const [i1, i2] = dom[a];
        const [j1, j2] = dom[b];
        const t1 = nums[i1];
        const t2 = nums[i2];
        nums[i1] = nums[j1];
        nums[i2] = nums[j2];
        nums[j1] = t1;
        nums[j2] = t2;
      }
      draws++;
      const probe = countSolutions({ k, w, h, nums }, 2, null, cfg.budget);
      if (probe.capped) { cappedTries++; continue; }   // 丢题：没数完的盘既不能判唯一也不能判无解
      if (probe.count === 1) { acc = probe; break; }
    }
    if (!acc) continue;
    const spec = specOf(k, nums, Int16Array.from(acc.witness), cfg, seed, {
      attempts: attempt + 1,
      draws,
      cappedTries,
    });
    // 收口复核：独立判据认这道解，数解器（全预算）也只数得出这一道
    const audit = countSolutions(spec, 2, null, cfg.audit);
    if (audit.count !== 1 || audit.capped) continue;
    if (!validate(spec, spec.solution)) continue;
    spec.count = audit.count;
    spec.capped = audit.capped;
    spec.nodes = audit.nodes;
    const res = logicSolve(spec);
    spec.forced = res.steps.length;          // 纯铅笔能落几块：par - forced 就是要靠反证与答案补的量
    spec.logicOnly = res.solved;
    return spec;
  }
  return frozenSpec(k, cfg, seed, cappedTries);
}

// 最后一手：实测"数得唯一、独立判据也认"的三张盘（数字按 1..k 印、按读序写行）。
// 三张都跑过 countSolutions(2, 1e6)：4×5 花 24 个节点、6×7 249、8×9 4996，都没撞预算就数出恰好一个解。
// 于是 generate 不必留"这道题可能出不来"那一支 —— 兜底交出去的也是真题，审计照跑、解取自数解器的 witness。
const FROZEN = {
  4: '4121 4214 3232 3243 3411',
  6: '221165 542265 324453 364235 461312 155411 363664',
  8: '28447833 17565856 15266381 77378532 13885533 56616224 74264752 38217186 71144424',
};

export function frozenSpec(k, cfg, seed, cappedTries = 0) {
  const rows = FROZEN[k].split(' ');
  const nums = new Int16Array(k * (k + 1));
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < k; x++) nums[y * k + x] = +rows[y][x] - 1;
  const face = { k, w: k, h: k + 1, nums: Array.from(nums) };
  // 唯一性由数解器说话，而不是由"抄下来的这张盘应该没问题"说话；解也取自它的 witness
  const audit = countSolutions(face, 2, null, cfg.audit);
  const cover = audit.witness ? Int16Array.from(audit.witness) : new Int16Array(face.nums.length).fill(FREE);
  const spec = specOf(k, nums, cover, cfg, seed, { rescued: true, cappedTries });
  spec.count = audit.count;
  spec.capped = audit.capped;
  spec.nodes = audit.nodes;
  const res = logicSolve(spec);
  spec.forced = res.steps.length;
  spec.logicOnly = res.solved;
  return spec;
}

// ---- 引擎 -------------------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const c = contextOf(spec);
  const { w, h, total, pairs } = c;
  const par = spec.par || pairs;
  let cover = new Int16Array(total).fill(FREE);
  let ban = new Uint8Array(c.edgeCount);
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  const banAnim = new Map();
  let moves = 0;
  let doneAt = 0;
  let sel = FREE;           // 主笔/副笔共用的"锚点"：下一点落在它的邻格才成交
  let cache = null;         // badCells 的结果：只在盘面变脏时重算

  const adjacent = (i, j) => c.edgeOf(i, j) >= 0;
  const blocks = () => { let n = 0; for (let i = 0; i < total; i++) if (cover[i] >= i) n++; return n; };

  function snapshot() {
    undoStack.push({ cover: Int16Array.from(cover), ban: Uint8Array.from(ban) });
    if (undoStack.length > 400) undoStack.shift();
    redoStack.length = 0;
    cache = null;
  }

  function putEdge(i, j, count) {
    cover[i] = j;
    cover[j] = i;
    anim.set(i, nowMs());
    anim.set(j, nowMs());
    if (count) moves++;                     // 落一块骨牌收一步；擦掉与划线都不收
    cache = null;
  }

  function eraseBlock(i) {
    const j = cover[i];
    cover[i] = FREE;
    cover[j] = FREE;
    cache = null;
  }

  function afterChange() {
    cache = null;
    if (doneAt) return;
    if (blocks() !== par) return;
    // 判胜负走独立判据 validate 的那套数法（不借 propagate、也不看 spec.solution）
    if (!blocksValid(c, cover)) return;
    doneAt = nowMs();
  }

  // 与题面矛盾的格子：同一个数对落了两块（"每一对恰好一次"里的那个"一次"）。
  // 玩家自己划的界线被后来的墨盖住不算矛盾 —— 界线是记事，墨是决定，记事过时了不闪红。
  function computeBad() {
    const out = new Set();
    const seen = new Uint8Array(pairs);
    for (let i = 0; i < total; i++) {
      const j = cover[i];
      if (j < i) continue;
      if (j < 0) continue;
      const e = c.edgeOf(i, j);
      if (e < 0) { out.add(i); out.add(j); continue; }      // 理论到不了：落子只从相邻格成交
      const p = c.pairOfEdge[e];
      if (seen[p]) { out.add(i); out.add(j); }
      seen[p] = 1;
    }
    return [...out].sort((a, b) => a - b).map((i) => [i % w, (i - (i % w)) / w]);
  }

  function tagOfRule(rule, e) {
    const p = c.pairCells[c.pairOfEdge[e]];
    const pair = `数对「${p[0] + 1}-${p[1] + 1}」`;
    if (rule === 'P1') return `P1 · ${pair}在盘上只剩这一处落点`;
    if (rule === 'P2') return `P2 · 这一格能配对的邻居只剩一个，${pair}只能落在这里`;
    return `P4 · ${pair}的落点全共用一格，划掉那一格的其它候选后只剩这一处`;
  }

  // spec.solution 该被叫作什么：只有数过"恰好一种切法"的盘才配叫"唯一解"。
  const solLabel = (spec.count === 1 && !spec.capped) ? '唯一解' : '题面带着的那一种切法';

  // 一层反证：挑一个候选 ≥2 的格，逐候选假设后把铅笔刷到不动点。
  // 只有"恰好一个候选不矛盾"才算推出东西（0 个或 ≥2 个都不许下结论）。
  function refuteOne(st) {
    const probes = w * h * 2;
    let tried = 0;
    for (let i = 0; i < total; i++) {
      if (st.cover[i] >= 0) continue;
      const opts = candsOf(c, st, i);
      if (opts.length < 2) continue;
      let survived = -1;
      let alive = 0;
      for (const e of opts) {
        const guess = { cover: Int16Array.from(st.cover), pairUsed: Uint8Array.from(st.pairUsed), dead: Uint8Array.from(st.dead) };
        placeEdge(c, guess, e, 'guess', []);
        if (propagate(c, guess, [])) { alive++; survived = e; }
        if (alive > 1) break;
      }
      if (alive === 1) return survived;
      if (++tried >= probes) break;
    }
    return -1;
  }

  const engine = {
    id: 'dominosa',
    spec,
    // 题面既没有行提示也没有列提示：数字全在格子里，所以 margin 如实取 0
    //（外壳 board_view 另外留了 PAD=10px 的画布内边距，边框不会被切到）。
    board: { cols: w, rows: h, margin: { l: 0, t: 0, r: 0, b: 0 } },
    // par = 骨牌张数 = k(k+1)/2 = W*H/2：一笔围两块，每块都得有人围一次。
    stats: () => ({ moves, par, done: blocks(), total: par }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved: () => doneAt > 0,
    cellState: (x, y) => cover[y * w + x],
    numberAt: (x, y) => c.num[y * w + x] + 1,          // 题面按 1..k 印
    partnerAt: (x, y) => cover[y * w + x],
    isBanned: (x, y, x2, y2) => !!ban[c.edgeOf(y * w + x, y2 * w + x2)],
    selected: () => (sel < 0 ? null : [sel % w, (sel - (sel % w)) / w]),
    badCells: () => { if (!cache) cache = computeBad(); return cache; },
    layoutIn(box) {
      const availW = Math.max(120, (box.w || 240) - 2);
      const availH = Math.max(120, (box.h || 240) - 2);
      const b = engine.board;
      return Math.max(16, Math.min(availW / (b.cols + b.margin.l + b.margin.r), availH / (b.rows + b.margin.t + b.margin.b)));
    },

    // 主笔：点一格当锚点，再点它的正邻格 = 落一块骨牌；点到已在某块里的格 = 整块擦掉；
    // 点的不是邻格 = 换锚点。副笔：同样两步，成交时是在两格之间划一条"不许配对"的界线。
    down(x, y, btn = 0) {
      if (x < 0 || y < 0 || x >= w || y >= h || doneAt) return false;
      const i = y * w + x;
      if (btn === 0 && cover[i] >= 0) {                 // 擦：整块抹掉，账不退（那是一次试错）
        if (sel === i) sel = FREE;
        snapshot();
        eraseBlock(i);
        afterChange();
        return true;
      }
      if (sel >= 0 && sel !== i && adjacent(sel, i)) {
        if (btn === 1) {
          snapshot();
          const e = c.edgeOf(sel, i);
          ban[e] = ban[e] ? 0 : 1;
          banAnim.set(e, nowMs());
          sel = FREE;
          cache = null;
          return true;                                   // 记事：一律不收步
        }
        if (cover[i] < 0 && cover[sel] < 0) {
          snapshot();
          putEdge(sel, i, true);
          sel = FREE;
          afterChange();
          return true;
        }
      }
      sel = i;                                            // 换锚点：不是落子，不算改动
      return false;
    },

    // 拖动：从锚点一路拖到邻格即成交（与"点两下"同一条路，收一笔账）
    move(x, y) {
      if (doneAt || x < 0 || y < 0 || x >= w || y >= h) return false;
      const i = y * w + x;
      if (sel < 0 || sel === i) return false;
      if (!adjacent(sel, i)) { if (cover[i] < 0) sel = i; return false; }
      if (cover[i] >= 0 || cover[sel] >= 0) return false;
      snapshot();
      putEdge(sel, i, true);
      sel = FREE;
      afterChange();
      return true;
    },

    up() { return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push({ cover: Int16Array.from(cover), ban: Uint8Array.from(ban) });
      const prev = undoStack.pop();
      cover = prev.cover;
      ban = prev.ban;
      sel = FREE;
      doneAt = 0;
      cache = null;
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push({ cover: Int16Array.from(cover), ban: Uint8Array.from(ban) });
      const next = redoStack.pop();
      cover = next.cover;
      ban = next.ban;
      sel = FREE;
      cache = null;
      afterChange();
      return true;
    },

    // 提示阶梯：P1 → P2 → P4 →（卡住）一层反证 →（还卡住）交出唯一解里的一块。
    // 每一步都真的改盘面，note 里说清是哪条规则给的。
    hint() {
      if (doneAt) return null;
      const bad = computeBad();
      if (bad.length) {                                 // 先拆自己写坏的墨，否则后面推什么都没意义
        const i = bad[0][1] * w + bad[0][0];
        const j = cover[i];
        if (j < 0) return null;
        snapshot();
        eraseBlock(i);
        afterChange();
        return { cells: [bad[0], [j % w, (j - (j % w)) / w]], note: '擦掉 · 这个数对已经落过一块了，先拆掉重复的那一块' };
      }
      const st = stateOf(c, cover, ban);
      const steps = [];
      const ok = propagate(c, st, steps);
      if (ok && steps.length) {
        const s = steps[0];
        return commit(s.i, s.j, tagOfRule(s.rule, s.e));
      }
      if (!ok) {
        const wrong = firstOffSolution();
        if (wrong >= 0) {
          const i = wrong;
          const j = cover[i];
          snapshot();
          eraseBlock(i);
          afterChange();
          return { cells: [[i % w, (i - (i % w)) / w], [j % w, (j - (j % w)) / w]], note: `擦掉 · 这一块的配对不在${solLabel}里，推不下去了（答案）` };
        }
      }
      const e = refuteOne(st);
      if (e >= 0) return commit(c.A[e], c.B[e], '反证 · 这一格试着配别的邻居都会推死，只有这一处活着');
      // 三条铅笔与一层反证都收不住：如实交出题面带着的那一种切法。
      // 只有数过"恰好一种"的盘才敢说"唯一解"，别的盘（count ≠ 1）就照实说不止一种。
      if (!spec.solution || spec.solution.length !== total) return null;
      const sol = Int16Array.from(spec.solution);
      const truth = `答案 · 推不动了：${solLabel === '唯一解' ? '唯一解里这一对就是这么配的' : '这盘面不止一种切法，先按题面带着的那一种给你一块'}`;
      for (let i = 0; i < total; i++) {
        if (cover[i] >= 0) continue;
        const j = sol[i];
        if (j < 0 || j < i || cover[j] >= 0) continue;
        return commit(i, j, truth);
      }
      return null;
    },

    draw(ctx, v, t) { render(ctx, v, { cover, ban, sel, anim, banAnim, c, t, reveal: 0, done: doneAt > 0 }); },
    celebrate(ctx, v, t, k) { render(ctx, v, { cover, ban, sel: FREE, anim, banAnim, c, t, reveal: k, done: true }); },
  };

  // 第一块不在唯一解里的墨（只有盘已被推死时才会走到这里）
  function firstOffSolution() {
    const sol = spec.solution;
    for (let i = 0; i < total; i++) {
      const j = cover[i];
      if (j < 0 || j < i) continue;
      if (sol[i] !== j) return i;
    }
    return -1;
  }

  function commit(i, j, why) {
    snapshot();
    putEdge(i, j, true);
    sel = FREE;
    afterChange();
    const left = par - blocks();
    const cells = [[i % w, (i - (i % w)) / w], [j % w, (j - (j % w)) / w]];
    return { cells, note: left > 0 ? `${why}（还差 ${left} 块）` : why };
  }

  return engine;
}

// ---- 渲染 -------------------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  const c = s.c;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);
  const cx0 = (cols - 1) / 2;
  const cy0 = (rows - 1) / 2;
  const span = Math.hypot(cx0, cy0) || 1;

  // 骨牌：圆角框 + 每块按数对取色（hueOf 是 12 色循环，8×9 有 36 个数对 ⇒ 同色会重演三次，
  // 认对子主要靠框里的两个数字，颜色只是把"这一块是一整块"说清楚）
  for (let i = 0; i < c.total; i++) {
    const j = s.cover[i];
    if (j < i) continue;
    const e = c.edgeOf(i, j);
    if (e < 0) continue;
    const hue = hueOf(c.pairOfEdge[e]);
    const t0 = s.anim.get(i);
    const k = !t0 || v.reduce ? 1 : easeOut(clamp((s.t - t0) / 190, 0, 1));
    const xi = i % cols;
    const yi = (i - xi) / cols;
    const xj = j % cols;
    const yj = (j - xj) / cols;
    const wave = s.reveal && !v.reduce
      ? 0.4 + 0.6 * easeOut(clamp(s.reveal * 2.2 - Math.hypot((xi + xj) / 2 - cx0, (yi + yj) / 2 - cy0) / span, 0, 1))
      : 1;
    const x = Math.min(xi, xj);
    const y = Math.min(yi, yj);
    const bw = (Math.max(xi, xj) - x + 1) * cell;
    const bh = (Math.max(yi, yj) - y + 1) * cell;
    const pad = cell * 0.06;
    ctx.save();
    ctx.globalAlpha = (0.3 + 0.7 * k) * wave;
    ctx.fillStyle = rgba(hue, 0.16);
    ctx.strokeStyle = rgba(hue, 0.85);
    ctx.lineWidth = Math.max(1.4, cell * 0.055);
    roundRect(ctx, ox + x * cell + pad, oy + y * cell + pad, bw - pad * 2, bh - pad * 2, cell * 0.26);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 副笔的界线：两格之间一道短粗墨，明确表示"这两块不许配对"
  for (let e = 0; e < c.edgeCount; e++) {
    if (!s.ban[e]) continue;
    const i = c.A[e];
    const j = c.B[e];
    const xi = i % cols;
    const yi = (i - xi) / cols;
    const xj = j % cols;
    const yj = (j - xj) / cols;
    const mx = ox + ((xi + xj) / 2 + 0.5) * cell;
    const my = oy + ((yi + yj) / 2 + 0.5) * cell;
    const half = cell * 0.3;
    const t0 = s.banAnim.get(e);
    const k = !t0 || v.reduce ? 1 : easeOut(clamp((s.t - t0) / 160, 0, 1));
    ctx.save();
    ctx.strokeStyle = rgba(T.warn, 0.55 + 0.35 * k);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.beginPath();
    if (yi === yj) { ctx.moveTo(mx, my - half); ctx.lineTo(mx, my + half); }
    else { ctx.moveTo(mx - half, my); ctx.lineTo(mx + half, my); }
    ctx.stroke();
    ctx.restore();
  }

  // 题面数字：印在格内，永远压在骨牌框之上
  const fs = Math.max(10, cell * 0.46);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      label(ctx, String(c.num[y * cols + x] + 1), ox + (x + 0.5) * cell, oy + (y + 0.55) * cell,
        { size: fs, color: T.ink, bold: true, mono: true });
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

  // 锚点 + 可配邻居：选中之后要把"下一步能点谁"画明白
  if (s.sel >= 0 && !s.done && !s.reveal) {
    const x = s.sel % cols;
    const y = (s.sel - x) / cols;
    ctx.save();
    ctx.strokeStyle = rgba(T.accent, 0.55 + 0.3 * pulse(s.t));
    ctx.lineWidth = 2;
    roundRect(ctx, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2, cell * 0.16);
    ctx.stroke();
    for (const n of c.nbr[y * cols + x]) {
      const nx = n % cols;
      const ny = (n - nx) / cols;
      ctx.fillStyle = rgba(T.accent, 0.12 + 0.06 * pulse(s.t));
      roundRect(ctx, ox + nx * cell + 3, oy + ny * cell + 3, cell - 6, cell - 6, cell * 0.16);
      ctx.fill();
    }
    ctx.restore();
  }

  if (v.hover && !s.reveal && !s.done && s.sel < 0) {
    const { x, y } = v.hover;
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      ctx.save();
      ctx.strokeStyle = rgba(T.ink, 0.2 + 0.12 * pulse(s.t));
      ctx.lineWidth = 1.6;
      roundRect(ctx, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2, cell * 0.16);
      ctx.stroke();
      ctx.restore();
    }
  }
}

export default {
  id: 'dominosa',
  title: '数邻',
  latin: 'DOMINOSA',
  tagline: '把数字盘切成骨牌，每一对数字恰好出现一次',
  unit: '块',
  rules: [
    '盘面是 k×(k+1) 的格子，每格印着 1..k 之一；解就是把全盘切成 k(k+1)/2 张多米诺（1×2 或 2×1）。',
    '每一个无序数对（含 3-3 这种双数）必须恰好出现一次：一对不多、一对不少。',
    '主笔：先点一格选中，再点它的上下左右邻格就落一块骨牌；点到已经进了某块的格子，整块擦掉。',
    '副笔：选中一格后再点邻格，是在两格之间划一条"这两格不许配对"的界线 —— 记事不进步数，也是提示推理的输入。',
    '提示按 P1（数对只剩一处落点）、P2（格子只剩一个搭档）、P4（数对落点共格锁定）逐级推；卡住才反证，再卡住就交出答案。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
