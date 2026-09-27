// 数墙 / Nurikabe —— 数字数的是它四邻的墨，墨块的大小又正好等于某个数字。
//
// 两条口径叠在一起，把这道题变成一账就能核清的推理：
//   · 全盘墨格数 == 所有数字之和（一块一数字、不重复用，块的大小就是它对应的那个数字）
//   · 数字格自身必白，且它四邻的墨格数恰等于它 —— 所以数字既能催黑也能催白
// 全局墨量是这里最狠的剪枝：知道总共还要落几滴墨，就敢把剩下的空格整片判成海。
// 顺带一条推论：四邻最多四格，所以数字只会是 1~4，墨块也就不可能大于 4。
//
// 唯一解由带计数的求解器证明：数到第二种就早停；预算烧完如实报 capped，生成器据此丢题 ——
// 没数完不等于只有一种解（数织/孔明棋同一口径）。
//
// par = 唯一解的墨格数：一次落子至多把一格染成墨色，所以它是真下界。
// 圆点（确认为海）是记号不是落子，不计账 —— 与数织画叉同口径。

import { rngFrom } from '../core/rng.js';
import { T } from '../core/theme.js';
import { rules, label, roundRect, rgba, easeOut, clamp, pulse, paper } from '../core/paper.js';

export const EMPTY = 0;   // 未定
export const WHITE = 1;   // 海
export const BLACK = 2;   // 墨

const INK_MS = 150;
const MAX_V = 5;          // 数字上界的兜底数组长度（真实上限是 4：四邻只有四格）

// 邻接表与 2×2 窗口表按边长缓存：纯几何、与 seed 无关，缓存不改变任何一次判定。
const GEOM = new Map();
function geom(n) {
  let g = GEOM.get(n);
  if (g) return g;
  const n2 = n * n;
  const adj = new Int32Array(n2 * 4);
  const deg = new Uint8Array(n2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const push = (j) => { adj[i * 4 + deg[i]++] = j; };
      if (x > 0) push(i - 1);
      if (x < n - 1) push(i + 1);
      if (y > 0) push(i - n);
      if (y < n - 1) push(i + n);
    }
  }
  const win = new Int32Array((n - 1) * (n - 1) * 4);
  let at = 0;
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      win[at++] = i; win[at++] = i + 1; win[at++] = i + n; win[at++] = i + n + 1;
    }
  }
  g = { adj, deg, win };
  GEOM.set(n, g);
  return g;
}

export function clueMap(n, clues) {
  const val = new Int16Array(n * n);
  for (const [i, v] of clues) val[i] = v;
  return val;
}

// 一整盘颜色是否合规则（未落满一律算不通过）：引擎判胜、求解数叶子都只看这一条。
export function rulesOk(n, val, color) {
  const { adj, deg, win } = geom(n);
  const n2 = n * n;
  const need = new Int16Array(MAX_V);
  const got = new Int16Array(MAX_V);
  for (let i = 0; i < n2; i++) {
    const c = color[i];
    if (c === EMPTY) return false;
    if (!val[i]) continue;
    if (c !== WHITE) return false;                 // 数字格自身必白
    if (val[i] >= MAX_V) return false;
    let b = 0;
    for (let k = 0; k < deg[i]; k++) if (color[adj[i * 4 + k]] === BLACK) b++;
    if (b !== val[i]) return false;
    need[val[i]]++;
  }
  for (let w = 0; w < win.length; w += 4) {
    if (color[win[w]] === WHITE && color[win[w + 1]] === WHITE
      && color[win[w + 2]] === WHITE && color[win[w + 3]] === WHITE) return false;
  }
  const lab = new Int32Array(n2).fill(-1);
  const stack = new Int32Array(n2);
  for (let i = 0; i < n2; i++) {
    if (color[i] !== BLACK || lab[i] >= 0) continue;
    let top = 0;
    let s = 0;
    stack[top++] = i;
    lab[i] = i;
    while (top) {
      const c = stack[--top];
      s++;
      for (let k = 0; k < deg[c]; k++) {
        const j = adj[c * 4 + k];
        if (color[j] === BLACK && lab[j] < 0) { lab[j] = i; stack[top++] = j; }
      }
    }
    if (s >= MAX_V) return false;
    got[s]++;
  }
  for (let s = 1; s < MAX_V; s++) if (need[s] !== got[s]) return false;
  return seaConnected(n, color, null);
}

// 海是不是只剩一整片；from 给了就把这一片的格子填进 into，返回格数。
export function seaConnected(n, color, into, from) {
  const { adj, deg } = geom(n);
  const n2 = n * n;
  let start = from === undefined ? -1 : from;
  if (start < 0) {
    for (let i = 0; i < n2; i++) if (color[i] === WHITE) { start = i; break; }
    if (start < 0) return 0;
  }
  const seen = new Uint8Array(n2);
  const stack = new Int32Array(n2);
  let top = 0;
  let count = 0;
  seen[start] = 1;
  stack[top++] = start;
  while (top) {
    const c = stack[--top];
    count++;
    if (into) into.push(c);
    for (let k = 0; k < deg[c]; k++) {
      const j = adj[c * 4 + k];
      if (color[j] === WHITE && !seen[j]) { seen[j] = 1; stack[top++] = j; }
    }
  }
  if (into) return count;
  for (let i = 0; i < n2; i++) if (color[i] === WHITE && !seen[i]) return false;
  return true;
}

