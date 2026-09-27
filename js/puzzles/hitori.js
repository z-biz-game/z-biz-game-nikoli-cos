// 隔离 / Hitori —— 划掉一些格子，剩下的数字在行与列里互不见面。
//
// 题面只有一样东西：一张 n×n 的数字盘。解是"黑格集合"，三条规则把它夹得很死：
//   · 黑格之间不得四邻相接（这一条顺带管住了 2×2：一个 2×2 挑三枚黑必有两枚四邻相接，
//     所以"任意 2×2 不全黑"是这四邻不相接的推论，求解器不必单独查它）
//   · 白格被黑格切成一段一段，每段里的数字互不相同
//   · 所有白格整体四连通
//
// 出题走"先定黑格、再反推数字盘"，而不是随机数字盘 + 筛唯一。实测过后者走不通：6×6 随机
// 数字盘 60 张里，值域 5 只剩 1 张唯一，值域 6 倒有 47 张干脆无解 —— 随机盘的数字太稀疏，
// 约束既不够钉住唯一解、又常常互相打架。反过来先摆黑格，题面才钉得住：
//   1. 随机长出一张合法黑盘（黑格不四邻相接、白格连通，至少六分之一是黑格）
//   2. 黑格 → 它能掩护的邻格（挨着它的那枚白格）跑二分图匹配（Hopcroft–Karp）：
//      配不满 ⇒ 有黑格谁也掩护不了，那张盘缝不出题面，换盘
//   3. 每对缝上同一个数字：相邻两枚同数字格是一副"钳子"，中间插不进黑格去隔开，同白就撞数、
//      同黑又违邻接 ⇒ 任何解里恰有一黑。没缝上的白格也优先抄一枚相邻黑格的数字，多几副钳子
//   4. 数解器数一遍：多解就拿"另一道解"当靶子钉数字（见 coverMoves），一钉死一个解，直到唯一
// 第 3 步只保证"这套黑格是解"，唯一性一律由第 4 步的带计数求解器实测证明；数不完（capped）
// 就判废，绝不当"没有解"用。最后一手是抄在代码里的三张实测唯一盘，generate 因此不会交白卷。
//
// 求解器同时负四责：判胜负（黑格自成一套合法解）、出提示（数解数取必黑的格）、生成期收口、
// 生成期筛。10×10 塞不进一个位掩码，状态一律 Uint8Array。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, roundRect, label, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const UNKNOWN = 0;
export const BLACK = 1;
export const WHITE = 2;   // 副笔的小圆点：玩家自己确认"这格保留"，不计入 moves

const BUDGET = 300000;
const LOOP_CAP = 4;             // 收口每轮只数到 4 个解：多出来的解下一轮再杀，省下的是大头
const LOOP_BUDGET = 12000;      // 单轮的节点上限；唯一性交给最后一手全预算复核

// 每档的数字值域：值域越窄，噪声格之间撞得越勤、题面越紧；宽了就像字母汤，也缝不出钳子。
// v 不超过 9：盘面上的数字是一位数，画在格子里才不挤。
const TIERS = [
  { key: 6, label: '6×6', tier: '入门', v: 6 },
  { key: 8, label: '8×8', tier: '经典', v: 7 },
  { key: 10, label: '10×10', tier: '进阶', v: 9 },
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];


const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---- 盘面工具 -------------------------------------------------------------------

export function neighbors4(i, n) {
  const x = i % n;
  const y = (i - x) / n;
  const out = [];
  if (y > 0) out.push(i - n);
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y < n - 1) out.push(i + n);
  return out;
}

// 落子顺序按对角线 x+y 递增：一段数字要等两端都落了子才查得出重复，挨得近的格越早成对，
// 剪枝就来得早。
function diagOrder(n) {
  const out = [];
  for (let s = 0; s <= 2 * (n - 1); s++) {
    for (let y = 0; y < n; y++) {
      const x = s - y;
      if (x >= 0 && x < n) out.push(y * n + x);
    }
  }
  return out;
}

const flat = (spec) => spec.nums.flat();

const toBlackArray = (n, black) => {
  const out = new Uint8Array(n * n);
  if (typeof black.length === 'number' && black.length === n * n) out.set(black);
  else for (const c of black) out[c[1] * n + c[0]] = 1;
  return out;
};

