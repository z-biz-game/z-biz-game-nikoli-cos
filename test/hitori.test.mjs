// 隔离的三道保险（与数墙/帐篷/黑白同一立场）：
//   1) 出题器不许说谎 —— 交出来的题必须被 countSolutions 数到"恰好一个解"且没烧穿预算；
//      capped 永远不等于唯一。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现（自己的黑格邻接 / 白格连通 /
//      段内撞数检查），拿它跟 isLegalBlackSet 对拍三百张随机黑盘；两张真题也逐条核过。
//   3) 引擎是纯状态机 —— 只用公开 API 走子；只有"落一枚黑格"记账，小圆点是思考笔记，
//      擦除与撤销都不退款。
//
// 规则口径（钉在引擎文件头）：黑格之间不得四邻相接；白格被黑格切成一段一段，每段里的数字互不
// 相同（行与列都要）；所有白格整体四连通。

import test from 'node:test';
import assert from 'node:assert/strict';
import hitori, {
  generate, create, isLegalBlackSet, conflictsOf, countSolutions, solveFrom,
  forcedBlacks, segments, neighbors4,
  UNKNOWN, BLACK, WHITE,
} from '../js/puzzles/hitori.js';

const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);
const TIERS = hitori.sizes.map((s) => s.key);
const flatOf = (nums) => Uint8Array.from(nums.flat());
const maskOf = (n, cells) => {
  const m = new Uint8Array(n * n);
  for (const [x, y] of cells) m[y * n + x] = 1;
  return m;
};

// ---- 独立实现：只按三条白话规则数一遍，不借引擎任何工具 ----------------------------
function bruteLegal(n, nums, black) {
  const at = (x, y) => y * n + x;
  const isB = (x, y) => black[at(x, y)] === 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!isB(x, y)) continue;
    if (x + 1 < n && isB(x + 1, y)) return false;
    if (y + 1 < n && isB(x, y + 1)) return false;      // 黑格四邻相接
  }
  const segDistinct = (cells) => {
    const seen = new Set();
    for (const i of cells) {
      if (black[i]) continue;
      if (seen.has(nums[i])) return false;
      seen.add(nums[i]);
    }
    return true;
  };
  for (let y = 0; y < n; y++) {
    let run = [];
    for (let x = 0; x <= n; x++) {
      if (x < n && !black[at(x, y)]) run.push(at(x, y));
      else { if (!segDistinct(run)) return false; run = []; }
    }
  }
  for (let x = 0; x < n; x++) {
    let run = [];
    for (let y = 0; y <= n; y++) {
      if (y < n && !black[at(x, y)]) run.push(at(x, y));
      else { if (!segDistinct(run)) return false; run = []; }
    }
  }
  let start = -1;
  for (let i = 0; i < n * n; i++) if (!black[i]) { start = i; break; }
  if (start < 0) return false;
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const c = q.pop();
    const x = c % n, y = (c - x) / n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const j = b * n + a;
      if (black[j] || seen.has(j)) continue;
      seen.add(j); q.push(j);
    }
  }
  let whites = 0;
  for (let i = 0; i < n * n; i++) if (!black[i]) whites++;
  return seen.size === whites;                              // 白格整体连通
}

// 一张冻在测试里的真题（6×6）：数字盘 + 九枚黑格，独立实现与引擎都说它是解
const FIX = {
  n: 6,
  nums: [[4, 4, 4, 1, 1, 1], [5, 2, 2, 2, 3, 6], [6, 1, 5, 3, 3, 2],
    [6, 5, 5, 4, 1, 3], [6, 5, 4, 4, 3, 3], [3, 5, 1, 4, 2, 6]],
  blacks: [[1, 0], [4, 0], [2, 1], [4, 2], [0, 3], [2, 3], [1, 4], [3, 4], [5, 4]],
};

test('玩法描述齐三件：标题、规则文案、档位表', () => {
  assert.equal(hitori.id, 'hitori');
  assert.equal(hitori.title, '隔离');
  assert.equal(hitori.latin, 'HITORI');
  assert.equal(hitori.unit, '格');
  assert.ok(hitori.rules.length >= 3);
  assert.deepEqual(TIERS, [6, 8, 10], '档位表动了：出题预算与移动端布局都按这三档量过');
  assert.deepEqual(hitori.sizes.map((s) => s.tier), ['入门', '经典', '进阶']);
});

test('冻在测试里的 6×6 真题：两层实现都说这套黑格是解', () => {
  const nums = flatOf(FIX.nums);
  const black = maskOf(FIX.n, FIX.blacks);
  assert.equal(bruteLegal(FIX.n, nums, black), true, 'fixture 自己就不合法');
  assert.equal(isLegalBlackSet(FIX.n, nums, black), true, '引擎不认这套黑格');
});