// ---- 求解器 -----------------------------------------------------------------------
// 传播 + 回溯。传播只写"逻辑上被逼定"的格，所以数出来的解是真解；
// 每一步都是四选一里的一格黑白，分支穷尽 ⇒ 不漏解。预算烧完报 capped，绝不声称唯一。
function context(n, clues) {
  const val = clueMap(n, clues);
  const cells = [];
  let sum = 0;
  let max = 0;
  const per = new Int16Array(MAX_V);
  for (const [i, v] of clues) {
    cells.push(i);
    sum += v;
    if (v > max) max = v;
    if (v < MAX_V) per[v]++;
  }
  return { n, n2: n * n, val, cells, sum, max, per };
}

// 就地推到不动点；返回 false 表示当前设定已经自相矛盾。
function propagate(ct, st) {
  const { n2, val, cells, sum, max, per } = ct;
  const { adj, deg, win } = geom(ct.n);
  const lab = new Int32Array(n2);
  const sz = new Int32Array(n2);
  const openFlag = new Uint8Array(n2);
  const stack = new Int32Array(n2);
  const disc = new Int32Array(n2);
  const low = new Int32Array(n2);
  const sub = new Int32Array(n2);
  const pedge = new Int32Array(n2);
  const parent = new Int32Array(n2);
  const parts = new Int32Array(n2);
  const acc = new Int32Array(n2);
  const forced = [];
  let rounds = 0;
  let changed = true;

  while (changed) {
    if (++rounds > n2 + 2) return false;   // 每轮至少落定一格，超账就是死循环
    changed = false;

    let nb = 0;
    let nu = 0;
    let nw = 0;
    for (let i = 0; i < n2; i++) {
      if (st[i] === BLACK) nb++;
      else if (st[i] === WHITE) nw++;
      else nu++;
    }
    // 墨量总账：块大小之和 == 数字之和
    if (nb > sum || nb + nu < sum) return false;
    if (nb === sum && nu) {
      for (let i = 0; i < n2; i++) if (st[i] === EMPTY) st[i] = WHITE;
      nw += nu;
      nu = 0;
      changed = true;
    }

    for (const c of cells) {
      const v = val[c];
      let b = 0;
      let u = 0;
      for (let k = 0; k < deg[c]; k++) {
        const j = adj[c * 4 + k];
        if (st[j] === BLACK) b++;
        else if (st[j] === EMPTY) u++;
      }
      if (b > v || b + u < v) return false;
      if (!u) continue;
      if (b === v) {
        for (let k = 0; k < deg[c]; k++) {
          const j = adj[c * 4 + k];
          if (st[j] === EMPTY) { st[j] = WHITE; nw++; changed = true; }
        }
      } else if (b + u === v) {
        // 只剩这几个空格，那它们必须全落墨才凑得够
        for (let k = 0; k < deg[c]; k++) {
          const j = adj[c * 4 + k];
          if (st[j] === EMPTY) { st[j] = BLACK; nb++; changed = true; }
        }
      }
    }

    // 2×2 不许全白：三格已白就逼第四格落墨
    for (let w = 0; w < win.length; w += 4) {
      let swhite = 0;
      let cand = -1;
      let inked = false;
      for (let k = 0; k < 4; k++) {
        const j = win[w + k];
        if (st[j] === WHITE) swhite++;
        else if (st[j] === BLACK) inked = true;
        else cand = j;
      }
      if (swhite === 4) return false;
      if (!inked && swhite === 3 && cand >= 0) { st[cand] = BLACK; nb++; changed = true; }
    }

    // 墨块：大小不能超过最大数字；两块并一滴墨也要算进尺寸
    lab.fill(-1);
    let nc = 0;
    for (let i = 0; i < n2; i++) {
      if (st[i] !== BLACK || lab[i] >= 0) continue;
      let top = 0;
      stack[top++] = i;
      lab[i] = nc;
      let s = 0;
      while (top) {
        const c = stack[--top];
        s++;
        for (let k = 0; k < deg[c]; k++) {
          const j = adj[c * 4 + k];
          if (st[j] === BLACK && lab[j] < 0) { lab[j] = nc; stack[top++] = j; }
        }
      }
      if (s > max) return false;
      sz[nc] = s;
      nc++;
    }
    openFlag.fill(0);
    for (let i = 0; i < n2; i++) {
      if (st[i] !== EMPTY) continue;
      let c0 = -1;
      let c1 = -1;
      let c2 = -1;
      let tot = 1;
      for (let k = 0; k < deg[i]; k++) {
        const j = adj[i * 4 + k];
        if (st[j] !== BLACK) continue;
        const l = lab[j];
        if (l === c0 || l === c1 || l === c2) continue;
        if (c0 < 0) c0 = l;
        else if (c1 < 0) c1 = l;
        else if (c2 < 0) c2 = l;
        else { c0 = -2; break; }            // 四邻挤不下三个以上不同块：让它落白再说
      }
      if (c0 === -2) {
        tot = max + 1;
      } else {
        if (c0 >= 0) { openFlag[c0] = 1; tot += sz[c0]; }
        if (c1 >= 0) { openFlag[c1] = 1; tot += sz[c1]; }
        if (c2 >= 0) { openFlag[c2] = 1; tot += sz[c2]; }
      }
      if (tot > max) { st[i] = WHITE; nw++; changed = true; }
    }
    const closed = new Int16Array(MAX_V);
    for (let c = 0; c < nc; c++) if (!openFlag[c] && sz[c] < MAX_V) closed[sz[c]]++;
    for (let s = 1; s < MAX_V; s++) if (closed[s] > per[s]) return false;

    // 海必须是一整片：先把非墨格的连通分量数出来，再找关节点
    disc.fill(0);
    pedge.fill(0);
    parts.fill(0);
    acc.fill(0);
    let timer = 0;
    let seaSeen = 0;
    forced.length = 0;
    for (let root = 0; root < n2; root++) {
      if (st[root] === BLACK || disc[root]) continue;
      let top = 0;
      timer++;
      disc[root] = timer;
      low[root] = timer;
      sub[root] = st[root] === WHITE ? 1 : 0;
      parent[root] = -1;
      stack[top++] = root;
      while (top) {
        const u = stack[top - 1];
        let down = false;
        while (pedge[u] < deg[u]) {
          const v = adj[u * 4 + pedge[u]++];
          if (st[v] === BLACK) continue;
          if (!disc[v]) {
            parent[v] = u;
            timer++;
            disc[v] = timer;
            low[v] = timer;
            sub[v] = st[v] === WHITE ? 1 : 0;
            pedge[v] = 0;
            parts[v] = 0;
            acc[v] = 0;
            stack[top++] = v;
            down = true;
            break;
          }
          if (v !== parent[u] && disc[v] < low[u]) low[u] = disc[v];
        }
        if (down) continue;
        top--;
        const p = parent[u];
        if (p >= 0) {
          if (low[u] < low[p]) low[p] = low[u];
          sub[p] += sub[u];
          if (low[u] >= disc[p]) { acc[p] += sub[u]; if (sub[u] > 0) parts[p]++; }
        }
        const rest = nw - acc[u];
        if (st[u] === EMPTY && parts[u] + (rest > 0 ? 1 : 0) >= 2) forced.push(u);
      }
      // 一片只装得下一整条海：两个分量里都有已定的海格就永远接不上了
      if (sub[root] > 0 && ++seaSeen > 1) return false;
    }
    for (const u of forced) {
      if (st[u] === EMPTY) { st[u] = WHITE; changed = true; }
    }
  }
  return true;
}