// 段：行/列里被黑格切断的连续非黑格，只有同段的白格才算"互见"。
export function segments(n, st) {
  const out = [];
  for (let y = 0; y < n; y++) {
    let run = [];
    for (let x = 0; x <= n; x++) {
      const i = y * n + x;
      if (x < n && st[i] !== BLACK) run.push(i);
      else { if (run.length > 1) out.push(run); run = []; }
    }
  }
  for (let x = 0; x < n; x++) {
    let run = [];
    for (let y = 0; y <= n; y++) {
      const i = y * n + x;
      if (y < n && st[i] !== BLACK) run.push(i);
      else { if (run.length > 1) out.push(run); run = []; }
    }
  }
  return out;
}

// 非黑格的连通块（空格当成可走）：黑格只切断，不切断就不新建块。
function components(n, st) {
  const total = n * n;
  const seen = new Uint8Array(total);
  const out = [];
  for (let i = 0; i < total; i++) {
    if (seen[i] || st[i] === BLACK) continue;
    const comp = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const j of neighbors4(c, n)) if (!seen[j] && st[j] !== BLACK) { seen[j] = 1; stack.push(j); }
    }
    out.push(comp);
  }
  return out;
}

// ---- 规则本身（引擎判胜负、闪红都用它；测试里另有一份独立校验器对拍） -------------

// 只看黑格集合：把它之外的格一律当白格，三条规则全过才算一套完整解。
export function isLegalBlackSet(n, nums, blackLike) {
  const total = n * n;
  const black = toBlackArray(n, blackLike);
  const st = new Uint8Array(total);
  for (let i = 0; i < total; i++) st[i] = black[i] ? BLACK : WHITE;
  for (let i = 0; i < total; i++) {
    if (!black[i]) continue;
    for (const j of neighbors4(i, n)) if (black[j]) return false;
  }
  for (const seg of segments(n, st)) {
    const seen = new Set();
    for (const i of seg) {
      if (seen.has(nums[i])) return false;
      seen.add(nums[i]);
    }
  }
  return components(n, st).length === 1;
}

// 与题面矛盾之处：相邻的黑格、同段里重复的数字、被黑格封死且再也接不上的白格。
export function conflictsOf(n, nums, st) {
  const total = n * n;
  const bad = new Set();
  for (let i = 0; i < total; i++) {
    if (st[i] !== BLACK) continue;
    for (const j of neighbors4(i, n)) if (st[j] === BLACK && j > i) { bad.add(i); bad.add(j); }
  }
  for (const seg of segments(n, st)) {
    const first = new Map();
    for (const i of seg) {
      if (st[i] === UNKNOWN) continue;
      if (first.has(nums[i])) { bad.add(i); bad.add(first.get(nums[i])); } else first.set(nums[i], i);
    }
  }
  const comps = components(n, st);
  if (comps.length > 1) {
    for (const comp of comps) if (comp.every((i) => st[i] === WHITE)) for (const i of comp) bad.add(i);
  }
  return [...bad].sort((a, b) => a - b).map((i) => [i % n, (i - (i % n)) / n]);
}

// ---- 真求解器：约束传播 + 回溯计数 ------------------------------------------------

// 钳子：四邻相接又同数字的两格。它们之间没有第三格可插黑，所以不能同白；同黑又违规，
// 所以恰有一黑。这条既是传播的推力，也是出题钉题面用的钉子。
function clampPairs(n, nums) {
  const out = Array.from({ length: n * n }, () => []);
  for (let i = 0; i < n * n; i++) {
    for (const j of neighbors4(i, n)) if (j > i && nums[i] === nums[j]) { out[i].push(j); out[j].push(i); }
  }
  return out;
}

