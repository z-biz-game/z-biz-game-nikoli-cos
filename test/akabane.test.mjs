// 黑白的三道保险（与数墙/帐篷同一立场）：
//   1) 出题器不许说谎 —— 交出来的题必须被 countSolutions 数到"恰好一种涂法"且没烧穿预算；
//      capped 永远不等于唯一。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现（自己的"看见"数法 + 2×2 检查），
//      拿它跟 verifyColoring 对拍；4×4 还拿全 65536 张涂色盘穷举核过求解器数出的解数。
//   3) 引擎是纯状态机 —— 只用公开 API 走子；空格第一次定色算一步，改色、擦除、打叉都不收账，
//      撤销与重做也不退款。
//
// 题面口径（钉在引擎文件头）：clues 是带符号的定长数组，正数 = 黑格上的数字，负数 = 白格上的
// 数字，0 = 这格没数（颜色由玩家定）；数字说的是它沿四方向"走到第一个异色格为止"看见的同类格数，
// 自己不算。任何 2×2 不许四格同色 —— 这条是地基，不是可选项。

import test from 'node:test';
import assert from 'node:assert/strict';
import akabane, {
  generate, create, verifyColoring, visibleCount, hasMonoSquare, countSolutions,
  clueColor, clueValue, BLACK, WHITE, EMPTY,
} from '../js/puzzles/akabane.js';

const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);
const TIERS = akabane.sizes.map((s) => s.key);
const idx = (n, x, y) => y * n + x;

// ---- 独立实现（不 import 引擎的任何工具） ------------------------------------------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function myVisible(n, grid, x, y) {
  const own = grid[y * n + x];
  let seen = 0;
  for (const [dx, dy] of DIRS) {
    let cx = x + dx, cy = y + dy;
    while (cx >= 0 && cy >= 0 && cx < n && cy < n && grid[cy * n + cx] === own) {
      seen++; cx += dx; cy += dy;
    }
  }
  return seen;
}

function myMono(n, grid) {
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const a = grid[idx(n, x, y)];
    if (a === grid[idx(n, x + 1, y)] && a === grid[idx(n, x, y + 1)] && a === grid[idx(n, x + 1, y + 1)]) return true;
  }
  return false;
}

function bruteOk(n, clues, grid) {
  if (myMono(n, grid)) return false;
  for (let i = 0; i < n * n; i++) {
    if (!clues[i]) continue;
    const wantColor = clues[i] > 0 ? BLACK : WHITE;
    if (grid[i] !== wantColor) return false;
    if (myVisible(n, grid, i % n, (i - i % n) / n) !== Math.abs(clues[i])) return false;
  }
  return true;
}

// 一张最小的手摆真题（4×4）：黑白相间的方格，白格上的数字全由上面那套独立数法算出来
const HAND = {
  n: 4,
  grid: ['#o#o', 'oooo', '#o#o', 'oooo'].join('').split('').map((c) => (c === '#' ? BLACK : WHITE)),
  clues: [0, -3, 0, -3, -3, -6, -3, -6, 0, -3, 0, -3, -3, -6, -3, -6],
};
const handGrid = () => Int8Array.from(HAND.grid);

test('玩法描述齐三件：标题、规则文案、档位表', () => {
  assert.equal(akabane.id, 'akabane');
  assert.equal(akabane.title, '黑白');
  assert.equal(akabane.latin, 'AKBANE');
  assert.equal(akabane.unit, '格');
  assert.ok(akabane.rules.length >= 3);
  assert.deepEqual(TIERS, [6, 8, 10], '档位表动了：出题预算与移动端布局都按这三档量过');
  assert.deepEqual(akabane.sizes.map((s) => s.tier), ['入门', '进阶', '烧脑']);
});

test('题面读法：符号说颜色，绝对值说看见几格', () => {
  assert.equal(clueColor(-6), WHITE);
  assert.equal(clueColor(3), BLACK);
  assert.equal(clueColor(0), EMPTY);
  assert.equal(clueValue(-6), 6);
  assert.equal(clueValue(0), 0);
});