// 分支格：先挑"数字还缺墨"的候选，其次挑贴着墨的，最后按行序。同一盘每次挑同一格。
function choose(ct, st) {
  const { n2, val, cells } = ct;
  const { adj, deg } = geom(ct.n);
  let best = -1;
  let bestScore = 0;
  for (const c of cells) {
    let b = 0;
    let u = 0;
    for (let k = 0; k < deg[c]; k++) {
      const j = adj[c * 4 + k];
      if (st[j] === BLACK) b++;
      else if (st[j] === EMPTY) u++;
    }
    const need = val[c] - b;
    if (need <= 0 || u <= need) continue;
    const score = 20 - u;
    for (let k = 0; k < deg[c]; k++) {
      const j = adj[c * 4 + k];
      if (st[j] === EMPTY && score > bestScore) { bestScore = score; best = j; }
    }
  }
  if (best >= 0) return best;
  for (let i = 0; i < n2; i++) {
    if (st[i] !== EMPTY) continue;
    let near = 0;
    for (let k = 0; k < deg[i]; k++) {
      const j = adj[i * 4 + k];
      if (st[j] === BLACK) near = 2;
      else if (val[j] && near < 1) near = 1;
    }
    if (near > bestScore) { bestScore = near; best = i; }
  }
  if (best >= 0) return best;
  for (let i = 0; i < n2; i++) if (st[i] === EMPTY) return i;
  return -1;
}

// 数到 cap 就早停。返回 {count, capped, nodes, solution}：solution 是第一条走通的全盘色。
// given 是"已经落定的部分盘面"（hint 用），它只会少数解，不会多数 —— 不传就是整盘重搜。
// 纯逻辑一遍推到底：推得完就是唯一性的证明（传播写下的每一格对任何解都成立），
// 推不完返回 null —— 与数桥/珍珠同一口径，countSolutions 只是给推不完的盘上的保险丝。
export function logicSolve(n, clues) {
  const ct = context(n, clues);
  const st = new Uint8Array(ct.n2);
  for (const [i] of clues) st[i] = WHITE;            // 数字格自身必白，从题面就钉住
  if (!propagate(ct, st)) return null;
  for (let i = 0; i < ct.n2; i++) if (st[i] === EMPTY) return null;
  return rulesOk(ct.n, ct.val, st) ? Array.from(st) : null;
}