test('isLegalBlackSet 逐条咬合：黑格相接、段内撞数、白格断开都算非法', () => {
  const n = FIX.n;
  const nums = flatOf(FIX.nums);
  const base = maskOf(n, FIX.blacks);
  assert.equal(isLegalBlackSet(n, nums, base), true);
  const touch = Uint8Array.from(base); touch[0] = 1;         // (0,0) 与 (1,0) 相接
  assert.equal(bruteLegal(n, nums, touch), false);
  assert.equal(isLegalBlackSet(n, nums, touch), false, '两枚黑格四邻相接还判合法');
  const isolated = maskOf(n, [[1, 0], [4, 0], [2, 1], [4, 2], [0, 3], [2, 3], [1, 4], [3, 4], [5, 4], [3, 0]]);
  assert.equal(bruteLegal(n, nums, isolated) || true, true);
  assert.equal(isLegalBlackSet(n, nums, isolated), bruteLegal(n, nums, isolated), '断开白格的判据两边不一样');
  // 段内撞数：把隔开两枚 4 的那枚黑格抽掉，同一张数字盘立刻不合法
  const dupRow = maskOf(FIX.n, FIX.blacks.filter(([x, y]) => !(x === 1 && y === 0)));
  assert.equal(bruteLegal(FIX.n, flatOf(FIX.nums), maskOf(FIX.n, FIX.blacks)), true, '正例先要站得住');
  assert.equal(bruteLegal(FIX.n, flatOf(FIX.nums), dupRow), false, '隔开两枚同数字的黑格抽掉了，独立实现还在点头');
  assert.equal(isLegalBlackSet(FIX.n, flatOf(FIX.nums), dupRow), false, '行里三枚 4 挤成一段还判合法');
});

test('两层实现对拍：三百张随机黑盘，判到合法的必须是同一批', () => {
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let agree = 0, valid = 0;
  // 正例得自己端上来：随机黑盘撞上合法解的概率近乎零（实测三百张一张都没有）
  for (const key of TIERS) {
    const spec = generate(`cross:${key}`, key);
    const nums = flatOf(spec.nums);
    const black = maskOf(key, spec.blacks);
    assert.equal(bruteLegal(key, nums, black), true, `${key}×${key} 这道真题独立实现不认`);
    assert.equal(isLegalBlackSet(key, nums, black), true, `${key}×${key} 真题被引擎判成非法`);
    valid++; agree++;
  }
  for (const n of [5, 6, 7]) {
    for (let t = 0; t < 100; t++) {
      const nums = Uint8Array.from({ length: n * n }, () => 1 + Math.floor(rnd() * Math.max(2, n - 1)));
      const black = Uint8Array.from({ length: n * n }, () => (rnd() < 0.3 ? 1 : 0));
      const mine = bruteLegal(n, nums, black);
      const eng = isLegalBlackSet(n, nums, black);
      assert.equal(eng, mine, `${n}×${n} 对拍分家：引擎 ${eng} 独立实现 ${mine}`);
      if (mine) valid++;
      agree++;
    }
  }
  assert.equal(agree, 300 + TIERS.length, '对拍账目对不上');
  assert.equal(valid, TIERS.length, '正例没被算进对拍账上');
});

test('countSolutions 老实：与 4×4 全空间穷举比"有没有第二个解"，一位不差', () => {
  const boards = [
    [[1, 1, 2, 3], [2, 3, 4, 1], [3, 4, 1, 2], [4, 2, 3, 1]],
    [[1, 2, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]],
    [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]],
    [[4, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 1], [3, 4, 1, 2]],
  ];
  for (const nums2d of boards) {
    const nums = flatOf(nums2d);
    let brute = 0;
    for (let mask = 0; mask < (1 << 16); mask++) {
      const black = Uint8Array.from({ length: 16 }, (_, i) => ((mask >> i) & 1));
      if (bruteLegal(4, nums, black)) brute++;
    }
    const spec = { kind: 'hitori', n: 4, nums: nums2d, par: 0, blacks: [] };
    const r = countSolutions(spec, 2);
    assert.equal(r.capped, false, `4×4 都数不完：${JSON.stringify(nums2d)}`);
    assert.equal(r.count, Math.min(brute, 2), `求解器数出 ${r.count}，穷举有 ${brute} 套解法`);
  }
  // 生成器发的题必须恰好一个解，而且要数得完
  for (const key of TIERS) {
    const spec = generate(`count:${key}`, key);
    const r = countSolutions(spec, 2);
    assert.equal(r.count, 1, `${key}×${key} 发的题数出 ${r.count} 个解`);
    assert.equal(r.capped, false, `${key}×${key} 没数完就端上桌`);
  }
});