// given 是已定的部分标注（0 自由）。返回 { count, capped, nodes, solutions }：
// count 数到 cap 早停；capped=true 只说明预算烧完没数完，绝不等于"没有解"。
function search(n, nums, given, cap = 2, keep = true, budget = BUDGET) {
  const total = n * n;
  const st = Uint8Array.from(given || new Uint8Array(total));
  const twins = clampPairs(n, nums);
  const order = diagOrder(n);
  let maxVal = 1;
  for (const v of nums) if (v > maxVal) maxVal = v;
  const stamp = new Int32Array(maxVal + 1);
  let ticket = 0;
  const work = [];
  const trail = [];
  let nodes = 0;
  let count = 0;
  let capped = false;
  const solutions = [];

  const put = (i, v) => {
    if (st[i] === v) return true;
    if (st[i] !== UNKNOWN) return false;
    st[i] = v;
    trail.push(i);
    work.push(i);
    return true;
  };

  const undoTo = (mark) => {
    work.length = 0;
    while (trail.length > mark) st[trail.pop()] = UNKNOWN;
  };

  const spanRow = (x, y) => {
    let lo = x;
    let hi = x;
    while (lo > 0 && st[y * n + lo - 1] !== BLACK) lo--;
    while (hi < n - 1 && st[y * n + hi + 1] !== BLACK) hi++;
    const out = [];
    for (let c = lo; c <= hi; c++) out.push(y * n + c);
    return out;
  };
  const spanCol = (x, y) => {
    let lo = y;
    let hi = y;
    while (lo > 0 && st[(lo - 1) * n + x] !== BLACK) lo--;
    while (hi < n - 1 && st[(hi + 1) * n + x] !== BLACK) hi++;
    const out = [];
    for (let r = lo; r <= hi; r++) out.push(r * n + x);
    return out;
  };
  // 黑格落下的那一格自己不是段的一部分：它把横竖两条都劈成两半，两半得各查各的，
  // 从黑格出发扩会一路穿过它、把左右（上下）当成同一段而误报重复。
  const spansAfterBlack = (x, y) => {
    const out = [];
    if (x > 0 && st[y * n + x - 1] !== BLACK) out.push(spanRow(x - 1, y));
    if (x < n - 1 && st[y * n + x + 1] !== BLACK) out.push(spanRow(x + 1, y));
    if (y > 0 && st[(y - 1) * n + x] !== BLACK) out.push(spanCol(x, y - 1));
    if (y < n - 1 && st[(y + 1) * n + x] !== BLACK) out.push(spanCol(x, y + 1));
    return out;
  };

  // 段里两枚同数字白格：中间已经没有空格可放黑 ⇒ 它们注定同段，撞数了；
  // 只剩一枚空格可放黑 ⇒ 那格必黑。注意不能"整段查重"就判死 —— 中间还有空格时，
  // 黑格随时可能落进去把它们隔开，那是不合法的剪枝（曾把真解一起剪掉）。
  const checkSpan = (cells) => {
    for (let a = 0; a < cells.length; a++) {
      if (st[cells[a]] !== WHITE) continue;
      for (let b = cells.length - 1; b > a; b--) {
        const u = cells[a];
        const v = cells[b];
        if (st[v] !== WHITE || nums[u] !== nums[v]) continue;
        let free = 0;
        let only = -1;
        for (let c = a + 1; c < b; c++) {
          const k = cells[c];
          if (st[k] === BLACK) break;
          if (st[k] === UNKNOWN) { free++; only = k; }
        }
        if (free === 0) return false;
        if (free === 1 && !put(only, BLACK)) return false;
      }
    }
    return true;
  };

  // i 所在的那块白地已被黑格围死，围外还另有定死的白格 —— 两块白再也接不上。
  // 只能拿"已定死的白格"算块：空格随时可能变黑，把它们算进去会虚增一整片，
  // 于是"这块没占满非黑格"根本不构成矛盾（曾这样误判，把真解一起剪掉、count 直接归零）。
  const sealed = (i) => {
    const seen = new Uint8Array(total);
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      for (const j of neighbors4(c, n)) {
        if (seen[j] || st[j] === BLACK) continue;
        if (st[j] === UNKNOWN) return true;   // 边上还有空格，这块就没封死
        seen[j] = 1;
        stack.push(j);
      }
    }
    for (let k = 0; k < total; k++) if (st[k] === WHITE && !seen[k]) return false;
    return true;
  };

  const propagate = () => {
    while (work.length) {
      const i = work.pop();
      const x = i % n;
      const y = (i - x) / n;
      if (st[i] === BLACK) {
        for (const j of neighbors4(i, n)) if (!put(j, WHITE)) return false;
        for (const j of neighbors4(i, n)) {
          let around = 0;
          for (const k of neighbors4(j, n)) if (st[k] === BLACK) around++;
          // 四邻全黑的那格只能留白，可一留白就是座孤岛
          if (around === 4) return false;
        }
        for (const span of spansAfterBlack(x, y)) if (!checkSpan(span)) return false;
      } else if (st[i] === WHITE) {
        for (const j of twins[i]) if (!put(j, BLACK)) return false;
        if (!checkSpan(spanRow(x, y))) return false;
        if (!checkSpan(spanCol(x, y))) return false;
        let free = 0;
        for (const j of neighbors4(i, n)) if (st[j] !== BLACK) free++;
        if (free === 0) return false;
        if (!sealed(i)) return false;
      }
    }
    return true;
  };

  const dfs = (depth) => {
    if (++nodes > budget) { capped = true; return true; }
    while (depth < total && st[order[depth]] !== UNKNOWN) depth++;
    if (depth >= total) {
      if (components(n, st).length !== 1) return false;
      count++;
      if (keep && solutions.length < cap) solutions.push(Uint8Array.from(st));
      return count >= cap;
    }
    const i = order[depth];
    const mark = trail.length;
    // 先试黑：黑格就是这玩法的落子，先撞正解分支，提示和生成器都能少跑一半
    for (const v of [BLACK, WHITE]) {
      undoTo(mark);
      trail.push(i);
      st[i] = v;
      work.push(i);
      if (!propagate()) continue;
      if (dfs(depth + 1)) { undoTo(mark); return true; }
      if (capped) return true;
    }
    return false;
  };

  for (let i = 0; i < total; i++) if (st[i] !== UNKNOWN) work.push(i);
  if (propagate()) dfs(0);
  return { count, capped, nodes, solutions };
}