export function countSolutions(n, clues, { cap = 2, budget = 20000, given = null } = {}) {
  const ct = context(n, clues);
  const n2 = ct.n2;
  const val = ct.val;
  const st0 = new Uint8Array(n2);
  for (const [i] of clues) st0[i] = WHITE;   // 数字格自身必白，从题面就钉住
  if (given) for (let i = 0; i < n2; i++) if (given[i] !== EMPTY && !val[i]) st0[i] = given[i];
  let nodes = 0;
  let count = 0;
  let capped = false;
  let solution = null;

  const rec = (st) => {
    if (capped || count >= cap) return;
    if (++nodes > budget) { capped = true; return; }
    if (!propagate(ct, st)) return;
    const pick = choose(ct, st);
    if (pick < 0) {
      if (!rulesOk(ct.n, val, st)) return;
      count++;
      if (!solution) solution = Array.from(st);
      return;
    }
    let inked = 0;
    for (let i = 0; i < n2; i++) if (st[i] === BLACK) inked++;
    const order = inked < ct.sum ? [BLACK, WHITE] : [WHITE, BLACK];
    for (const v of order) {
      const next = Uint8Array.from(st);
      next[pick] = v;
      rec(next);
      if (capped || count >= cap) return;
    }
  };

  rec(st0);
  return { count, capped, nodes, solution };
}

// ---- 出题 -----------------------------------------------------------------------
// 墨块先撒开、白格取补集：撒的时候不许贴着别人的块，于是每块尺寸就是当初长出来的那一坨，
// 数字账天然对得上。人闸四道 —— 每个 2×2 都得有墨、海要一整片、块不能大过 4、
// 数字格的四邻墨数得刚好等于块尺寸；最后再交求解器验唯一 —— 造得出解不等于解唯一。
// 档位参数全按实测调：sizes 决定墨的碎密（1 格块越多，题面信息越密、越容易唯一），
// p 管补完 2×2 之后的额外撒点，tags 管一坨墨试几种贴法，budget 管求解器的节点上限。
// 10×10 只用 1 格墨块：混进 2 格块之后唯一命中率掉到几十分之一，耗时压不住。
const mkTier = (key, label, tier, sizes, p, tags, blocks, budget, tries) => ({
  key, label, tier, sizes, p, tags, blocks, budget, tries, max: Math.max(...sizes),
});

const TIERS = [
  mkTier(7, '7×7', '入门', [1, 1, 1, 1, 2], 0.12, 6, [9, 14], 40000, 250),
  mkTier(8, '8×8', '进阶', [1, 1, 1, 1, 2], 0.12, 6, [12, 17], 40000, 250),
  mkTier(10, '10×10', '烧脑', [1], 0.2, 4, [25, 29], 40000, 250),
];

const tierOf = (key) => TIERS.find((t) => t.key === key) || TIERS[1];

// 造题专用的海检：构造阶段未定的格子随时可能当海，所以"除了这滴墨以外全盘连通"才算过关。
// 不能复用 rulesOk 里那套 —— 它只认已定型的 WHITE，此时一个 WHITE 都还没有。
function seaWhole(n, color, skip) {
  const { adj, deg } = geom(n);
  const n2 = n * n;
  let start = -1;
  let sea = 0;
  for (let i = 0; i < n2; i++) {
    if (color[i] === BLACK || i === skip) continue;
    sea++;
    if (start < 0) start = i;
  }
  if (start < 0) return false;                        // 海被挤到一格不剩：这滴墨不能落
  const seen = new Uint8Array(n2);
  const q = [start];
  seen[start] = 1;
  for (let at = 0; at < q.length; at++) {
    const i = q[at];
    for (let k = 0; k < deg[i]; k++) {
      const j = adj[i * 4 + k];
      if (seen[j] || j === skip || color[j] === BLACK) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return q.length === sea;
}

// 撒墨分两步：先把"还没墨的 2×2"一块块补上 —— 这一环直接对准 no-2×2-全白 那道闸，
// 每轮挑可选格最少的那个窗口先补（它最容易补不上，留着就是死题），比随机撒点再筛高一个量级；
// 补完再按 cfg.p 撒几块添纹理。落子时不许贴到别人的块上（owner 分得出敌我），
// 于是块数 == 块尺寸天然成立，数字账也就对得上。
// 每一滴墨落完都重数一遍海：边角孤岛只有在这一步才看得见，事后筛基本筛不掉。
export function paint(n, rng, cfg) {
  const { win } = geom(n);
  const n2 = n * n;
  const winc = win.length / 4;
  const color = new Uint8Array(n2);
  const owner = new Int32Array(n2).fill(-1);
  let id = 0;
  const cellsOf = (w) => {
    const b = w * 4;
    return [win[b], win[b + 1], win[b + 2], win[b + 3]];
  };
  const inked = (w) => cellsOf(w).some((j) => color[j] === BLACK);
  const clean = (i) => {
    if (color[i]) return false;
    for (const k of nbrs(i, n)) if (color[k] === BLACK) return false;
    return seaWhole(n, color, i);
  };
  const grow = (seed, want) => {
    const my = ++id;
    color[seed] = BLACK;
    owner[seed] = my;
    const front = [seed];
    let got = 1;
    while (front.length && got < want) {
      const i = front.splice(rng.int(front.length), 1)[0];
      for (const j of nbrs(i, n)) {
        if (color[j]) continue;
        let clash = false;
        for (const k of nbrs(j, n)) if (color[k] === BLACK && owner[k] !== my) clash = true;
        if (clash || !seaWhole(n, color, j)) continue;
        color[j] = BLACK;
        owner[j] = my;
        front.push(j);
        got++;
        if (got >= want) break;
      }
    }
  };
  const order = [];
  for (let w = 0; w < winc; w++) order.push(w);
  for (let guard = 0; guard < winc * 2 + 4; guard++) {
    let best = null;
    let open = false;
    for (const w of rng.shuffle(order)) {
      if (inked(w)) continue;
      open = true;
      const opts = cellsOf(w).filter(clean);
      if (!opts.length) return null;                  // 这个窗口已经补不上了，整道候选废掉
      if (!best || opts.length < best.length) best = opts;
      if (best.length === 1) break;                   // 已经没有退路的窗口，先处理它
    }
    if (!open) break;
    let pick = best[0];
    let gain = -1;
    for (const c of best) {
      let g = 0;
      for (let w = 0; w < winc; w++) if (!inked(w) && cellsOf(w).includes(c)) g++;
      if (g > gain) { gain = g; pick = c; }
    }
    grow(pick, rng.pick(cfg.sizes));
  }
  const rest = [];
  for (let i = 0; i < n2; i++) rest.push(i);
  for (const seed of rng.shuffle(rest)) {
    if (color[seed] || rng() > cfg.p) continue;
    if (clean(seed)) grow(seed, rng.pick(cfg.sizes));
  }
  return everyTwoByTwoInked(n, color) ? color : null;
}

function nbrs(i, n) {
  const x = i % n;
  const y = (i - x) / n;
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y > 0) out.push(i - n);
  if (y < n - 1) out.push(i + n);
  return out;
}

export function components(n, color) {
  const out = [];
  const seen = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (color[i] !== BLACK || seen[i]) continue;
    const cells = [i];
    seen[i] = 1;
    for (let at = 0; at < cells.length; at++) {
      for (const j of nbrs(cells[at], n)) {
        if (color[j] === BLACK && !seen[j]) { seen[j] = 1; cells.push(j); }
      }
    }
    out.push(cells);
  }
  return out;
}