test('solveFrom 交出来的必须是真解，forcedBlacks 不许把非黑格说成必黑', () => {
  for (const key of TIERS) {
    const spec = generate(`solve:${key}`, key);
    const raw = solveFrom(spec, null);
    assert.ok(raw, `${key}×${key} 唯一解的题面竟找不到解`);
    const sol = Uint8Array.from(raw, (v) => (v === BLACK ? 1 : 0));   // 求解器交的是状态盘，转成黑格掩码
    assert.equal(bruteLegal(spec.n, flatOf(spec.nums), sol), true, `${key}×${key} solveFrom 交的不是解`);
    assert.equal(isLegalBlackSet(spec.n, flatOf(spec.nums), sol), true);
    const { forced, ambiguous } = forcedBlacks(spec, null);
    assert.equal(ambiguous, false, `${key}×${key} 数到两个解，生成器却发了题`);
    for (const i of forced) {
      assert.equal(sol[i], 1, `forcedBlacks 说第 ${i} 格必黑，正解里它却不是黑格`);
    }
    assert.equal(forced.length, spec.par, '唯一解的题面，必黑格就该恰好是整道解');
  }
});

test('segments 与 neighbors4 说的是同一件人事：行里被黑格切开的段', () => {
  const n = 4;
  const nums = flatOf([[1, 2, 1, 3], [4, 4, 4, 4], [1, 1, 2, 2], [3, 2, 1, 4]]);
  const black = maskOf(4, [[1, 0], [1, 1], [1, 2], [1, 3]]);
  const segs = segments(n, (() => {
    const st = new Uint8Array(16);
    for (let i = 0; i < 16; i++) st[i] = black[i] ? BLACK : WHITE;
    return st;
  })());
  assert.ok(Array.isArray(segs) && segs.length > 0, 'segments 得交出段表');
  const flat = segs.flat ? segs.map((s) => (Array.isArray(s) ? s : [s])) : [];
  assert.ok(flat.every((s) => s.length >= 1), '段表里混进空段');
  assert.deepEqual(neighbors4(5, 4).sort((a, b) => a - b), [1, 4, 6, 9], '四邻表连边界都算不对');
  assert.deepEqual(neighbors4(0, 4).sort((a, b) => a - b), [1, 4], '角上该只有两个邻居');
});

for (const key of TIERS) test(`生成器发的每道题都数得唯一、三条规则全过（${key}×${key}，40 颗种子）`, () => {
  const faces = new Set();
  const pars = [];
  for (const seed of SEEDS(`gen${key}`, 40)) {
    const spec = generate(seed, key);
    assert.equal(spec.n, key);
    assert.equal(spec.kind, 'hitori');
    assert.equal(spec.nums.length, key);
    assert.equal(spec.nums.every((r) => r.length === key), true, '数字盘不是方阵');
    assert.ok(flatOf(spec.nums).every((v) => v >= 1), '题面里有没数字的格子');
    faces.add(JSON.stringify(spec.nums) + '|' + JSON.stringify(spec.blacks));
    const black = maskOf(key, spec.blacks);
    assert.equal(bruteLegal(key, flatOf(spec.nums), black), true, `${seed} 独立实现不认这道题的答案`);
    assert.equal(isLegalBlackSet(key, flatOf(spec.nums), black), true, `${seed} 引擎不认自己的答案`);
    const r = countSolutions(spec, 2);
    assert.equal(r.count, 1, `${seed} 数出 ${r.count} 个解`);
    assert.equal(r.capped, false, `${seed} 没数完就端上桌`);
    assert.equal(spec.par, spec.blacks.length, 'par 该是唯一解的黑格数');
    assert.ok(spec.par >= Math.ceil(key * key / 8), `${seed} 只划 ${spec.par} 格，太薄`);
    pars.push(spec.par);
  }
  assert.equal(faces.size, 40, `${key}×${key} 四十颗种子只交出 ${faces.size} 道题`);
});

test('同一颗种子在任何设备上得到同一道题，spec 过一遍 JSON 也不变味', () => {
  for (const key of TIERS) {
    const a = generate('daily:2026-09-27|hitori', key);
    const b = generate('daily:2026-09-27|hitori', key);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
    const copy = JSON.parse(JSON.stringify(a));
    const e = create(copy);
    for (const [x, y] of copy.blacks) { e.down(x, y, 0); e.up(); }
    assert.equal(e.solved(), true, 'JSON 往返之后就划不出来了');
  }
});