// 数这道题有几个解：数到 cap 就早停。
export function countSolutions(spec, cap = 2) {
  const r = search(spec.n, flat(spec), null, Math.max(1, cap), false, BUDGET);
  return { count: r.count, capped: r.capped, nodes: r.nodes };
}

// 与当前标注相容的一个解；唯一解的题面上它就是那条正解，走进死局返回 null。
export function solveFrom(spec, st) {
  const r = search(spec.n, flat(spec), st, 1, true, BUDGET);
  return r.capped ? null : r.solutions[0] || null;
}

// 提示的根据：数到两个解。只有一个解 ⇒ 那解里的黑格必黑；两个解共同的黑格仍必黑。
export function forcedBlacks(spec, st, budget = BUDGET) {
  const r = search(spec.n, flat(spec), st, 2, true, budget);
  if (r.capped || !r.solutions.length) return { forced: [], ambiguous: true };
  if (r.solutions.length === 1) return { forced: indices(r.solutions[0], BLACK), ambiguous: false };
  const [a, b] = r.solutions;
  return { forced: a.map((v, i) => (v === BLACK && b[i] === BLACK ? i : -1)).filter((i) => i >= 0), ambiguous: true };
}

const indices = (arr, v) => {
  const out = [];
  for (let i = 0; i < arr.length; i++) if (arr[i] === v) out.push(i);
  return out;
};

// ---- 出题 -----------------------------------------------------------------------

// 长在手中的黑盘要一直合法：黑格不四邻相接、白格连成一片（2×2 由邻接条款自动管住）。
function growable(n, black) {
  const total = n * n;
  for (let i = 0; i < total; i++) {
    if (!black[i]) continue;
    for (const j of neighbors4(i, n)) if (black[j]) return false;
  }
  const st = new Uint8Array(total);
  for (let i = 0; i < total; i++) st[i] = black[i] ? BLACK : UNKNOWN;
  return components(n, st).length === 1;
}

function growBlackBoard(n, rng) {
  const total = n * n;
  const black = new Uint8Array(total);
  for (const i of rng.shuffle(Array.from({ length: total }, (_, k) => k))) {
    black[i] = 1;
    if (!growable(n, black)) black[i] = 0;
  }
  // 太稀的黑盘数字盘会整片空着，看着不像题：补到至少六分之一
  for (const i of rng.shuffle(Array.from({ length: total }, (_, k) => k))) {
    let got = 0;
    for (let k = 0; k < total; k++) got += black[k];
    if (got >= Math.ceil(total / 6)) break;
    if (black[i]) continue;
    black[i] = 1;
    if (!growable(n, black)) black[i] = 0;
  }
  let got = 0;
  for (let k = 0; k < total; k++) got += black[k];
  return got >= Math.ceil(total / 6) ? black : null;
}