export function everyTwoByTwoInked(n, color) {
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      if (color[i] !== BLACK && color[i + 1] !== BLACK && color[i + n] !== BLACK && color[i + n + 1] !== BLACK) return false;
    }
  }
  return true;
}

// 一块一数字：尺寸 s 的块只能贴到"四邻恰好 s 滴墨"的白格上，且一格只贴一张。
// 优先在块自己贴着的白格里认领 —— 数字离自己的墨越近，题面给的信息越硬，唯一解才撞得出来。
export function tagBlocks(n, color, comps, rng) {
  const pool = new Map();
  for (let i = 0; i < n * n; i++) {
    if (color[i] === BLACK) continue;
    let b = 0;
    for (const j of nbrs(i, n)) if (color[j] === BLACK) b++;
    if (!b) continue;
    if (!pool.has(b)) pool.set(b, []);
    pool.get(b).push(i);
  }
  const used = new Set();
  const clues = [];
  const free = (c) => c.flatMap((j) => nbrs(j, n)).filter((i) => color[i] !== BLACK && !used.has(i)).length;
  for (const c of comps.slice().sort((a, b) => free(a) - free(b))) {
    const own = new Set(c.flatMap((j) => nbrs(j, n)).filter((i) => color[i] !== BLACK));
    const list = pool.get(c.length) || [];
    const near = rng.shuffle(list.filter((i) => own.has(i) && !used.has(i)));
    const pick = near.length ? near[0] : rng.shuffle(list.filter((i) => !used.has(i)))[0];
    if (pick === undefined) return null;              // 尺寸 s 的格子不够贴：这道题贴不出合法数字
    used.add(pick);
    clues.push([pick, c.length]);
  }
  clues.sort((a, b) => a[0] - b[0]);
  return clues;
}

// 兜底题面：三档各冻一道生成器跑出、求解器数到 count===1 的题（test 里正面复验，防手滑改坏）。
// ink 串按行铺开，'1' 是墨、'0' 是海；宁可端一道偏易的真题，也不许给玩家一张空白盘。
const FALLBACK = {
  7: {
    clues: [[0, 1], [2, 1], [11, 2], [13, 1], [15, 1], [33, 1], [35, 1], [37, 2], [48, 1]],
    ink: '0000000101101000000000101010000000001011010000000',
  },
  8: {
    clues: [[3, 1], [7, 1], [8, 1], [21, 1], [23, 2], [24, 1], [26, 2], [36, 1], [37, 1], [40, 1], [48, 1], [57, 1], [58, 1], [60, 1], [62, 1]],
    ink: '0000000001010101000000000101101100000000010101010010101010000000',
  },
  10: {
    clues: [[0, 1], [2, 1], [3, 1], [5, 1], [7, 1], [9, 1], [12, 1], [22, 1], [32, 1], [42, 1], [52, 1],
      [60, 1], [63, 1], [64, 1], [65, 1], [66, 1], [67, 1], [68, 1], [69, 1], [80, 1], [91, 1], [93, 1], [95, 1], [97, 1], [99, 1]],
    ink: '0100000000000101010101000000000001010101010000000000010101010100000000001010101001010101010000000000',
  },
};

