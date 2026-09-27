// 帐篷 / Tents —— 每棵树配一顶帐篷，帐篷与帐篷连斜角都不许挨着。
//
// 题面是"一片林子 + 行列的数字"：数字只数帐篷，树的位置全部给定。解就是草地上的帐篷集合，
// 四条规则把它夹得很死：
//   · 每棵树的上下左右恰有一顶帐篷（斜着不算 —— 人给树找营地就看这四格）
//   · 每行每列的帐篷数等于给出的数字
//   · 帐篷八邻域内不得再有帐篷（连斜角都不行）
//   · 帐篷只搭在草地上：树坑里搭不了，也没那块地
// 读法上取"配对"这一档（Nikoli 原意）：行线索之和 = 树数 = 帐篷数，于是每棵树恰一顶、
// 每顶帐篷也恰认一棵树。字面上还漏得掉"一顶帐侍候两棵树 + 一顶孤帐"这种摆法 —— 人不这么 camping，
// 引擎也不收：validate 与 propagate 的第六条都把它判死，出题那一步根本长不出这种盘。
//
// 求解器同时负四责，和数织一样是"人的规则"而不是搜索：
//   · propagate —— 六条人手规则刷到不动点：行列数满就封、剩余空地刚好够数就全下帐、
//     连续空地的容量 ceil(L/2) 逼出"隔一格放一顶"、树只剩一个候选就下帐、树配齐就封邻格、
//     帐篷八邻全封；挨不到任何树的草地一律排除
//   · logicSolve —— 从空盘推到不动点；推满全盘就是唯一性证明（每条规则都只下必然结论）
//   · countSolutions —— 带节点预算的分支计数，是唯一性的保险丝与审计（capped 绝不当"没有解"用）
//   · validate —— 独立于前三者，直接照规则数一遍：判胜负、生成期复核都走它
//
// 出题因此很便宜：先长出一套合法的"树—帐"配对（配对是在生长期就维持的不变量，不是事后筛），
// 数出行列数字，再用 logicSolve 从空盘验一遍。只有推得满全盘的题面才放出来 ——
// 毫秒级的生成和"唯一解是证明不是猜"是同一条门槛给的。
// 盘面最大 10×10，一格一位塞不进一个整数，状态一律 Uint8Array。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, roundRect, label, crossMark, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const UNKNOWN = 0;
export const TENT = 1;
export const NO = 2;      // 副笔：这格一定不放帐篷（记事，不是落子）
export const TREE = 3;    // 只出现在 spec.solution 里：题面给定的树坑

const NODE_BUDGET = 30000;
const OX = Int8Array.from([1, -1, 0, 0]);
const OY = Int8Array.from([0, 0, 1, -1]);
// 前四个方向是正邻，后四个是斜角：帐篷的"贴身"查 8 个，树的"营地"只看 4 个。
const AX = Int8Array.from([1, -1, 0, 0, 1, 1, -1, -1]);
const AY = Int8Array.from([0, 0, 1, -1, 1, -1, 1, -1]);

const inB = (x, y, n) => x >= 0 && y >= 0 && x < n && y < n;

// 题面里"这格挨着哪棵树"是静态信息：草地挨不到任何树，就永远搭不起帐篷。
function nearTreeOf(n, trees) {
  const near = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!trees[y * n + x]) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + OX[d];
        const ny = y + OY[d];
        if (inB(nx, ny, n)) near[ny * n + nx] = 1;
      }
    }
  }
  return near;
}

function contextOf(spec) {
  const n = spec.n;
  const trees = Uint8Array.from(spec.trees);
  return {
    n,
    total: n * n,
    trees,
    rowC: spec.rowClues,
    colC: spec.colClues,
    nearTree: nearTreeOf(n, trees),
  };
}

// ---- 传播：只下人推得出的结论 -----------------------------------------------------

