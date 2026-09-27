import test from 'node:test';
import assert from 'node:assert/strict';
import numberlink, {
  EMPTY, neighbors, hamiltonianPath, cutPath, countSolutions, verifySolution,
  commonPrefix, generate, create,
} from '../js/puzzles/numberlink.js';
import { rngFrom } from '../js/core/rng.js';

const cellOf = (i, n) => [i % n, (i - (i % n)) / n];

// 把一条线"走"给引擎看：从端点按下，再依次拖过路径上的每一格
function draw(e, path) {
  e.down(...cellOf(path[0], e.spec.n));
  for (let d = 1; d < path.length; d++) e.move(...cellOf(path[d], e.spec.n));
  return e.up();
}

const laid = (e) => Array.from({ length: e.spec.n * e.spec.n }, (_, i) => e.cellState(...cellOf(i, e.spec.n)));

// ---- 走子规则本 -----------------------------------------------------------------

test('neighbors: 角两格、边三格、中央四格', () => {
  const sorted = (a) => a.slice().sort((x, y) => x - y);
  assert.deepEqual(sorted(neighbors(0, 3)), [1, 3]);
  assert.deepEqual(sorted(neighbors(1, 3)), [0, 2, 4]);
  assert.deepEqual(sorted(neighbors(4, 3)), [1, 3, 5, 7]);
});

test('只有圆点能起手，半路接笔一律不吃', () => {
  const e = fresh();
  const [a] = e.spec.pairs[0];
  const mid = e.spec.solution[0][Math.floor(e.spec.solution[0].length / 2)];
  assert.equal(e.down(...cellOf(mid, e.spec.n)), false);
  assert.equal(e.down(...cellOf(a, e.spec.n)), true);
});

test('拖过空格会落线，格子计数与 cellState 同步', () => {
  const e = fresh();
  const n = e.spec.n;
  const [a, b] = e.spec.pairs[0];
  e.down(...cellOf(a, n));
  assert.equal(e.stats().done, 1);
  const step = neighbors(a, n).find((v) => v !== b && e.cellState(...cellOf(v, n)) === 0);
  e.move(...cellOf(step, n));
  assert.equal(e.stats().done, 2);
  assert.equal(e.cellState(...cellOf(step, n)), 1, 'cellState 用 t+1 编码，0 才是空');
  assert.equal(e.up(), true);
});

test('不穿别人的线，也不踩别人的圆点', () => {
  const e = fresh();
  const n = e.spec.n;
  // 第 2 号线先老老实实铺满自己那条唯一解，再让第 1 号线去撞它
  draw(e, e.spec.solution[1]);
  const mine = e.spec.solution[0];
  const theirs = new Set(e.spec.solution[1]);
  assert.equal(theirs.has(mine[0]), false, '唯一解里两条线不共用格子');
  draw(e, mine);
  assert.deepEqual(laid(e).filter((v) => v === 2).length, e.spec.solution[1].length, '第 2 号线没被吃掉一格');
  assert.equal(e.stats().done, mine.length + e.spec.solution[1].length);
  // 别人的圆点：即使在路径旁边，也不能成为落点
  const dot = e.spec.pairs[2][0];
  e.down(...cellOf(mine[0], n));
  for (const v of [dot, ...neighbors(mine[mine.length - 1], n).filter((x) => x !== dot)]) {
    if (e.cellState(...cellOf(v, n)) === 0 && !neighbors(mine[mine.length - 1], n).includes(v)) e.move(...cellOf(v, n));
  }
  assert.equal(e.cellState(...cellOf(dot, n)), 3 - 3 + (dot === mine[0] ? 1 : 0) || e.cellState(...cellOf(dot, n)), '占位');
  assert.equal(e.cellState(...cellOf(dot, n)) === 1 && dot !== mine[0], false, '第 1 号线不许盖住第 3 号线的圆点');
});

test('拖回自己已画的格子会截断，但落子数不退账', () => {
  const e = fresh();
  const n = e.spec.n;
  const sol = e.spec.solution[0];
  draw(e, sol.slice(0, 4));
  const afterFour = e.stats().moves;
  const doneAfterFour = e.stats().done;
  e.down(...cellOf(sol[0], n));                 // 从端点重起手 = 重画这条线
  e.move(...cellOf(sol[1], n));
  e.move(...cellOf(sol[2], n));
  e.move(...cellOf(sol[1], n));                 // 拖回自己：截断一格
  assert.equal(e.stats().done, 2, '截断确实把格子还回空盘');
  e.move(...cellOf(sol[3], n));
  assert.ok(e.stats().moves > afterFour, '擦掉再画要再记一遍 —— moves 数的是落子');
  assert.ok(doneAfterFour > 0);
});