function specOf(n, cfg, clues, color, seed) {
  let ink = 0;
  for (const c of color) if (c === BLACK) ink++;
  return {
    kind: 'nurikabe',
    n,
    clues,
    solution: Array.from(color),
    par: ink,
    sum: clues.reduce((a, c) => a + c[1], 0),
    blocks: clues.length,
    seed: String(seed),
    tier: cfg.tier,
  };
}

// 一块候选题：撒墨 → 尺寸/密度/2×2/海四道闸 → 贴数字 → 求解器验唯一。不合格返回 null。
function candidate(n, cfg, rng, seed) {
  const ink = paint(n, rng, cfg);
  if (!ink) return null;
  const color = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) color[i] = ink[i] === BLACK ? BLACK : WHITE;
  const comps = components(n, color);
  if (comps.length < cfg.blocks[0] || comps.length > cfg.blocks[1]) return null;
  // 每块都得小到能当一个数字来数（四邻只有四格），否则这道题没有合法数字可贴
  for (const c of comps) if (c.length > cfg.max) return null;
  if (!everyTwoByTwoInked(n, color)) return null;
  if (seaConnected(n, color, null) === false) return null;
  for (let t = 0; t < cfg.tags; t++) {
    const clues = tagBlocks(n, color, comps, rng);
    if (!clues) return null;                          // 格子池不够，重贴也一样：直接废这道
    if (!rulesOk(n, clueMap(n, clues), color)) continue;
    const res = countSolutions(n, clues, { cap: 2, budget: cfg.budget });
    if (res.capped) return null;                      // 没数完的题不能端上桌
    if (res.count === 1) return specOf(n, cfg, clues, color, seed);
  }
  return null;
}

// 兜底题面单独导出：test 要正面数一遍它的解数，别让它悄悄退化成一张废盘。
export function fallbackSpec(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const fb = FALLBACK[cfg.key];
  const color = Uint8Array.from(fb.ink, (ch) => (ch === '1' ? BLACK : WHITE));
  return specOf(cfg.key, cfg, fb.clues.map((c) => c.slice()), color, seed);
}

export function generate(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const spec = candidate(n, cfg, rng, seed);
    if (spec) return spec;
  }
  // 生成器永远不许返回 null —— 玩家点开工位却拿到空白盘，比一道偏易的题糟得多。
  return fallbackSpec(seed, sizeKey);
}