// 一条线（行或列）的账。返回 0 矛盾 / 1 没动静 / 2 推出新格。
// ① 数满了就把余下的空地封掉；② 剩余空地刚好够数就全下帐；
// ③ 一串连续空地里隔一格才放得下一顶 ⇒ 容量 ceil(L/2)；需要的顶数正好压在容量上时，
//    奇数长的那串只有一种摆法（从第一格起隔一格一顶），于是那几格必是帐篷。
// 行先于列、线先于格地刷：树逼出的那一顶若让某条线数超，下一轮 lineSweep 当场判死。
function lineSweep(start, stride, n, trees, clue, st) {
  let placed = 0;
  let free = 0;
  for (let k = 0, i = start; k < n; k++, i += stride) {
    if (trees[i]) continue;
    const v = st[i];
    if (v === TENT) placed++;
    else if (v === UNKNOWN) free++;
  }
  if (placed > clue) return 0;
  const need = clue - placed;
  if (need === 0) {
    if (!free) return 1;
    for (let k = 0, i = start; k < n; k++, i += stride) if (!trees[i] && st[i] === UNKNOWN) st[i] = NO;
    return 2;
  }
  if (free < need) return 0;
  if (free === need) {
    for (let k = 0, i = start; k < n; k++, i += stride) if (!trees[i] && st[i] === UNKNOWN) st[i] = TENT;
    return 2;
  }
  let cap = 0;
  const runs = [];
  let run = 0;
  for (let k = 0, i = start; k <= n; k++, i += stride) {
    const openable = k < n && !trees[i] && st[i] === UNKNOWN;
    if (openable) run++;
    else {
      cap += (run + 1) >> 1;
      if (run % 2) runs.push([i - run * stride, run]);   // 奇数段：容量只有"从第一格隔一格"这一种摆法
      run = 0;
    }
  }
  if (need > cap) return 0;
  if (need < cap) return 1;
  // 需要的顶数正好压在全行容量上 ⇒ 每一串都得装满自己的容量：奇数长的那串当场定死
  let changed = false;
  for (const [first, len] of runs) {
    for (let off = 0; off < len; off += 2) { st[first + off * stride] = TENT; changed = true; }
  }
  return changed ? 2 : 1;
}

// 就地刷到不动点；任何一步推出自相矛盾就返回 false（调用方拿它当判死，不拿它当"没解"）。
function propagate(c, st) {
  const { n, trees, rowC, colC, nearTree, total } = c;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < n; y++) {
      const r = lineSweep(y * n, 1, n, trees, rowC[y], st);
      if (r === 0) return false;
      if (r === 2) changed = true;
    }
    for (let x = 0; x < n; x++) {
      const r = lineSweep(x, n, n, trees, colC[x], st);
      if (r === 0) return false;
      if (r === 2) changed = true;
    }
    for (let i = 0; i < total; i++) {
      const x = i % n;
      const y = (i - x) / n;
      if (trees[i]) {
        // ④ 树的账：恰有一顶。配齐了就封掉其余营地，只剩一个候选就下帐，一个不剩就是死局
        let tents = 0;
        let cands = 0;
        let last = -1;
        for (let d = 0; d < 4; d++) {
          const nx = x + OX[d];
          const ny = y + OY[d];
          if (!inB(nx, ny, n)) continue;
          const j = ny * n + nx;
          if (trees[j]) continue;                         // 树坑不是营地
          if (st[j] === TENT) tents++;
          else if (st[j] === UNKNOWN) { cands++; last = j; }
        }
        if (tents > 1) return false;
        if (tents === 1) {
          for (let d = 0; d < 4; d++) {
            const nx = x + OX[d];
            const ny = y + OY[d];
            if (!inB(nx, ny, n)) continue;
            const j = ny * n + nx;
            if (!trees[j] && st[j] === UNKNOWN) { st[j] = NO; changed = true; }
          }
        } else if (cands === 0) return false;
        else if (cands === 1) { st[last] = TENT; changed = true; }
      } else if (st[i] === TENT) {
        // ⑤ 帐篷的账：认一棵树、也不许跟别的帐篷贴身
        if (!nearTree[i]) return false;
        let mine = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + AX[d];
          const ny = y + AY[d];
          if (inB(nx, ny, n) && trees[ny * n + nx]) mine++;
        }
        if (mine > 1) return false;
        for (let d = 0; d < 8; d++) {
          const nx = x + AX[d];
          const ny = y + AY[d];
          if (!inB(nx, ny, n)) continue;
          const j = ny * n + nx;
          if (trees[j]) continue;
          if (st[j] === TENT) return false;
          if (st[j] === UNKNOWN) { st[j] = NO; changed = true; }
        }
      } else if (st[i] === UNKNOWN && !nearTree[i]) {
        // ⑥ 挨不到任何树的草地，永远搭不起帐篷
        st[i] = NO;
        changed = true;
      }
    }
  }
  return true;
}

// 全盘是否已经推满：草地每格都有下落（帐篷或"绝不在这里"），树坑不参与。
function isFull(c, st) {
  const { total, trees } = c;
  for (let i = 0; i < total; i++) if (!trees[i] && st[i] === UNKNOWN) return false;
  return true;
}

// ---- 求解器 -----------------------------------------------------------------------