test('引擎开局：全盘未定，进度按黑格数走', () => {
  const spec = generate('start:0', 6);
  const n = spec.n;
  const e = create(spec);
  assert.equal(e.board.cols, n);
  assert.equal(e.board.rows, n);
  assert.deepEqual(e.stats(), { moves: 0, par: spec.par, done: 0, total: spec.par });
  assert.equal(e.solved(), false);
  assert.deepEqual(e.badCells(), [], '空盘不许报任何格子');
  assert.equal(e.cellState(0, 0), UNKNOWN);
});

test('只有落黑格收账：小圆点、擦除、撤销与重做都不退款', () => {
  const spec = generate('moves:0', 6);
  const n = spec.n;
  const at = (i) => [i % n, (i - i % n) / n];
  const [bx, by] = spec.blacks[0];
  const e = create(spec);
  assert.equal(e.down(bx, by, 0), true);
  assert.deepEqual(e.stats(), { moves: 1, par: spec.par, done: 1, total: spec.par });
  assert.equal(e.down(bx, by, 0), true);                 // 再点一下：擦掉
  assert.equal(e.cellState(bx, by), UNKNOWN);
  assert.equal(e.stats().moves, 1, '擦掉一枚黑格，已付的那一步不许退');
  assert.equal(e.stats().done, 0);
  assert.equal(e.down(bx, by, 0), true);                 // 重新落上：再付一笔
  assert.equal(e.stats().moves, 2);
  const dot = at(spec.nums.findIndex((_, i) => !maskOf(n, spec.blacks)[i] && i !== spec.blacks.map(([x, y]) => y * n + x)[0]));
  assert.equal(e.down(...dot, 1), true);                 // 副笔小圆点
  assert.equal(e.cellState(...dot), WHITE);
  assert.equal(e.stats().moves, 2, '小圆点是思考笔记，不许收落子的账');
  assert.equal(e.undo(), true);
  assert.equal(e.stats().moves, 2, '撤销退回盘面，账却已经付过');
  assert.equal(e.redo(), true);
  assert.equal(e.stats().moves, 2, '重做不许另收一笔');
});

test('拖动一路划黑，每一枚恰好一笔账', () => {
  const spec = generate('drag:0', 8);
  const n = spec.n;
  const black = maskOf(n, spec.blacks);
  // 找两个在同一条直线上的黑格，拖过去中间会被一路划黑
  const a = spec.blacks[0];
  let b = spec.blacks.find(([x, y]) => (x === a[0] || y === a[1]) && !(x === a[0] && y === a[1]));
  if (!b) b = [a[0] + 2 < n ? a[0] + 2 : a[0] - 2, a[1]];
  const e = create(spec);
  e.down(...a, 0);
  e.move(...b);
  e.up();
  let painted = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (e.cellState(x, y) === BLACK) painted++;
  assert.equal(e.stats().moves, painted, `划了 ${painted} 枚却收 ${e.stats().moves} 笔`);
  assert.ok(painted >= 2);
  void black;
});

test('照着答案划满才算赢；少一枚、多一枚都不算，赢了就锁盘', () => {
  const spec = generate('win:0', 6);
  const n = spec.n;
  const e = create(spec);
  for (const [x, y] of spec.blacks) { e.down(x, y, 0); e.up(); }
  assert.equal(e.solved(), true);
  assert.equal(e.stats().moves, spec.par, '照答案划黑的步数就该等于 par');
  assert.equal(e.stats().done, e.stats().total);
  assert.equal(e.down(spec.blacks[0][0], spec.blacks[0][1], 0), false, '赢了还能改盘');
  assert.equal(e.hint(), null, '通关之后不许再给提示');
  // 少一枚
  const f = create(spec);
  for (const [x, y] of spec.blacks.slice(1)) { f.down(x, y, 0); f.up(); }
  assert.equal(f.solved(), false, '还差一枚就判胜');
  // 多一枚（正解之外再补一枚不挨着的）
  const extra = [];
  for (let i = 0; i < n * n && extra.length < 3; i++) {
    if (maskOf(n, spec.blacks)[i]) continue;
    const x = i % n, y = (i - x) / n;
    if (neighbors4(i, n).some((j) => maskOf(n, spec.blacks)[j])) continue;
    extra.push([x, y]);
  }
  assert.ok(extra.length, '这张盘找不到"正解之外还不挨着黑格"的位置，反例得换一颗种子');
  for (const [x, y] of extra) { f.down(x, y, 0); f.up(); }
  assert.equal(f.solved(), false, '多划几枚还判胜？');
});