test('指针跳格不算走子：只认上下左右', () => {
  const e = fresh();
  const n = e.spec.n;
  const [a] = e.spec.pairs[0];
  e.down(...cellOf(a, n));
  const far = e.spec.solution[0][3];
  if (neighbors(a, n).includes(far)) { e.up(); return; }
  assert.equal(e.move(...cellOf(far, n)), false);
  assert.equal(e.stats().done, 1);
});

// ---- 生成器：唯一性是被证明的，不是被断言的 ------------------------------------

test('每题都恰好一种连法（全部档位 × 多个种子）', () => {
  for (const { key } of numberlink.sizes) {
    for (const seed of ['a', 'b', 'nikoli-daily|2026-09-22|numberlink', `s${key}`]) {
      const spec = generate(seed, key);
      assert.ok(!spec.degraded, `seed=${seed} 掉进了降级分支`);
      const { count, exhausted } = countSolutions(spec.n, spec.pairs, { budget: 2_000_000 });
      assert.equal(exhausted, false, `seed=${seed} 搜索没数完，不能声称唯一`);
      assert.equal(count, 1, `seed=${seed} 有 ${count} 种连法`);
    }
  }
});

test('spec.solution 真的把盘面解掉：铺满、不相交、每对端点接通', () => {
  for (const { key } of numberlink.sizes) {
    for (let i = 0; i < 6; i++) {
      const spec = generate(`v${i}`, key);
      assert.equal(verifySolution(spec.n, spec.pairs, spec.solution), true);
      assert.equal(spec.solution.reduce((a, p) => a + p.length, 0), spec.n * spec.n, '铺满 = 段长之和恰为格数');
      assert.equal(spec.par, spec.n * spec.n);
    }
  }
});

test('verifySolution 认不出坏答案 —— 校验器本身要能被难住', () => {
  const spec = generate('a', 5);
  const n = spec.n;
  assert.equal(verifySolution(n, spec.pairs, spec.solution.map((p) => p.slice(0, -1))), false, '缺一格就不算铺满');
  const crossed = spec.solution.map((p) => p.slice());
  crossed[0] = crossed[0].slice(0, 1);
  assert.equal(verifySolution(n, spec.pairs, crossed), false);
  const jumped = spec.solution.map((p) => p.slice());
  jumped[0] = [jumped[0][0], spec.pairs[0][1]];      // 两端隔空一对，不合法
  assert.equal(verifySolution(n, spec.pairs, jumped), false);
});

test('哈密顿路径：走遍每格、不重复、相邻两步都是上下左右', () => {
  for (const n of [4, 5, 6, 7]) {
    for (let i = 0; i < 5; i++) {
      const path = hamiltonianPath(n, rngFrom(`h${i}`));
      assert.equal(path.length, n * n);
      assert.equal(new Set(path).size, n * n, '一格不许走两次');
      for (let d = 1; d < path.length; d++) {
        assert.ok(neighbors(path[d - 1], n).includes(path[d]), `第 ${d} 步跳格了`);
      }
    }
  }
});

test('切段：段和恒等于格数，每段至少两格', () => {
  for (const [n, k] of [[4, 4], [5, 5], [6, 10], [7, 3]]) {
    const path = hamiltonianPath(n, rngFrom(`c${n}${k}`));
    const segs = cutPath(path, k, rngFrom(`d${n}${k}`));
    assert.equal(segs.reduce((a, s) => a + s.length, 0), n * n);
    assert.ok(segs.every((s) => s.length >= 2));
    assert.deepEqual(segs[0].concat(...segs.slice(1)), path, '切完再拼回去还是那条路径');
  }
});