// 从（可选的部分）盘面推到不动点。推满全盘即唯一性证明：传播只下必然结论，
// 所以任何解都必须等于这一份。
export function logicSolve(spec, seedState = null) {
  const c = contextOf(spec);
  const st = seedState ? Uint8Array.from(seedState) : new Uint8Array(c.total);
  for (let i = 0; i < c.total; i++) if (c.trees[i]) st[i] = UNKNOWN;
  if (!propagate(c, st)) return { grid: st, solved: false, contradiction: true, open: 0 };
  let open = 0;
  for (let i = 0; i < c.total; i++) if (!c.trees[i] && st[i] === UNKNOWN) open++;
  return { grid: st, solved: open === 0, contradiction: false, open };
}

// 独立判据：照规则直接数一遍，不看 propagate、也不看 logicSolve。
// solution 可以是扁平状态数组（TENT/NO/TREE/UNKNOWN 混用，只有 TENT 算帐篷），
// 也可以是 [[x,y], …] 的帐篷清单 —— 无头复验两种都喂得进去。
function tentsOf(c, solution) {
  const { total } = c;
  const t = new Uint8Array(total);
  if (!solution) return null;
  if (Array.isArray(solution[0])) {
    for (const [x, y] of solution) {
      if (!inB(x, y, c.n)) return null;
      t[y * c.n + x] = 1;
    }
    return t;
  }
  if (solution.length !== total) return null;
  for (let i = 0; i < total; i++) if (solution[i] === TENT) t[i] = 1;
  return t;
}