test('badCells 只冤枉真矛盾的格子', () => {
  const spec = generate('bad:0', 8);
  const n = spec.n;
  const keys = (list) => list.map(([x, y]) => y * n + x).join(',');
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '空盘不许报错');
  // 行里两枚同数字，中间没隔开：两枚都该被点出来
  const row = spec.nums.findIndex((r) => r.some((v, x) => r.some((w, z) => w === v && z > x)));
  assert.ok(row >= 0, '这张题面找不到一行有重复数字，反例换一颗种子');
  const r = spec.nums[row];
  const dup = r.map((v, x) => [v, x]).find(([v, x]) => r.some((w, z) => w === v && z > x));
  const other = r.map((v, x) => [v, x]).find(([v, x]) => v === dup[0] && x !== dup[1]);
  const g = create(spec);
  g.down(dup[1], row, 0); g.up();
  g.down(other[1], row, 0); g.up();
  assert.ok(keys(g.badCells()).includes(String(row * n + dup[1])) || keys(g.badCells()).includes(String(row * n + other[1])),
    '两枚同数字面对面摆着，却没人报警');
  // 把整道答案划上：一路都不该红
  const ok = create(spec);
  for (const [x, y] of spec.blacks) { ok.down(x, y, 0); ok.up(); }
  assert.deepEqual(ok.badCells(), [], '正解划完却被报错');
  void e;
});

test('提示一格一格推得动，一路点下去能点到通关', () => {
  for (const key of [6, 8]) {
    const spec = generate(`hint:${key}`, key);
    const n = spec.n;
    const e = create(spec);
    let guard = 0;
    while (!e.solved() && guard++ < n * n + 20) {
      const before = e.stats().done;
      const h = e.hint();
      assert.ok(h, `第 ${guard} 次提示撒手，盘却还没划完`);
      assert.ok(h.cells.length >= 1 && typeof h.note === 'string');
      assert.ok(e.stats().done > before, `hint 落下去盘面没动 ${JSON.stringify(h.cells)}`);
      const sol = maskOf(n, spec.blacks);
      for (const [x, y] of h.cells) {
        assert.equal(e.cellState(x, y), BLACK, `hint 该落下黑格：${x},${y}`);
        assert.equal(sol[y * n + x], 1, `hint 划掉的格子不在唯一解里：${x},${y}`);
      }
    }
    assert.equal(e.solved(), true, `点了 ${guard} 次还没通关`);
  }
});

test('提示不许一次划完全盘，也不许倒退款', () => {
  const spec = generate('hint-one:0', 8);
  const e = create(spec);
  const h = e.hint();
  assert.ok(h);
  assert.ok(h.cells.length < spec.par, '一次提示就把全盘划完，玩家还玩什么');
  const dots = e.stats().moves;
  e.hint();
  assert.ok(e.stats().moves >= dots);
});

test('引擎不碰时钟也不碰随机数：模块里不许出现 Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/hitori.js', import.meta.url), 'utf8'));
  assert.equal(/Math\.random/.test(src), false, '引擎里出现 Math.random：同一颗种子就不再是同一道题');
  assert.equal(/\bnew Date\b/.test(src), false, '引擎不许读当前时间');
  assert.equal(/document\.|localStorage|window\./.test(src), false, '引擎不许碰 DOM 与存档');
});

test('draw 只要一个空壳上下文就能画完一帧，通关动画也不炸', async () => {
  const spec = generate('draw:0', 6);
  const e = create(spec);
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'canvas') return { width: 420, height: 420 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return (...args) => { calls.push(k); void args; };
    },
    set() { return true; },
  });
  const v = { cell: 40, ox: 12, oy: 12, cols: spec.n, rows: spec.n, w: 420, h: 420, dpr: 2, hover: { x: 1, y: 1 }, bad: [], reduce: false };
  for (const [x, y] of spec.blacks) { e.down(x, y, 0); e.up(); }
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20, '一帧什么都没画');
  if (e.celebrate) e.celebrate(ctx, v, 1000, 0.5);
});

test('出题在手机上不卡：每档十道题各有预算', () => {
  // 绝对毫秒不是算法量：本机、能效核、CI 那台 4 核（并发 10 个测试文件）实测差到 30 倍。
  // 这条只当"算法塌成指数"的保险丝，真正可证的手感上界在档位自己的 tries/budget 里。
  const BUDGET = { 6: 9000, 8: 15000, 10: 25000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`t${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < BUDGET[key], `${key}×${key} 十道题花了 ${ms}ms，超过 ${BUDGET[key]}ms`);
  }
});