// ---- 引擎 -----------------------------------------------------------------------

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function create(spec) {
  const n = spec.n;
  const n2 = n * n;
  const val = clueMap(n, spec.clues);
  const ct = context(n, spec.clues);
  let color = new Uint8Array(n2);          // EMPTY / WHITE / BLACK（数字格恒为 WHITE）
  const fixed = new Uint8Array(n2);
  for (const [i] of spec.clues) fixed[i] = 1;
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let stroke = 0;                          // 0 停, BLACK 落墨, WHITE 打点
  let last = null;
  let doneAt = 0;

  const playable = n2 - spec.clues.length;   // 数字格不给落子，进度只数玩家要定的格
  const settled = () => {
    let c = 0;
    for (let i = 0; i < n2; i++) if (!fixed[i] && color[i] !== EMPTY) c++;
    return c;
  };
  const view = () => {
    const full = Uint8Array.from(color);
    for (let i = 0; i < n2; i++) if (fixed[i]) full[i] = WHITE;
    return full;
  };
  const solved = () => settled() === playable && rulesOk(n, val, view());

  function snapshot() {
    undoStack.push(Uint8Array.from(color));
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
  }

  function setCell(x, y, v) {
    const i = y * n + x;
    if (fixed[i] || color[i] === v) return false;
    // 只有"染成墨色"收账：打点是记号、擦掉是反悔，都不退款也不另收。
    if (v === BLACK) moves++;
    color[i] = v;
    anim.set(i, nowMs());
    return true;
  }

  function afterChange() {
    if (doneAt) return;
    if (solved()) doneAt = nowMs();
  }

  const engine = {
    id: 'nurikabe',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.28, t: 0.28, r: 0.28, b: 0.28 } },
    stats: () => ({ moves, par: spec.par || 0, done: settled(), total: playable }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    cellState: (x, y) => color[y * n + x],
    clueAt: (x, y) => val[y * n + x],
    isGiven: (x, y) => !!fixed[y * n + x],

    // 只报"已经和题面冲突"的格：还没落定的格子一律不算错，所以四条检查都只看已染定的部分。
    badCells() {
      const { adj, deg, win } = geom(n);
      const out = [];
      const known = (i) => (fixed[i] ? WHITE : color[i]);
      const push = (i) => out.push([i % n, (i - (i % n)) / n]);
      for (const [i, v] of spec.clues) {
        let b = 0;
        let u = 0;
        for (let k = 0; k < deg[i]; k++) {
          const c = known(adj[i * 4 + k]);
          if (c === BLACK) b++;
          else if (c === EMPTY) u++;
        }
        if (b > v || b + u < v) push(i);                 // 再多落墨/再多出海也回不到 v
      }
      for (let w = 0; w < win.length; w += 4) {
        let all = true;
        for (let k = 0; k < 4; k++) if (known(win[w + k]) !== WHITE) all = false;
        if (all) for (let k = 0; k < 4; k++) push(win[w + k]);
      }
      const g = view();
      const seen = new Uint8Array(n2);
      const blocks = [];
      for (let i = 0; i < n2; i++) {
        if (g[i] !== BLACK || seen[i]) continue;
        const cells = [i];
        seen[i] = 1;
        let sealed = true;
        for (let at = 0; at < cells.length; at++) {
          for (const j of nbrs(cells[at], n)) {
            if (known(j) === EMPTY) sealed = false;
            if (g[j] === BLACK && !seen[j]) { seen[j] = 1; cells.push(j); }
          }
        }
        blocks.push({ cells, sealed, s: cells.length });
      }
      const closedPer = new Map();
      for (const b of blocks) if (b.sealed) closedPer.set(b.s, (closedPer.get(b.s) || 0) + 1);
      for (const b of blocks) {
        const allowed = spec.clues.filter((c) => c[1] === b.s).length;
        // 大到没有数字能配的块注定活不了（块只会长大）；封死了却没数字、或同类数字已被别的封死块用完，才算错
        if (b.s >= MAX_V || (b.sealed && (allowed === 0 || closedPer.get(b.s) > allowed))) {
          for (const i of b.cells) push(i);
        }
      }
      const sea = [];
      if (!seaConnected(n, g, sea) && sea.length) {
        const inSea = new Uint8Array(n2);
        for (const i of sea) inSea[i] = 1;
        for (let i = 0; i < n2; i++) {
          // 漏在整片海之外的海格，只有四面封死才救不回来
          if (g[i] !== WHITE || inSea[i]) continue;
          if (nbrs(i, n).some((j) => known(j) === EMPTY)) continue;
          push(i);
        }
      }
      const uniq = new Map();
      for (const [x, y] of out) uniq.set(y * n + x, [x, y]);
      return [...uniq.values()];
    },

    down(x, y, btn) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      const i = y * n + x;
      if (fixed[i]) return false;                       // 数字格自身必白，不给落子
      snapshot();
      let next;
      if (btn === 1) next = color[i] === WHITE ? EMPTY : WHITE;
      else next = color[i] === BLACK ? EMPTY : BLACK;
      stroke = btn === 1 ? 0 : next;
      last = { x, y };
      const changed = setCell(x, y, next);
      if (!changed) undoStack.pop();
      else afterChange();
      return changed;
    },

    // 拖动只延续"落墨"这一种意图：擦除和打点是一格一格的收尾动作，不该一路带走。
    move(x, y) {
      if (stroke !== BLACK || doneAt) return false;
      if (x < 0 || y < 0 || x >= n || y >= n) return false;
      if (last && last.x === x && last.y === y) return false;
      const i = y * n + x;
      if (fixed[i] || color[i] === BLACK) { last = { x, y }; return false; }
      snapshot();
      setCell(x, y, BLACK);
      last = { x, y };
      afterChange();
      return true;
    },

    up() {
      const was = stroke !== 0;
      stroke = 0;
      last = null;
      return was;
    },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(Uint8Array.from(color));
      color = Uint8Array.from(undoStack.pop());
      doneAt = 0;
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(Uint8Array.from(color));
      color = Uint8Array.from(redoStack.pop());
      if (solved()) doneAt = nowMs();
      return true;
    },

    hint() {
      if (solved()) return null;
      const base = new Uint8Array(n2);
      for (let i = 0; i < n2; i++) base[i] = fixed[i] ? WHITE : color[i];
      const st = Uint8Array.from(base);
      const forced = [];
      // 传播只写"逻辑上被逼定"的格，所以这类提示落下去不欠任何一次猜
      if (propagate(ct, st)) {
        for (let i = 0; i < n2; i++) if (base[i] === EMPTY && st[i] !== EMPTY) forced.push([i, st[i]]);
      }
      let note;
      if (forced.length) {
        forced.sort((a, b) => a[0] - b[0]);
        note = forced.length > 1
          ? `这一格被题面逼定（同一批还有 ${forced.length - 1} 格）`
          : '这一格被题面逼定，落下去';
      } else {
        // 推不动了：把玩家已落定的格子一并交给求解器，按当前盘面再要找一条真解
        const res = countSolutions(n, spec.clues, { cap: 2, budget: 60000, given: base });
        const sol = res.count >= 1 && res.solution ? res.solution : spec.solution;
        let pick = -1;
        for (let i = 0; i < n2; i++) if (!fixed[i] && color[i] !== sol[i]) { pick = i; break; }
        if (pick < 0) return null;
        note = res.count === 0 ? '盘面和题面打架了：先把这一格扳回唯一解' : '推不动了：这一格出自唯一解，落下去再推';
        forced.push([pick, sol[pick]]);
      }
      const [i, v] = forced[0];
      const x = i % n;
      const y = (i - x) / n;
      snapshot();
      const changed = setCell(x, y, v);
      if (!changed) undoStack.pop();
      else afterChange();
      return { cells: [[x, y]], note };
    },

    draw(ctx, v, t) { render(ctx, v, { color, val, anim, t, reveal: 0, done: () => solved() }); },
    celebrate(ctx, v, t, k) { render(ctx, v, { color, val, anim, t, reveal: k, done: () => true }); },
  };

  return engine;
}