export function validate(spec, solution) {
  const c = contextOf(spec);
  const { n, trees, rowC, colC, nearTree, total } = c;
  const t = tentsOf(c, solution);
  if (!t) return false;
  const rows = new Int32Array(n);
  const cols = new Int32Array(n);
  let tents = 0;
  for (let i = 0; i < total; i++) {
    if (!t[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    if (trees[i]) return false;                        // 树坑里搭不了帐篷
    if (!nearTree[i]) return false;                    // 这顶帐篷没有树可认
    tents++;
    rows[y]++;
    cols[x]++;
    for (let d = 0; d < 8; d++) {                       // 贴身（含斜角）就是违规
      const nx = x + AX[d];
      const ny = y + AY[d];
      if (inB(nx, ny, n) && t[ny * n + nx]) return false;
    }
  }
  for (let y = 0; y < n; y++) if (rows[y] !== rowC[y]) return false;
  for (let x = 0; x < n; x++) if (cols[x] !== colC[x]) return false;
  for (let i = 0; i < total; i++) {
    if (!trees[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    let got = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + OX[d];
      const ny = y + OY[d];
      if (inB(nx, ny, n) && t[ny * n + nx]) got++;
    }
    if (got !== 1) return false;                        // 每棵树恰有一顶帐篷
  }
  return true;
}

// 数这道题有几个解：数到 cap 就早停；节点预算烧完置 capped —— 半截的计数不配当唯一性证明。
export function countSolutions(spec, cap = 2, seedState = null, budget = NODE_BUDGET) {
  const c = contextOf(spec);
  const { n, trees, total, nearTree } = c;
  const limit = Math.max(1, cap);
  const root = seedState ? Uint8Array.from(seedState) : new Uint8Array(total);
  for (let i = 0; i < total; i++) if (trees[i]) root[i] = UNKNOWN;
  let nodes = 0;
  let count = 0;
  let capped = false;
  let witness = null;

  const search = (state) => {
    if (capped || count >= limit) return;
    if (++nodes > budget) { capped = true; return; }
    const g = Uint8Array.from(state);
    if (!propagate(c, g)) return;
    let pick = -1;
    let best = 99;
    for (let i = 0; i < total; i++) {
      if (trees[i] || g[i] !== UNKNOWN || !nearTree[i]) continue;
      const x = i % n;
      const y = (i - x) / n;
      let score = 8;                                   // 挑"所属树的选择最少"的那格：分支窄、剪得深
      for (let d = 0; d < 4; d++) {
        const nx = x + OX[d];
        const ny = y + OY[d];
        if (!inB(nx, ny, n)) continue;
        const j = ny * n + nx;
        if (!trees[j]) continue;
        let k = 0;
        for (let e = 0; e < 4; e++) {
          const mx = nx + OX[e];
          const my = ny + OY[e];
          if (inB(mx, my, n) && !trees[my * n + mx] && g[my * n + mx] === UNKNOWN) k++;
        }
        if (k < score) score = k;
      }
      if (score < best) { best = score; pick = i; if (score <= 2) break; }
    }
    if (pick < 0) {
      if (isFull(c, g) && validateFlat(c, g)) {
        count++;
        if (!witness) witness = Array.from(g);
      }
      return;
    }
    for (const v of [TENT, NO]) {
      g[pick] = v;
      search(g);
      if (capped || count >= limit) return;
    }
  };

  search(root);
  return { count, capped, nodes, witness };
}

// 计数求解器收口用的全盘复核：与 validate 同一套规则，只是省掉一次状态转换。
function validateFlat(c, st) {
  const { n, trees, rowC, colC, total } = c;
  for (let y = 0; y < n; y++) {
    let k = 0;
    for (let x = 0; x < n; x++) if (st[y * n + x] === TENT) k++;
    if (k !== rowC[y]) return false;
  }
  for (let x = 0; x < n; x++) {
    let k = 0;
    for (let y = 0; y < n; y++) if (st[y * n + x] === TENT) k++;
    if (k !== colC[x]) return false;
  }
  for (let i = 0; i < total; i++) {
    const x = i % n;
    const y = (i - x) / n;
    if (trees[i]) {
      if (st[i] === TENT) return false;                   // 树坑里搭不了帐篷
      let got = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + OX[d];
        const ny = y + OY[d];
        if (inB(nx, ny, n) && st[ny * n + nx] === TENT) got++;
      }
      if (got !== 1) return false;
    } else if (st[i] === TENT) {
      let mine = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + AX[d];
        const ny = y + AY[d];
        if (inB(nx, ny, n) && trees[ny * n + nx]) mine++;
      }
      if (mine !== 1) return false;
      for (let d = 0; d < 8; d++) {
        const nx = x + AX[d];
        const ny = y + AY[d];
        if (inB(nx, ny, n) && !trees[ny * n + nx] && st[ny * n + nx] === TENT) return false;
      }
    }
  }
  return true;
}

// ---- 出题 -----------------------------------------------------------------------

// 帐篷数（= 树数 = 行线索之和）落在区间里：太少一上手就空半边盘、几步就完，
// 太多草地挤成筛子、也推不出"这一格必不留帐"。区间是实测出来的：这三档的纯逻辑通过率
// 各在 6~8 成上下，一次 generate 平均试两三次就能收到题。
const TIERS = [
  { key: 6, label: '6×6', tier: '入门', want: [6, 8], min: 5, tries: 400, audit: 20000 },
  { key: 8, label: '8×8', tier: '熟手', want: [9, 11], min: 8, tries: 400, audit: 20000 },
  { key: 10, label: '10×10', tier: '挑战', want: [10, 12], min: 10, tries: 400, audit: 20000 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

// 边长边维持不变量：帐篷八邻域封帐、树另一侧封帐、帐篷四周正邻封树。
// 于是一路贪心长出来的盘天然满足全部四条规则，行列数字只是把这套装好后数一遍。
export function growPairing(n, rng, cfg) {
  const total = n * n;
  const trees = new Uint8Array(total);
  const tents = new Uint8Array(total);
  const noTent = new Uint8Array(total);
  const noTree = new Uint8Array(total);
  const cells = Array.from({ length: total }, (_, i) => i);
  const target = rng.range(cfg.want[0], cfg.want[1]);
  let got = 0;
  for (const i of rng.shuffle(cells)) {
    if (got >= target) break;
    if (noTent[i] || tents[i] || trees[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    let blocked = false;
    for (let d = 0; d < 4; d++) {
      const nx = x + OX[d];
      const ny = y + OY[d];
      if (inB(nx, ny, n) && trees[ny * n + nx]) { blocked = true; break; }   // 那棵树早已配好自己的帐
    }
    if (blocked) continue;
    const spots = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + OX[d];
      const ny = y + OY[d];
      if (!inB(nx, ny, n)) continue;
      const j = ny * n + nx;
      if (!noTree[j] && !trees[j] && !tents[j]) spots.push(j);
    }
    if (!spots.length) continue;
    const u = rng.pick(spots);
    tents[i] = 1;
    trees[u] = 1;
    noTent[i] = 1;
    noTree[i] = 1;
    noTent[u] = 1;
    noTree[u] = 1;
    for (let d = 0; d < 8; d++) {                       // 帐篷的八邻再放不下一顶
      const nx = x + AX[d];
      const ny = y + AY[d];
      if (inB(nx, ny, n)) noTent[ny * n + nx] = 1;
    }
    const ux = u % n;
    const uy = (u - ux) / n;
    for (let d = 0; d < 4; d++) {                       // 这棵树的其余营地也再搭不起帐篷
      const nx = ux + OX[d];
      const ny = uy + OY[d];
      if (inB(nx, ny, n)) noTent[ny * n + nx] = 1;
    }
    for (let d = 0; d < 4; d++) {                       // 帐篷四周正邻不能再有树（那会分走这一顶）
      const nx = x + OX[d];
      const ny = y + OY[d];
      if (inB(nx, ny, n)) noTree[ny * n + nx] = 1;
    }
    got++;
  }
  return got >= cfg.min ? { trees, tents, got } : null;
}

function cluesOf(n, tents) {
  const rowClues = new Array(n).fill(0);
  const colClues = new Array(n).fill(0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (tents[y * n + x]) { rowClues[y]++; colClues[x]++; }
  return { rowClues, colClues };
}

// spec 里带着完整答案，无头复验只用它：
//   trees    —— 扁平 n*n，1 = 树（题面给定，玩家动不了）
//   solution —— 扁平 n*n，1 = 帐篷 / 2 = 已排除的草地 / 3 = 树
//   tents    —— [[x,y], …] 帐篷清单，逐个 down(x,y,0) 即可通关
function specOf(n, cfg, made, seed) {
  const { trees, tents } = made;
  const { rowClues, colClues } = cluesOf(n, tents);
  const solution = new Array(n * n);
  const list = [];
  for (let i = 0; i < n * n; i++) {
    if (trees[i]) solution[i] = TREE;
    else if (tents[i]) { solution[i] = TENT; list.push([i % n, (i - (i % n)) / n]); }
    else solution[i] = NO;
  }
  return {
    kind: 'tents',
    n,
    trees: Array.from(trees),
    rowClues,
    colClues,
    solution,
    tents: list,
    par: list.length,
    count: 0,
    capped: false,
    seed: String(seed),
    tier: cfg.tier,
  };
}

// 纯逻辑门槛：从空盘推得满全盘，而且推出来的正是生长时那套配对。
export function passesGate(spec) {
  const res = logicSolve(spec);
  if (!res.solved) return false;
  const { n, trees } = contextOf(spec);
  for (let i = 0; i < n * n; i++) {
    const want = spec.solution[i];
    if (trees[i]) continue;
    if (res.grid[i] !== want) return false;
  }
  return validate(spec, spec.solution);
}

// 题面品相：0 那一行确实给了信息（那一整排都搭不了帐），但整片都是 0 就不像题了。
function wellFormed(spec) {
  let zr = 0;
  let zc = 0;
  for (const k of spec.rowClues) if (!k) zr++;
  for (const k of spec.colClues) if (!k) zc++;
  return zr <= 2 && zc <= 2;
}

export function generate(seed, sizeKey = 6) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const sub = rng.fork(`t${attempt}`);
    const made = growPairing(n, sub, cfg);
    if (!made) continue;
    const spec = specOf(n, cfg, made, seed);
    if (!wellFormed(spec) || !passesGate(spec)) continue;
    const audit = countSolutions(spec, 2, null, cfg.audit);
    if (audit.count !== 1) continue;                    // 保险丝不认这次的推理结果，换盘
    spec.count = audit.count;
    spec.capped = audit.capped;
    spec.attempts = attempt + 1;
    return spec;
  }
  return frozenSpec(n, cfg, seed);
}

// 最后一手：实测纯逻辑可解、独立判据也认、数解器只数出一个解的三张盘（T = 树，A = 帐篷，. = 草地）。
// 于是 generate 不必留"这道题可能出不来"那条分支 —— 兜底交出去的也是一道真题，绝不交白卷。
const FROZEN = {
  6: '...A.A TA.TTT ....A. TA.... T.T.AT A.A...',
  8: '.....TA. ........ A....T.. T..T.A.A ...A...T A....... T.....TA .TA.AT..',
  10: '...AT..TA. TA...T.... .....A.... .TA...T... A.....A... T..A...... ...T..TA.A ....AT...T .......... ..AT......',
};

function frozenSpec(n, cfg, seed) {
  const rows = FROZEN[n].split(' ');
  const trees = new Uint8Array(n * n);
  const tents = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ch = rows[y][x];
      if (ch === 'T') trees[y * n + x] = 1;
      else if (ch === 'A') tents[y * n + x] = 1;
    }
  }
  const spec = specOf(n, cfg, { trees, tents }, seed);
  // 不 throw：兜底路径也要交出一道真题。审计照跑，count/capped 原样写进 spec，
  // 唯一性由数解器说话，而不是由"抄下来的这张盘应该没问题"说话。
  const audit = countSolutions(spec, 2, null, cfg.audit);
  spec.count = audit.count;
  spec.capped = audit.capped;
  spec.rescued = true;
  return spec;
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const c = contextOf(spec);
  const { n, trees, rowC, colC, total } = c;
  const par = spec.par || rowC.reduce((a, b) => a + b, 0);
  let st = new Uint8Array(total);
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let doneAt = 0;
  let paint = 0;          // 0 停, TENT 拖出帐篷, NO 拖出排除记号
  let last = null;
  let bad = null;         // badCells 的结果：只在盘面变脏时重算

  const mark = (i) => anim.set(i, nowMs());

  // 快照只搬盘面，绝不搬 moves：搭了又拆是一次试错，那一步得留在账上。
  function snapshot() {
    undoStack.push(Uint8Array.from(st));
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    bad = null;
  }

  function setCell(x, y, v, count = true) {
    const i = y * n + x;
    if (trees[i] || st[i] === v) return false;
    st[i] = v;
    mark(i);
    if (count && v === TENT) moves++;
    bad = null;
    return true;
  }

  function tentsOn() {
    let k = 0;
    for (let i = 0; i < total; i++) if (st[i] === TENT) k++;
    return k;
  }

  const won = () => tentsOn() === par && validateFlat(c, st);

  function afterChange() {
    bad = null;
    if (doneAt) return;
    if (!won()) return;
    doneAt = nowMs();
    // 收口：题面唯一 ⇒ 其余草地都不可能有帐篷，替玩家把副笔记号点上
    for (let i = 0; i < total; i++) if (!trees[i] && st[i] === UNKNOWN) { st[i] = NO; mark(i); }
  }

  // 与题面矛盾的格子：行数超了、帐篷贴身、孤帐无树、树被两顶帐篷抢、树已经配不到帐篷。
  function computeBad() {
    const out = new Set();
    const rows = new Int32Array(n);
    const cols = new Int32Array(n);
    for (let i = 0; i < total; i++) {
      if (st[i] !== TENT) continue;
      const x = i % n;
      rows[(i - x) / n]++;
      cols[x]++;
    }
    for (let i = 0; i < total; i++) {
      const x = i % n;
      const y = (i - x) / n;
      if (trees[i]) {
        let got = 0;
        const camps = [];
        for (let d = 0; d < 4; d++) {
          const nx = x + OX[d];
          const ny = y + OY[d];
          if (!inB(nx, ny, n)) continue;
          const j = ny * n + nx;
          if (st[j] === TENT) camps.push(j);
        }
        got = camps.length;
        if (got > 1) for (const j of camps) out.add(j);
        else if (got === 0) {
          let can = 0;
          for (let d = 0; d < 4; d++) {
            const nx = x + OX[d];
            const ny = y + OY[d];
            if (!inB(nx, ny, n)) continue;
            const j = ny * n + nx;
            if (trees[j] || st[j] !== UNKNOWN) continue;
            if (rows[ny] >= rowC[ny] || cols[nx] >= colC[nx]) continue;
            let touched = false;
            for (let e = 0; e < 8; e++) {
              const mx = nx + AX[e];
              const my = ny + AY[e];
              if (inB(mx, my, n) && st[my * n + mx] === TENT) { touched = true; break; }
            }
            if (!touched) can++;
          }
          if (can === 0) out.add(i);
        }
      } else if (st[i] === TENT) {
        if (rows[y] > rowC[y] || cols[x] > colC[x]) out.add(i);
        let mine = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + AX[d];
          const ny = y + AY[d];
          if (inB(nx, ny, n) && trees[ny * n + nx]) mine++;
        }
        if (mine !== 1) out.add(i);
        for (let d = 0; d < 8; d++) {
          const nx = x + AX[d];
          const ny = y + AY[d];
          if (!inB(nx, ny, n)) continue;
          const j = ny * n + nx;
          if (!trees[j] && st[j] === TENT) { out.add(i); out.add(j); }
        }
      }
    }
    return [...out].sort((p, q) => p - q).map((i) => [i % n, (i - (i % n)) / n]);
  }

  const engine = {
    id: 'tents',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.9, t: 0.9, r: 0.3, b: 0.3 } },
    // par = 唯一解里的帐篷数（行线索之和）：一次落子最多搭一顶帐篷，所以它是可证的下界。
    stats: () => ({ moves, par, done: tentsOn(), total: par }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved: () => doneAt > 0,
    cellState: (x, y) => (trees[y * n + x] ? TREE : st[y * n + x]),
    isTree: (x, y) => !!trees[y * n + x],
    badCells: () => { if (!bad) bad = computeBad(); return bad; },

    down(x, y, btn = 0) {
      if (x < 0 || y < 0 || x >= n || y >= n || doneAt) return false;
      const i = y * n + x;
      if (trees[i]) return false;                       // 树坑：主笔副笔都动不了
      snapshot();
      let changed;
      if (btn === 1) {
        // 副笔是记事本：标"这格不放帐篷"，擦掉标记 —— 都不落子，所以一律不收步
        if (st[i] === TENT) { undoStack.pop(); return false; }
        paint = st[i] === NO ? 0 : NO;
        changed = setCell(x, y, st[i] === NO ? UNKNOWN : NO, false);
      } else {
        const next = st[i] === TENT ? UNKNOWN : TENT;
        paint = next === TENT ? TENT : 0;
        changed = setCell(x, y, next);                  // 空 → 帐篷收一步；拆掉不退账
      }
      last = { x, y };
      if (changed) afterChange(); else undoStack.pop();
      return changed;
    },

    move(x, y) {
      if (!paint || doneAt) return false;
      if (x < 0 || y < 0 || x >= n || y >= n) return false;
      if (last && last.x === x && last.y === y) return false;
      const from = last || { x, y };
      let changed = false;
      for (const [px, py] of bresenham(from.x, from.y, x, y)) {
        last = { x: px, y: py };
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        const i = py * n + px;
        if (trees[i] || st[i] === paint) continue;
        if (st[i] === TENT) continue;                   // 拖动只往下落子，不替玩家拆帐篷
        if (!changed) snapshot();
        setCell(px, py, paint, paint === TENT);
        changed = true;
      }
      if (changed) afterChange();
      return changed;
    },

    up() { paint = 0; last = null; return false; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(Uint8Array.from(st));
      st = Uint8Array.from(undoStack.pop());
      doneAt = 0;
      bad = null;
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(Uint8Array.from(st));
      st = Uint8Array.from(redoStack.pop());
      bad = null;
      if (won()) doneAt = nowMs();
      return true;
    },

    hint() {
      if (doneAt) return null;
      const g = Uint8Array.from(st);
      if (propagate(c, g)) {
        const tents = [];
        const clears = [];
        for (let i = 0; i < total; i++) {
          if (trees[i] || st[i] !== UNKNOWN) continue;
          if (g[i] === TENT) tents.push(i);
          else if (g[i] === NO) clears.push(i);
        }
        if (tents.length) return place(tents.sort((a, b) => a - b)[0], TENT, '规则逼出来的一顶：除了这一格，那棵树没别处可搭');
        if (clears.length) return place(clears.sort((a, b) => a - b)[0], NO, '这一格再搭帐篷，别处就配不齐树了');
      } else {
        for (let i = 0; i < total; i++) if (st[i] === TENT && !validateFlatOne(c, st, i)) return place(i, UNKNOWN, '这一顶与题面冲突，先拆掉它');
      }
      const { witness } = countSolutions(spec, 1, st, cfgBudget());
      if (!witness) return null;
      for (let i = 0; i < total; i++) {
        if (trees[i] || st[i] !== UNKNOWN) continue;
        if (witness[i] === TENT) return place(i, TENT, '走到岔路口：先按这格搭一顶，看它逼出什么');
      }
      for (let i = 0; i < total; i++) {
        if (trees[i] || st[i] !== UNKNOWN) continue;
        if (witness[i] === NO) return place(i, NO, '推不动了：这一格可以排除');
      }
      return null;
    },

    draw(ctx, v, t) { render(ctx, v, { trees, st, anim, rowC, colC, t, reveal: 0, done: doneAt > 0 }); },
    celebrate(ctx, v, t, k) { render(ctx, v, { trees, st, anim, rowC, colC, t, reveal: k, done: true }); },
  };

  function place(i, v, why) {
    const x = i % n;
    const y = (i - x) / n;
    snapshot();
    setCell(x, y, v, v === TENT);
    afterChange();
    const left = par - tentsOn();
    return { cells: [[x, y]], note: left > 0 ? `${why}（还差 ${left} 顶）` : why };
  }

  function cfgBudget() {
    return tierOf(spec.n).audit * 4;
  }

  return engine;
}