test('手摆的 4×4 真题在两层实现里都算合法', () => {
  assert.equal(bruteOk(HAND.n, HAND.clues, handGrid()), true, 'fixture 自己就不合法');
  assert.equal(verifyColoring(HAND.n, HAND.clues, handGrid()), true, '引擎不认这张真题');
  assert.equal(hasMonoSquare(HAND.n, handGrid()), false);
});

test('visibleCount 与独立数法一格不差，2×2 判定也不许两样', () => {
  for (let i = 0; i < 16; i++) {
    const x = i % 4, y = (i - x) / 4;
    assert.equal(visibleCount(4, handGrid(), x, y), myVisible(4, handGrid(), x, y), `第 ${i} 格数得不一样`);
  }
  const mono = Int8Array.from({ length: 16 }, () => WHITE);
  for (const i of [idx(4, 0, 0), idx(4, 1, 0), idx(4, 0, 1), idx(4, 1, 1)]) mono[i] = BLACK;
  assert.equal(hasMonoSquare(4, mono), true, '凑出一个全黑 2×2 却没看出来');
  assert.equal(hasMonoSquare(4, handGrid()), false, '没有同色 2×2 却报了');
});

test('verifyColoring 逐条咬合：数超、数不足、数字格染色错、2×2 同色都算非法', () => {
  const g = handGrid();
  assert.equal(verifyColoring(4, HAND.clues, g), true);
  const over = Int8Array.from(g); over[idx(4, 0, 1)] = BLACK;      // 白格涂黑：数字格的颜色立刻对不上
  assert.equal(bruteOk(4, HAND.clues, over), false);
  assert.equal(verifyColoring(4, HAND.clues, over), false, '把白格涂成黑还判合法');
  const flip = HAND.clues.map((c) => (c > 0 ? -c : c < 0 ? c : 0));
  assert.equal(verifyColoring(4, HAND.clues, g), true);
  assert.equal(verifyColoring(4, [1, ...flip.slice(1)], g), false, '给白格标个正数还判合法');
  const shortOne = HAND.clues.slice(); shortOne[idx(4, 1, 1)] = -5;
  assert.equal(bruteOk(4, shortOne, g), false);
  assert.equal(verifyColoring(4, shortOne, g), false, '数字比实际看见的少一格还判合法');
  const longOne = HAND.clues.slice(); longOne[idx(4, 1, 1)] = -7;
  assert.equal(verifyColoring(4, longOne, g), false, '数字比实际看见的多一格还判合法');
  const block = Int8Array.from(g); block[idx(4, 1, 1)] = BLACK; block[idx(4, 2, 1)] = BLACK;
  assert.equal(verifyColoring(4, HAND.clues, block), false, '2×2 同色是地基，塌了必须说不合法');
});

test('两层实现对拍：三百张随机涂色盘，判到合法的必须是同一批', () => {
  let seed = 99991;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let agree = 0, valid = 0;
  for (const n of [4, 5, 6]) {
    for (let t = 0; t < 100; t++) {
      const grid = Int8Array.from({ length: n * n }, () => (rnd() < 0.5 ? BLACK : WHITE));
      const clues = new Array(n * n).fill(0);
      for (let i = 0; i < n * n; i++) {
        if (rnd() < 0.55) {
          const k = myVisible(n, grid, i % n, (i - i % n) / n);
          if (k) clues[i] = grid[i] === BLACK ? k : -k;
        }
      }
      // 偶尔把某个数字改错一格，制造"看着像合法"的陷阱
      if (rnd() < 0.4) { const j = Math.floor(rnd() * n * n); if (clues[j]) clues[j] += rnd() < 0.5 ? 1 : -1; }
      const mine = bruteOk(n, clues, grid);
      const eng = verifyColoring(n, clues, grid);
      assert.equal(eng, mine, `${n}×${n} 对拍分家：引擎 ${eng} 独立实现 ${mine}`);
      if (mine) valid++;
      agree++;
    }
  }
  assert.equal(agree, 300);
  assert.ok(valid >= 5, `三百张盘里一张合法都没撞上（${valid}），随机数怕是坏的`);
});