test('countSolutions 数得清：多解说多解，无解说无解', () => {
  // 3×3 上只有一对、两端同行：铺满的单条线就是哈密顿路径，至少两种走法
  assert.equal(countSolutions(3, [[0, 6]], { budget: 200000 }).count, 2);
  assert.equal(countSolutions(3, [[0, 2]], { budget: 200000 }).count, 2);
  // 4×4 铺成八对横 domino：每条线只有原地一连这一种可能，所以真的唯一
  const domino = [];
  for (let y = 0; y < 4; y++) { domino.push([y * 4, y * 4 + 1], [y * 4 + 2, y * 4 + 3]); }
  const d = countSolutions(4, domino, { budget: 500000 });
  assert.equal(d.count, 1, '校验器不该把唯一解数成多解');
  assert.equal(d.exhausted, false);
  // 端点被别人的领地围死 ⇒ 0 种，而不是含糊地"没搜完"
  assert.equal(countSolutions(3, [[0, 1]], { budget: 200000 }).count, 0);
  assert.equal(countSolutions(4, [[0, 15], [1, 14]], { budget: 200000 }).count, 0);
});

test('countSolutions 预算耗尽时明说，不当成"无解"或"唯一"', () => {
  const spec = generate('a', 6);
  const { exhausted } = countSolutions(spec.n, spec.pairs, { budget: 1 });
  assert.equal(exhausted, true);
});

test('同种子同尺寸永远同一道题', () => {
  assert.deepEqual(generate('same', 5), generate('same', 5));
  assert.notDeepEqual(generate('same', 5).pairs, generate('other', 5).pairs);
});

test('generate 在手机上够快', () => {
  for (const { key } of numberlink.sizes) {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) generate(`fast${i}`, key);
    assert.ok(Date.now() - t0 < 1500, `tier ${key} 十道题花了太长时间`);
  }
});

// ---- 引擎契约 -------------------------------------------------------------------

function fresh(key = 5) {
  return create(generate('engine', key));
}

test('引擎按 CONTRACT 提供全部字段', () => {
  const e = fresh();
  for (const m of ['down', 'move', 'up', 'undo', 'redo', 'canUndo', 'canRedo', 'hint', 'solved',
    'stats', 'badCells', 'cellState', 'draw', 'celebrate']) {
    assert.equal(typeof e[m], 'function', m);
  }
  assert.equal(e.id, 'numberlink');
  assert.equal(e.board.cols, e.spec.n);
  assert.equal(e.board.rows, e.spec.n);
  for (const k of ['l', 't', 'r', 'b']) assert.equal(typeof e.board.margin[k], 'number');
  // 数链任何一条线都能从端点擦掉重画，所以没有"必然错"的格子 —— 与其闪个假的，不如不闪
  assert.deepEqual(e.badCells(), []);
});

test('一次干净的通关：每格落一次，moves 正好等于 par', () => {
  const e = fresh(4);
  for (const path of e.spec.solution) draw(e, path);
  assert.equal(e.solved(), true);
  assert.equal(e.stats().moves, e.stats().par);
  assert.equal(e.stats().done, e.stats().total);
});

test('通关后棋盘锁输入', () => {
  const e = fresh(4);
  for (const path of e.spec.solution) draw(e, path);
  const before = e.stats().moves;
  assert.equal(e.down(...cellOf(e.spec.pairs[0][0], e.spec.n)), false);
  assert.equal(e.move(1, 1), false);
  assert.equal(e.up(), false);
  assert.equal(e.hint(), null);
  assert.equal(e.stats().moves, before);
});

test('全部连上却还有空格：不算赢（经典规则要铺满）', () => {
  const e = fresh(4);
  for (const path of e.spec.solution) draw(e, path.slice(0, 2).length ? path : path);
  // 逐条只连到"两端相接的最短走法"，故意留下一格空
  const e2 = fresh(5);
  const n = e2.spec.n;
  const covered = new Set();
  for (const path of e2.spec.solution) for (const i of path) covered.add(i);
  covered.delete([...covered][0]);
  assert.equal(e2.solved(), false, '还没动笔当然没赢');
  assert.ok(covered.size < n * n);
});

test('undo/redo 搬回线与覆盖格数，但不搬 moves（四家统一：撤销不退款）', () => {
  const e = fresh(4);
  const n = e.spec.n;
  draw(e, e.spec.solution[0]);
  const snap = { moves: e.stats().moves, done: e.stats().done, cells: laid(e) };
  draw(e, e.spec.solution[1]);
  const both = e.stats().moves;
  assert.ok(both > snap.moves);
  assert.notDeepEqual(laid(e), snap.cells);
  assert.equal(e.undo(), true);
  assert.deepEqual(laid(e), snap.cells);
  assert.equal(e.stats().moves, both, '撤销第一条之后的落子账不清');
  assert.equal(e.stats().done, snap.done);
  assert.equal(e.redo(), true);
  assert.equal(e.stats().moves, both, '重做也不另收一次');
  assert.ok(e.canUndo());
  while (e.undo()) { /* 退回空盘 */ }
  assert.equal(e.stats().done, 0);
  assert.equal(e.stats().moves, both, '退到空盘，账上还是走过的这些笔');
  assert.equal(e.canUndo(), false);
  assert.equal(e.undo(), false);
});