// 单独一格是否还与题面相容：提示先拆错子时用（错的那一顶留着，后面推什么都没意义）。
function validateFlatOne(c, st, i) {
  const { n, trees, nearTree } = c;
  if (st[i] !== TENT) return true;
  if (trees[i] || !nearTree[i]) return false;
  const x = i % n;
  const y = (i - x) / n;
  let mine = 0;
  let touching = false;
  for (let d = 0; d < 8; d++) {
    const nx = x + AX[d];
    const ny = y + AY[d];
    if (!inB(nx, ny, n)) continue;
    const j = ny * n + nx;
    if (trees[j]) { if (d < 4) mine++; continue; }
    if (st[j] === TENT) touching = true;
  }
  if (touching || mine > 1) return false;
  let rows = 0;
  let cols = 0;
  for (let k = 0; k < n; k++) {
    if (st[y * n + k] === TENT) rows++;
    if (st[k * n + x] === TENT) cols++;
  }
  return rows <= c.rowC[y] && cols <= c.colC[x];
}

function bresenham(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let k = 0; k < 128; k++) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

// ---- 渲染 -----------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  const ml = 0.9 * cell;                              // 与 engine.board.margin 的 l/t 同一个口径
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  const c0 = (cols - 1) / 2;
  const c1 = (rows - 1) / 2;
  const span = Math.hypot(c0, c1) || 1;
  const fs = Math.max(9, cell * 0.42);

  const rowTally = new Int32Array(rows);
  const colTally = new Int32Array(cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (s.st[y * cols + x] === TENT) { rowTally[y]++; colTally[x]++; }
    }
  }
  for (let y = 0; y < rows; y++) {
    const want = s.rowC[y];
    const done = rowTally[y] === want;
    label(ctx, String(want), ox - ml / 2 - ml * 0.1, oy + (y + 0.55) * cell,
      { size: fs, color: done ? T.inkFaint : T.ink, bold: !done, mono: true });
  }
  for (let x = 0; x < cols; x++) {
    const want = s.colC[x];
    const done = colTally[x] === want;
    label(ctx, String(want), ox + (x + 0.5) * cell, oy - ml / 2 - ml * 0.08,
      { size: fs, color: done ? T.inkFaint : T.ink, bold: !done, mono: true });
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const t0 = s.anim.get(i);
      const k = !t0 || v.reduce ? 1 : easeOut(clamp((s.t - t0) / 170, 0, 1));
      const wave = s.reveal && !v.reduce
        ? 0.35 + 0.65 * easeOut(clamp(s.reveal * 2.2 - Math.hypot(x - c0, y - c1) / span, 0, 1))
        : 1;
      if (s.trees[i]) { treeGlyph(ctx, v, x, y, wave); continue; }
      const val = s.st[i];
      if (val === TENT) tentGlyph(ctx, v, x, y, wave * (0.55 + 0.45 * k), s.reveal ? 1 : k);
      else if (val === NO) crossMark(ctx, v, x, y, rgba(T.inkFaint, 0.75), 0.62 + 0.38 * k);
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
      ctx.save();
      ctx.strokeStyle = rgba(T.ink, 0.2 + 0.12 * pulse(s.t));
      ctx.lineWidth = 1.6;
      roundRect(ctx, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2, cell * 0.16);
      ctx.stroke();
      if (!s.trees[y * cols + x] && s.st[y * cols + x] !== TENT) ghostTent(ctx, v, x, y);
      ctx.restore();
    }
  }
}