// Hopcroft–Karp：黑格 → 它能掩护的那枚邻格。配不满时顺手取 König 对偶证书
// （覆盖住所有边的格集）：落在证书里的黑格连"同数字的邻格"都缝不出来，整张盘判死。
function matchCovers(n, black) {
  const total = n * n;
  const left = [];
  const adj = new Map();
  for (let i = 0; i < total; i++) {
    if (!black[i]) continue;
    left.push(i);
    adj.set(i, neighbors4(i, n).filter((j) => !black[j]));
  }
  const mateL = new Map();
  const mateR = new Int32Array(total).fill(-1);
  const dist = new Map();
  const freeLeft = () => left.filter((b) => !mateL.has(b));

  const bfs = () => {
    const q = freeLeft();
    for (const b of left) dist.set(b, q.indexOf(b) >= 0 ? 0 : -1);
    let found = false;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of adj.get(u)) {
        const w = mateR[v];
        if (w === -1) { found = true; continue; }
        if (dist.get(w) === -1) { dist.set(w, dist.get(u) + 1); q.push(w); }
      }
    }
    return found;
  };
  const aug = (u) => {
    for (const v of adj.get(u)) {
      const w = mateR[v];
      if (w === -1 || (dist.get(w) === dist.get(u) + 1 && aug(w))) { mateL.set(u, v); mateR[v] = u; return true; }
    }
    dist.set(u, -1);
    return false;
  };
  while (bfs()) for (const b of freeLeft()) aug(b);
  if (mateL.size === left.length) return { pairs: left.map((b) => [b, mateL.get(b)]), cover: null };

  const reach = new Uint8Array(total);
  const q = freeLeft();
  for (const b of q) reach[b] = 1;
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of adj.get(u)) {
      if (reach[v]) continue;
      reach[v] = 1;
      const w = mateR[v];
      if (w !== -1 && !reach[w]) { reach[w] = 1; q.push(w); }
    }
  }
  const cover = new Set();
  for (const b of left) if (reach[b]) cover.add(b);
  for (let i = 0; i < total; i++) if (!black[i] && reach[i]) cover.add(i);
  return { pairs: null, cover };
}