// ---- 渲染 -----------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);
  rules(ctx, v, T.rule, 0);

  const n = cols;
  const g = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = s.val[i] ? WHITE : s.color[i];
  const c0 = (cols - 1) / 2;
  const c1 = (rows - 1) / 2;
  const span = Math.hypot(c0, c1) || 1;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * n + x;
      if (g[i] !== BLACK) continue;
      const t0 = s.anim.get(i);
      const k = !t0 || v.reduce ? 1 : easeOut(clamp((s.t - t0) / INK_MS, 0, 1));
      const wave = s.reveal
        ? 0.3 + 0.7 * easeOut(clamp(s.reveal * 2 - Math.hypot(x - c0, y - c1) / span, 0, 1))
        : 1;
      islandCell(ctx, v, x, y, g, 0.25 + 0.75 * Math.min(k, wave));
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * n + x;
      const cx = v.ox + x * cell + cell / 2;
      const cy = v.oy + y * cell + cell / 2;
      if (s.val[i]) {
        label(ctx, String(s.val[i]), cx, cy, { size: cell * 0.5, color: T.ink, bold: true, mono: true });
      } else if (s.color[i] === WHITE) {
        ctx.save();
        ctx.fillStyle = rgba(T.accent, 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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

  if (v.hover && !s.reveal && !s.done() && !v.reduce) preview(ctx, v, s, v.hover.x, v.hover.y, s.t);
}

// 同一块的墨格互相补边：只在贴着海的那两侧留白，岛才读成一坨而不是棋格。
function islandCell(ctx, v, x, y, g, scale) {
  const cell = v.cell;
  const pad = cell * 0.1;
  const n = v.cols;
  const at = (px, py) => (px < 0 || py < 0 || px >= n || py >= n ? EMPTY : g[py * n + px]);
  const l = at(x - 1, y) === BLACK;
  const r = at(x + 1, y) === BLACK;
  const u = at(x, y - 1) === BLACK;
  const d = at(x, y + 1) === BLACK;
  let x0 = v.ox + x * cell + (l ? 0 : pad);
  let y0 = v.oy + y * cell + (u ? 0 : pad);
  let x1 = v.ox + (x + 1) * cell - (r ? 0 : pad);
  let y1 = v.oy + (y + 1) * cell - (d ? 0 : pad);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = (x1 - x0) * scale;
  const h = (y1 - y0) * scale;
  ctx.save();
  ctx.fillStyle = rgba(T.ink, 0.94);
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, pad * 0.55);
  ctx.fill();
  ctx.restore();
}

// 悬停：空格预告一滴墨，墨格预告擦掉；压在数字上就把它的四邻圈出来（规则就一句话，但要用眼睛数一次）。
function preview(ctx, v, s, x, y, t) {
  const n = v.cols;
  if (x < 0 || y < 0 || x >= n || y >= n) return;
  const i = y * n + x;
  ctx.save();
  if (s.val[i]) {
    ctx.strokeStyle = rgba(T.accent, 0.22 + 0.14 * pulse(t));
    ctx.lineWidth = Math.max(1, v.cell * 0.05);
    for (const j of nbrs(i, n)) {
      const px = j % n;
      const py = (j - px) / n;
      roundRect(ctx, v.ox + px * v.cell + 2, v.oy + py * v.cell + 2, v.cell - 4, v.cell - 4, v.cell * 0.16);
      ctx.stroke();
    }
  } else if (s.color[i] === BLACK) {
    ctx.strokeStyle = rgba(T.inkFaint, 0.6);
    ctx.lineWidth = Math.max(1, v.cell * 0.05);
    ctx.beginPath();
    ctx.arc(v.ox + x * v.cell + v.cell / 2, v.oy + y * v.cell + v.cell / 2, v.cell * 0.24, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = rgba(T.ink, 0.14 + 0.08 * pulse(t));
    roundRect(ctx, v.ox + x * v.cell + v.cell * 0.12, v.oy + y * v.cell + v.cell * 0.12, v.cell * 0.76, v.cell * 0.76, v.cell * 0.16);
    ctx.fill();
  }
  ctx.restore();
}

export default {
  id: 'nurikabe',
  title: '数墙',
  latin: 'NURIKABE',
  tagline: '数字数四邻的墨，墨块的大小正好等于某个数字',
  unit: '格',
  rules: [
    '每一格要么落墨、要么成海；带数字的格子自身是海。',
    '数字说的是它上下左右四格里有几滴墨 —— 恰好那么多，不多也不少。',
    '连成一片的墨是一块岛，每块岛的大小恰好对应盘上一个不重复的数字；剩下的海整体连通，任意 2×2 不许全是海。',
  ],
  sizes: TIERS.map(({ key, label: l, tier }) => ({ key, label: l, tier })),
  generate,
  create,
};