// 树：一笔三角加一截树干。题面给的东西要压得住，别跟玩家搭的帐篷混起来。
function treeGlyph(ctx, v, x, y, wave = 1) {
  const cell = v.cell;
  const cx = v.ox + x * cell + cell / 2;
  const cy = v.oy + y * cell + cell / 2;
  const r = cell * 0.3;
  ctx.save();
  ctx.fillStyle = rgba(T.good, 0.82 * wave);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.25);
  ctx.lineTo(cx + r * 0.78, cy + r * 0.42);
  ctx.lineTo(cx - r * 0.78, cy + r * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(T.ink, 0.55);
  ctx.lineWidth = Math.max(1, cell * 0.045);
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.42);
  ctx.lineTo(cx, cy + r * 0.95);
  ctx.stroke();
  ctx.restore();
}

// 帐篷：斜撑的一笔，墨色比树重 —— 一眼分得清哪是题面、哪是我搭的。
function tentGlyph(ctx, v, x, y, scale = 1, k = 1) {
  const cell = v.cell;
  const cx = v.ox + x * cell + cell / 2;
  const cy = v.oy + y * cell + cell / 2;
  const w = cell * 0.34 * Math.max(0.2, scale);
  const h = cell * 0.3 * Math.max(0.2, scale);
  ctx.save();
  ctx.fillStyle = rgba(T.accent, 0.2 + 0.62 * k);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx + w, cy + h);
  ctx.lineTo(cx - w, cy + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(T.ink, 0.72 * Math.max(0.3, k));
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx, cy + h);
  ctx.stroke();
  ctx.restore();
}

function ghostTent(ctx, v, x, y) {
  ctx.save();
  ctx.globalAlpha = 0.24;
  tentGlyph(ctx, v, x, y, 1, 1);
  ctx.restore();
}

export default {
  id: 'tents',
  title: '帐篷',
  latin: 'TENTS',
  tagline: '每棵树配一顶帐篷，谁也挨不着谁',
  unit: '顶',
  rules: [
    '每棵树旁边必须挨着一顶帐篷（横竖相邻，斜着不算）。',
    '每行、每列的帐篷数必须等于该行/列给出的数字。',
    '帐篷与帐篷不得相邻 —— 连斜角也不行。',
    '帐篷只能建在草地上；标"树"的格子里不能放帐篷。副笔用来标"这格一定不放帐篷"。',
  ],
  sizes: TIERS.map(({ key, label, tier }) => ({ key, label, tier })),
  generate,
  create,
};