// 缝数字：先给每对钳子一个值（同一行/列段里不许撞值，撞了就只能换值），
// 再给没缝上的格撒噪声。撒不出来返回 null，调用方换盘。
function stitchNums(n, black, pairs, v, rng) {
  const total = n * n;
  const nums = new Int32Array(total);
  const used = new Int32Array(v + 1);
  const domain = Array.from({ length: v }, (_, k) => k + 1);
  const clash = (x, y, val) => {
    for (const dir of [[1, 0], [0, 1]]) {
      for (const sign of [-1, 1]) {
        let cx = x + sign * dir[0];
        let cy = y + sign * dir[1];
        while (cx >= 0 && cy >= 0 && cx < n && cy < n && !black[cy * n + cx]) {
          if (nums[cy * n + cx] === val) return true;
          cx += sign * dir[0];
          cy += sign * dir[1];
        }
      }
    }
    return false;
  };
  // 挑一个几处都不撞的值，并且是当下用得最少的 —— 数字分布均匀，题面才不像字母汤
  const choose = (spots) => {
    let best = -1;
    let least = Infinity;
    for (const val of rng.shuffle(domain.slice())) {
      if (spots.some(([sx, sy]) => clash(sx, sy, val))) continue;
      if (used[val] < least) { least = used[val]; best = val; }
      else if (used[val] === least && rng() < 0.25) best = val;
    }
    return best;
  };
  // 没缝上的白格优先抄一枚相邻黑格的数字：相接两格同数字就是一把新钳子（任何解里这对其余
  // 恰有一黑），约束密度立刻上去，收口要补的钉子就少得多。抄不到才退回"用得最少的值"。
  const chooseNear = (i, spots) => {
    for (const val of rng.shuffle(neighbors4(i, n).filter((j) => black[j] && nums[j]).map((j) => nums[j]))) {
      if (!spots.some(([sx, sy]) => clash(sx, sy, val))) return val;
    }
    return choose(spots);
  };
  for (const [b, w] of pairs) {
    const bx = b % n;
    const by = (b - bx) / n;
    const wx = w % n;
    const wy = (w - wx) / n;
    const val = choose([[bx, by], [wx, wy]]);
    if (val < 0) return null;
    nums[by * n + bx] = val;
    nums[wy * n + wx] = val;
    used[val] += 2;
  }
  for (const i of rng.shuffle(Array.from({ length: total }, (_, k) => k))) {
    if (nums[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    const val = chooseNear(i, [[x, y]]);
    if (val < 0) return null;
    nums[i] = val;
    used[val]++;
  }
  return nums;
}

function specOf(n, cfg, nums, blackLike, seed, extra) {
  const black = toBlackArray(n, blackLike);
  const total = n * n;
  const view = new Uint8Array(total);
  for (let i = 0; i < total; i++) view[i] = nums[i];
  const blacks = [];
  for (let i = 0; i < total; i++) if (black[i]) blacks.push([i % n, (i - (i % n)) / n]);
  return {
    kind: 'hitori',
    n,
    v: cfg.v,
    nums: Array.from({ length: n }, (_, y) => Array.from(view.subarray(y * n, y * n + n))),
    par: blacks.length,
    blacks,
    seed: String(seed),
    tier: cfg.tier,
    ...(extra || {}),
  };
}

// 收口：题面多解时，从"另一道解"alt 里钉一枚约束进去，把 alt 撞死。
// p 在正解里是黑格、在 alt 里是白格 ⇒ 把 alt 里与 p 同段的任一白格 j 的数字改成 p 的数字：
// alt 中 p、j 同段又同数字，当场撞数而死；正解中 p 是黑格，它把横竖两条段都劈开，j 与 p
// 从不同段，改完正解依旧合法（每枚钉子都用 isLegalBlackSet 复核一遍，不靠推理）。
// 加约束只会让解集单调变小，所以每一枚钉子都在往唯一逼近；一枚钉子还能顺带杀死同段的
// 其它解，于是每轮做一次贪心集合覆盖，把手上枚举到的解一口气杀光，再重新数。
function coverMoves(n, nums, black, alts) {
  const kills = new Map();          // j*n*n+p → 这枚钉子能干掉的 alt 下标
  const cellOf = (key) => [Math.floor(key / (n * n)), key % (n * n)];
  for (let a = 0; a < alts.length; a++) {
    const alt = alts[a];
    for (let p = 0; p < n * n; p++) {
      if (!black[p] || alt[p] === BLACK) continue;
      const px = p % n;
      const py = (p - px) / n;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        for (const sign of [-1, 1]) {
          let cx = px + sign * dx;
          let cy = py + sign * dy;
          while (cx >= 0 && cy >= 0 && cx < n && cy < n && alt[cy * n + cx] !== BLACK) {
            const j = cy * n + cx;
            if (j !== p && nums[j] !== nums[p]) {
              const key = j * n * n + p;
              if (!kills.has(key)) kills.set(key, []);
              kills.get(key).push(a);
            }
            cx += sign * dx;
            cy += sign * dy;
          }
        }
      }
    }
  }
  const alive = new Set(alts.map((_, a) => a));
  const chosen = [];
  const targets = new Set();
  const sources = new Set();
  while (alive.size) {
    let bestKey = -1;
    let best = [];
    for (const [key, list] of kills) {
      const [j, p] = cellOf(key);
      // 一枚钉子改的是 j 的值：j 不能再是别的钉子的取值来源/落点，p 也不能刚被别的钉子改写过
      if (targets.has(j) || sources.has(j) || targets.has(p)) continue;
      const hit = list.filter((a) => alive.has(a));
      if (hit.length > best.length) { bestKey = key; best = hit; }
    }
    if (bestKey < 0) break;
    const [j, p] = cellOf(bestKey);
    targets.add(j);
    sources.add(p);
    chosen.push([j, p]);
    for (const a of best) alive.delete(a);
    kills.delete(bestKey);
  }
  return chosen;
}

function tryBuild(n, cfg, rng, seed) {
  const black = growBlackBoard(n, rng);
  if (!black) return null;
  const m = matchCovers(n, black);
  if (!m.pairs || !m.pairs.length) return null;
  const nums = stitchNums(n, black, m.pairs, cfg.v, rng);
  if (!nums || !isLegalBlackSet(n, nums, black)) return null;
  let r = search(n, nums, null, LOOP_CAP, true, LOOP_BUDGET);
  for (let round = 0; round < 40; round++) {
    if (!r.capped && r.count === 1) return specOf(n, cfg, nums, black, seed, null);
    const alts = r.solutions.slice(1);
    if (!alts.length) return null;
    const moves = coverMoves(n, nums, black, rng.shuffle(alts.slice()));
    if (!moves.length) return null;
    let applied = 0;
    for (const [j, p] of moves) {
      const old = nums[j];
      nums[j] = nums[p];
      if (isLegalBlackSet(n, nums, black)) applied++;
      else nums[j] = old;
    }
    if (!applied) return null;
    r = search(n, nums, null, LOOP_CAP, true, LOOP_BUDGET);
  }
  return null;
}

// 最后一手：实测唯一、直接抄在代码里的三张盘。一格一字符：1-9 是白格上的数字，A-I 是黑格上的
// 数字（A=1）—— 黑格也得带数字，否则题面缺角。三张盘在全预算数解器下各只数出 1 个解，
// 于是 generate 不必留"这道题可能出不来"那条分支。
const FROZEN = {
  6: '64D31A 5E4C61 2516F6 B2A365 216C34 B6F34D',
  8: 'F63C4D42 7G13752B 41A45E32 1A1D35C6 26741E3F B2G2A175 732B265E 3C326F65',
  10: '95E8H86F2B I93481A472 92C34D47G4 8B2716A14D H27G6F3594 15E479C3I9 A84D5I3692 1H35E96F2B 37815624G7 C8H8E2B276',
};

function frozenSpec(n, cfg, seed) {
  const rows = FROZEN[n].split(' ');
  const total = n * n;
  const nums = new Uint8Array(total);
  const black = new Uint8Array(total);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = rows[y][x];
      if (c >= 'A' && c <= 'I') {
        black[y * n + x] = 1;
        nums[y * n + x] = c.charCodeAt(0) - 64;
      } else nums[y * n + x] = Number(c);
    }
  }
  return specOf(n, cfg, nums, black, seed, { degraded: true });
}