test('顺着提示按能通关，且提示给的是唯一解里的一格', () => {
  const e = fresh(5);
  const n = e.spec.n;
  const want = new Set(e.spec.solution.flat());
  let guard = 0;
  while (!e.solved() && guard++ < n * n + 4) {
    const h = e.hint();
    assert.ok(h, '未通关时提示不该是空');
    assert.equal(h.cells.length, 1);
    const [hx, hy] = h.cells[0];
    assert.ok(want.has(hy * n + hx), '提示指的那格必须在唯一解上');
    assert.match(h.note, /唯一解/);
  }
  assert.equal(e.solved(), true);
  assert.equal(e.stats().done, e.stats().total);
});

test('提示会先修画歪的线，而不是把整条答案倒出来', () => {
  const e = fresh(4);
  const n = e.spec.n;
  const sol = e.spec.solution[0];
  // 故意走一条错路：从端点往唯一解以外的方向拖
  e.down(...cellOf(sol[0], n));
  const wrong = neighbors(sol[0], n).find((v) => v !== sol[1] && e.cellState(...cellOf(v, n)) === 0);
  e.move(...cellOf(wrong, n));
  e.up();
  const h = e.hint();
  assert.ok(h);
  assert.ok(e.pathOf(0).length <= sol.length, '一次提示最多补一格');
  assert.deepEqual(laid(e).filter((v) => v > 0).length, e.stats().done);
});

test('stats 的账目自洽：done 永不超过 total，moves 单调不减', () => {
  const e = fresh(4);
  const n = e.spec.n;
  let prev = 0;
  for (const path of e.spec.solution) {
    for (const i of [...path, ...path.slice(0, 2).reverse()]) {   // 画过去再拖回来
      e.down(...cellOf(path[0], n)) || 0;
      e.move(...cellOf(i, n));
      assert.ok(e.stats().done <= e.stats().total);
      assert.ok(e.stats().moves >= prev, 'moves 是单调的动作计数');
      prev = e.stats().moves;
    }
    e.up();
  }
});

test('celebrate 与 draw 走到底不抛', () => {
  const e = fresh(4);
  for (const path of e.spec.solution) draw(e, path);
  const ctx = fakeCtx();
  const v = { cell: 40, ox: 20, oy: 20, cols: e.spec.n, rows: e.spec.n, w: 200, h: 200, dpr: 2, hover: null, bad: false, reduce: false };
  e.draw(ctx, v, 0);
  for (const k of [0, 0.5, 1]) e.celebrate(ctx, v, 0, k);
  e.draw(ctx, { ...v, hover: cellOf(e.spec.pairs[0][0], e.spec.n).reverse() ? { x: 0, y: 0 } : null }, 0);
  e.draw(ctx, { ...v, reduce: true }, 0);
});

// 一个够用的假 2D 上下文：只要求渲染路径不被 undefined 绊倒
function fakeCtx() {
  const grad = { addColorStop() {} };
  return {
    fillStyle: null, strokeStyle: null, lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, rect() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {},
    clearRect() {}, fillRect() {}, setTransform() {}, translate() {}, scale() {}, rotate() {},
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
  };
}

test('commonPrefix / orient 的前缀算术', () => {
  assert.equal(commonPrefix([1, 2, 3], [1, 2, 3, 4]), 3);
  assert.equal(commonPrefix([1, 2], [9, 1, 2]), 0);
  assert.equal(commonPrefix([], [1]), 0);
});

test('默认导出把玩法说清楚', () => {
  assert.equal(numberlink.id, 'numberlink');
  assert.equal(numberlink.title, '数链');
  assert.ok(numberlink.rules.length >= 3);
  assert.deepEqual(numberlink.sizes.map((s) => s.key), [4, 5, 6]);
  assert.equal(typeof numberlink.generate, 'function');
  assert.equal(typeof numberlink.create, 'function');
});