test('countSolutions 与 4×4 全空间穷举一位不差：数得完，也敢承认数不完', () => {
  const cases = [HAND.clues, HAND.clues.map((c) => (c === -6 ? 0 : c)), HAND.clues.map((c) => (c === 0 ? c : -c)), [0, 0, 0, 0, 0, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  for (const clues of cases) {
    let brute = 0;
    for (let mask = 0; mask < (1 << 16); mask++) {
      const grid = Int8Array.from({ length: 16 }, (_, i) => ((mask >> i) & 1 ? BLACK : WHITE));
      if (bruteOk(4, clues, grid)) brute++;
    }
    // 默认数到第二种就早停（生成器要的就是这个），比对全量得把 limit 抬到穷举之上
    const r = countSolutions({ n: 4, clues }, 400000, { limit: 400 });
    assert.equal(r.capped, false, `4×4 都数不完：${JSON.stringify(clues)}`);
    assert.equal(r.count, brute, `求解器数出 ${r.count}，穷举数出 ${brute}（题面 ${JSON.stringify(clues)}）`);
  }
  // 拿一张真要多方分支的盘验 capped：预算只给一个节点，必须老实说没数完
  const big = generate('cap:1', 10);
  const starved = countSolutions(big, 1);
  assert.equal(starved.capped, true, '只给一个节点，10×10 竟敢说数完了');
  assert.notEqual(starved.count, 1, '没数完却敢报"唯一解"');
  // 数到第二种就早停：这是生成器默认要的行为
  const early = countSolutions({ n: 4, clues: [0, 0, 0, 0, 0, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, 400000);
  assert.equal(early.count, 2, '多解的盘没在第二种停下');
});

for (const key of TIERS) test(`生成器发的每道题都数得唯一、自洽（${key}×${key}，40 颗种子）`, () => {
  const faces = new Set();
  const pars = [];
  let ms = 0, worst = 0;
  for (const seed of SEEDS(`gen${key}`, 40)) {
    const t0 = performance.now();
    const spec = generate(seed, key);
    const dt = performance.now() - t0; ms += dt; worst = Math.max(worst, dt);
    assert.equal(spec.n, key);
    assert.equal(spec.kind, 'akabane');
    assert.equal(spec.clues.length, key * key);
    faces.add(spec.clues.join(',') + '|' + spec.solution.join(''));
    const grid = Int8Array.from(spec.solution);
    assert.equal(verifyColoring(key, spec.clues, grid), true, `${seed} 题面与答案不自洽`);
    assert.equal(bruteOk(key, spec.clues, grid), true, `${seed} 独立实现不认这张答案`);
    assert.equal(hasMonoSquare(key, grid), false, `${seed} 答案里塌了 2×2 地基`);
    assert.equal(spec.solutions, 1, `${seed} 生成器自己报的不是唯一解`);
    assert.equal(spec.capped, false, `${seed} 没数完就端上桌`);
    for (let i = 0; i < spec.clues.length; i++) {
      if (!spec.clues[i]) continue;
      assert.equal(spec.clues[i] > 0 ? BLACK : WHITE, spec.solution[i], `第 ${i} 格数字的符号与颜色不符`);
    }
    const given = spec.clues.filter((c) => c).length;
    assert.equal(spec.par, key * key - given, 'par 该是题面之外欠着一手的格子数');
    assert.equal(spec.cluesGiven, given);
    pars.push(spec.par);
  }
  assert.equal(faces.size, 40, `${key}×${key} 四十颗种子只交出 ${faces.size} 道题`);
  assert.ok(Math.min(...pars) >= key, `${key}×${key} 有一道题只留 ${Math.min(...pars)} 格可涂，太薄`);
  assert.ok(ms / 40 < 900, `${key}×${key} 平均 ${(ms / 40).toFixed(0)}ms，手机上出题太慢`);
});

test('同一颗种子在任何设备上得到同一道题，spec 过一遍 JSON 也不变味', () => {
  for (const key of TIERS) {
    const a = generate('daily:2026-09-27|akabane', key);
    const b = generate('daily:2026-09-27|akabane', key);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
    const copy = JSON.parse(JSON.stringify(a));
    const e = create(copy);
    paintAll(e, copy);
    assert.equal(e.solved(), true, 'JSON 往返之后就涂不满了');
  }
});

// 按答案把空格涂满：每格点到位（黑一下、白两下）
function paintAll(e, spec) {
  const n = spec.n;
  for (let i = 0; i < n * n; i++) {
    if (spec.clues[i]) continue;
    const x = i % n, y = (i - x) / n;
    const want = spec.solution[i];
    if (e.cellState(x, y) === want) continue;
    e.down(x, y, 0);
    if (e.cellState(x, y) !== want) e.down(x, y, 0);
  }
}

test('引擎开局：题面给的格子颜色已定且涂不动，空格一律未定', () => {
  const spec = generate('start:0', 6);
  const n = spec.n;
  const e = create(spec);
  assert.equal(e.board.cols, n);
  assert.equal(e.board.rows, n);
  const ci = spec.clues.findIndex((c) => c);
  const cx = ci % n, cy = (ci - cx) / n;
  assert.equal(e.isClue(cx, cy), true);
  assert.equal(e.cellState(cx, cy), spec.clues[ci] > 0 ? BLACK : WHITE, '题面给的格子没按符号预染');
  assert.equal(e.down(cx, cy, 0), false, '题面给的格子竟然能改色');
  assert.equal(e.down(cx, cy, 1), false, '题面给的格子竟然能打叉');
  const free = spec.clues.filter((c) => !c).length;
  assert.deepEqual(e.stats(), { moves: 0, par: free, done: 0, total: free });
  assert.equal(e.solved(), false);
});

test('空格第一次定色算一步，改色、擦除、打叉都不收账，撤销也不退款', () => {
  const spec = generate('moves:0', 6);
  const n = spec.n;
  const free = spec.clues.map((c, i) => i).filter((i) => !spec.clues[i]);
  const at = (i) => [i % n, (i - i % n) / n];
  const e = create(spec);
  const [a, b] = [at(free[0]), at(free[1])];
  assert.equal(e.down(...a, 0), true);                 // 空 → 黑：收一笔
  assert.equal(e.stats().moves, 1);
  assert.equal(e.cellState(...a), BLACK);
  assert.equal(e.down(...a, 0), true);                 // 黑 → 白：手滑改色，不另收
  assert.equal(e.cellState(...a), WHITE);
  assert.equal(e.stats().moves, 1);
  assert.equal(e.down(...a, 0), true);                 // 白 → 空：擦掉，也不另收，但已付的不退
  assert.equal(e.cellState(...a), EMPTY);
  assert.equal(e.stats().moves, 1);
  assert.equal(e.stats().done, 0, '擦干净之后进度该退回');
  assert.equal(e.down(...b, 0), true);
  assert.equal(e.stats().moves, 2);
  assert.equal(e.down(...b, 1), false, '已经定了色的格子不该再打叉');
  assert.equal(e.down(...at(free[2]), 1), true);       // 空格打叉：记事，不落子
  assert.equal(e.stats().moves, 2);
  assert.equal(e.undo(), true);
  assert.equal(e.stats().moves, 2, '撤销退回盘面，账却已经付过');
  assert.equal(e.canRedo(), true);
  assert.equal(e.redo(), true);
  assert.equal(e.stats().moves, 2, '重做不许另收一笔');
  assert.equal(e.move(0, 0), false, '涂色是一格一格的判断，拖动不该翻色');
  assert.equal(e.up(), false);
});

test('照答案涂满才算赢；缺一格、涂错一格都不算，赢了就锁盘', () => {
  const spec = generate('win:0', 6);
  const n = spec.n;
  const e = create(spec);
  paintAll(e, spec);
  assert.equal(e.solved(), true);
  assert.equal(e.stats().done, e.stats().total);
  const freeIdx = spec.clues.map((c, i) => i).filter((i) => !spec.clues[i]);
  const [qx, qy] = [freeIdx[0] % n, (freeIdx[0] - freeIdx[0] % n) / n];
  assert.equal(e.down(qx, qy, 0), false, '赢了还能改盘');
  assert.equal(e.hint(), null, '通关之后不许再给提示');
  // 差一格没涂：不算赢
  const g = create(spec);
  for (const i of freeIdx.slice(0, freeIdx.length - 1)) {
    const x = i % n, y = (i - x) / n;
    while (g.cellState(x, y) !== spec.solution[i]) g.down(x, y, 0);
  }
  assert.equal(g.solved(), false, '还有一格没定，怎么就赢了');
});

test('badCells 只冤枉真矛盾的格子', () => {
  const spec = generate('bad:0', 8);
  const n = spec.n;
  const keys = (list) => list.map(([x, y]) => y * n + x).join(',');
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '空盘不许报任何格子');
  paintAll(e, spec);
  assert.deepEqual(e.badCells(), [], '正解涂满却被报错');
  // 凑一个 2×2 同色：挑一个空格，把它涂成与旁边三格同色
  const f = create(spec);
  let hit = -1;
  for (let y = 0; y + 1 < n && hit < 0; y++) for (let x = 0; x + 1 < n && hit < 0; x++) {
    const q = [idx(n, x, y), idx(n, x + 1, y), idx(n, x, y + 1), idx(n, x + 1, y + 1)];
    const known = q.filter((i) => spec.clues[i]);
    if (known.length !== 3) continue;
    const col = spec.solution[known[0]];
    if (!known.every((i) => spec.solution[i] === col)) continue;
    const missing = q.find((i) => !spec.clues[i]);
    if (spec.solution[missing] === col) continue;      // 正解本来就不会同色
    const free = q.filter((i) => !spec.clues[i]);
    if (free.length !== 1) continue;
    hit = missing;
    while (f.cellState(missing % n, (missing - missing % n) / n) !== col) f.down(missing % n, (missing - missing % n) / n, 0);
  }
  if (hit >= 0) {
    assert.ok(keys(f.badCells()).includes(String(hit)), '凑出一个 2×2 同色却没人报警');
  }
  // 数字数超了：把某个数字格的四邻一路涂成它的颜色
  const g = create(spec);
  const ci = spec.clues.findIndex((c) => c);
  const cx = ci % n, cy = (ci - cx) / n;
  const want = clueColor(spec.clues[ci]);
  for (let i = 0; i < n * n; i++) {
    if (spec.clues[i]) continue;
    const x = i % n, y = (i - x) / n;
    if (Math.abs(x - cx) + Math.abs(y - cy) <= 1) { while (g.cellState(x, y) !== want) g.down(x, y, 0); }
  }
  assert.ok(keys(g.badCells()).includes(String(ci)), '把数字格四周全涂成它的颜色，还不该点它？');
});

test('提示一格一格涂得动，一路点下去能点到通关', () => {
  for (const key of [6, 8]) {
    const spec = generate(`hint:${key}`, key);
    const n = spec.n;
    const e = create(spec);
    let guard = 0;
    while (!e.solved() && guard++ < n * n + 20) {
      const before = e.stats().done;
      const h = e.hint();
      assert.ok(h, `第 ${guard} 次提示撒手，盘却还没涂完`);
      assert.ok(h.cells.length >= 1 && typeof h.note === 'string');
      assert.ok(e.stats().done > before || h.cells.some(([x, y]) => e.cellState(x, y) === EMPTY),
        `hint 落下去盘面没动 ${JSON.stringify(h.cells)}`);
      for (const [x, y] of h.cells) {
        const v = e.cellState(x, y);
        assert.ok(v === EMPTY || v === spec.solution[y * n + x],
          `hint 涂上的颜色与唯一解不符：${x},${y} 涂成 ${v}，答案是 ${spec.solution[y * n + x]}`);
      }
    }
    assert.equal(e.solved(), true, `点了 ${guard} 次还没涂完`);
  }
});

test('提示不许一次涂满全盘，也不许倒退款', () => {
  const spec = generate('hint-one:0', 8);
  const e = create(spec);
  const h = e.hint();
  assert.ok(h);
  assert.ok(h.cells.length < spec.par, '一次提示就把全盘涂满，玩家还画什么');
  const dots = e.stats().moves;
  e.hint();
  assert.ok(e.stats().moves >= dots);
});

test('引擎不碰时钟也不碰随机数：模块里不许出现 Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/akabane.js', import.meta.url), 'utf8'));
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
  paintAll(e, spec);
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20, '一帧什么都没画');
  if (e.celebrate) e.celebrate(ctx, v, 1000, 0.5);
});

test('出题在手机上不卡：每档十道题各有预算', () => {
  const BUDGET = { 6: 1200, 8: 3000, 10: 6000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`t${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < BUDGET[key], `${key}×${key} 十道题花了 ${ms}ms，超过 ${BUDGET[key]}ms`);
  }
});