export function generate(seed, sizeKey = 6) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const spec = tryBuild(n, cfg, rng, seed);
    if (spec) return spec;
  }
  return frozenSpec(n, cfg, seed);
}

// ---- 引擎 -----------------------------------------------------------------------

export function create(spec) {
  const n = spec.n;
  const total = n * n;
  const nums = flat(spec);
  let st = new Uint8Array(total);
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let doneAt = 0;
  let paint = 0;
  let last = null;
  let cache = null;

  function snapshot() {
    undoStack.push(Uint8Array.from(st));
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    cache = null;
  }

  function setCell(x, y, v, count = true) {
    const i = y * n + x;
    if (st[i] === v) return false;
    st[i] = v;
    anim.set(i, nowMs());
    // 只有"落一枚黑格"记账：小圆点是玩家的思考笔记，点错不亏步数
    if (count && v === BLACK) moves++;
    return true;
  }

  function blacksOn() {
    let c = 0;
    for (let i = 0; i < total; i++) c += st[i] === BLACK ? 1 : 0;
    return c;
  }

  function afterChange() {
    cache = null;
    if (doneAt) return;
    const black = new Uint8Array(total);
    let any = false;
    for (let i = 0; i < total; i++) if (st[i] === BLACK) { black[i] = 1; any = true; }
    // 题面只有唯一解 ⇒ "黑格自成一整套合法解"只可能正中那道解，剩下的小圆点替玩家点上
    if (any && isLegalBlackSet(n, nums, black)) {
      for (let i = 0; i < total; i++) if (st[i] !== BLACK) st[i] = WHITE;
      doneAt = nowMs();
    }
  }

  const engine = {
    id: 'hitori',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.26, t: 0.26, r: 0.26, b: 0.26 } },
    // par = 唯一解里的黑格数：一次落子最多涂黑一格，所以它是可证的下界。
    stats: () => ({ moves, par: spec.par || 0, done: blacksOn(), total: spec.par || 0 }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved: () => doneAt > 0,
    cellState: (x, y) => st[y * n + x],
    badCells: () => { if (!cache) cache = conflictsOf(n, nums, st); return cache; },

    down(x, y, btn) {
      if (x < 0 || y < 0 || x >= n || y >= n || doneAt) return false;
      const i = y * n + x;
      const want = btn === 1 ? (st[i] === WHITE ? UNKNOWN : WHITE) : (st[i] === BLACK ? UNKNOWN : BLACK);
      snapshot();
      const changed = setCell(x, y, want);
      paint = changed && want !== UNKNOWN ? want : 0;
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
        if (st[py * n + px] === paint) continue;
        if (!changed) snapshot();
        setCell(px, py, paint);
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
      cache = null;
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(Uint8Array.from(st));
      st = Uint8Array.from(redoStack.pop());
      cache = null;
      afterChange();
      return true;
    },

    hint() {
      if (doneAt) return null;
      const { forced, ambiguous } = forcedBlacks(spec, st);
      const fresh = forced.filter((i) => st[i] === UNKNOWN).sort((a, b) => a - b);
      let i = fresh.length ? fresh[0] : -1;
      let note = ambiguous ? '两个解里它都必须是黑格' : '唯一解里它必是黑格';
      if (i < 0) {
        const sol = solveFrom(spec, st);
        if (!sol) return null;
        const next = indices(sol, BLACK).filter((k) => st[k] === UNKNOWN).sort((a, b) => a - b)[0];
        if (next === undefined) return null;
        i = next;
        note = '走到岔路口：先假设这格是黑格，看它逼出什么';
      }
      const x = i % n;
      const y = (i - x) / n;
      snapshot();
      setCell(x, y, BLACK);
      afterChange();
      return { cells: [[x, y]], note };
    },

    draw(ctx, v, t) { render(ctx, v, { nums, st, anim, t, done: doneAt > 0, reveal: 0 }); },
    celebrate(ctx, v, t, k) { render(ctx, v, { nums, st, anim, t, done: true, reveal: k }); },
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
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  const c0 = (cols - 1) / 2;
  const c1 = (rows - 1) / 2;
  const span = Math.hypot(c0, c1) || 1;
  const fs = Math.max(10, cell * 0.44);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const val = s.st[i];
      const t0 = s.anim.get(i);
      const k = t0 && !v.reduce ? easeOut(clamp((s.t - t0) / 170, 0, 1)) : 1;
      const cx = ox + x * cell + cell / 2;
      const cy = oy + y * cell + cell / 2;
      const wave = s.reveal
        ? 0.25 + 0.75 * easeOut(clamp(s.reveal * 2.2 - Math.hypot(x - c0, y - c1) / span, 0, 1))
        : 1;
      if (val === BLACK) {
        const size = (cell - cell * 0.12) * wave * (0.55 + 0.45 * k);
        ctx.save();
        ctx.fillStyle = rgba(T.ink, 0.92);
        roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.16);
        ctx.fill();
        ctx.restore();
        // 墨块底下还留着那道被划掉的数字：通关那一格要看得出它原本是什么
        label(ctx, String(s.nums[i]), cx, cy, { size: fs * 0.8, color: rgba(T.card, 0.7 * wave) });
      } else {
        label(ctx, String(s.nums[i]), cx, cy, { size: fs, color: T.ink, bold: true });
        if (val === WHITE) {
          ctx.save();
          ctx.fillStyle = rgba(T.accent, 0.6);
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1.6, cell * 0.1 * (0.5 + 0.5 * k)), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  if (v.bad && v.bad.length) {
    ctx.save();
    ctx.strokeStyle = T.warn;
    ctx.lineWidth = 2;
    for (const [x, y] of v.bad) {
      roundRect(ctx, ox + x * cell + 1.5, oy + y * cell + 1.5, cell - 3, cell - 3, cell * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (v.hover && !s.reveal && !s.done) {
    const { x, y } = v.hover;
    if (x >= 0 && y >= 0 && x < cols && y < rows) {
      ctx.save();
      ctx.strokeStyle = rgba(T.ink, 0.22 + 0.12 * pulse(s.t));
      ctx.lineWidth = 1.6;
      roundRect(ctx, ox + x * cell + 1, oy + y * cell + 1, cell - 2, cell - 2, cell * 0.16);
      ctx.stroke();
      if (s.st[y * cols + x] === UNKNOWN) {
        const size = cell * 0.46;
        ctx.fillStyle = rgba(T.ink, 0.15);
        roundRect(ctx, ox + x * cell + (cell - size) / 2, oy + y * cell + (cell - size) / 2, size, size, size * 0.16);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

export default {
  id: 'hitori',
  title: '隔离',
  latin: 'HITORI',
  tagline: '划掉一些数字，让剩下的数字彼此互不见面',
  unit: '格',
  rules: [
    '每格印着一个数字。把若干格划掉（涂黑），剩下的都算保留。',
    '黑格之间不得上下左右相接，任意 2×2 里也不许四格全黑。',
    '同一行、同一列里，被黑格隔开的每一段数字不许重复 —— 中间有黑格挡着就不算见面。',
    '保留下来的白格必须连成一片，谁也不能被黑格封成孤岛。',
    '主笔点击涂黑、再点取消；副笔在格上点一枚小圆点，记下"这格我确认保留"，圆点不算一步。',
  ],
  sizes: TIERS.map(({ key, label: lb, tier }) => ({ key, label: lb, tier })),
  generate,
  create,
};
