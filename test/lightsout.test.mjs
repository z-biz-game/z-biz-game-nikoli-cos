import test from 'node:test';
import assert from 'node:assert/strict';
import lightsout, {
  LIT, DARK, plusCells, pressCell, boardFromPresses, toRows, isSolved,
  solveAll, minSolution, nullity, generate, create,
} from '../js/puzzles/lightsout.js';

// ---- 暴力对照 -------------------------------------------------------------------
// 引擎的求解靠 light chasing（首行一定，其后被逼出来），只用到了"解的结构"这一半；
// 暴力枚举 2^(n*n) 个按压力集，只用到了"规则"这一半。两者对拍才说明结构真的没漏。
// 每档 n 都跑：n=3/4/5 分别是 512 / 65 536 / 33 554 432 个子集 —— 5×5 那档最贵，
// 但位掩码下仍然跑得动（见下方 timing 断言，只在一个盘面上做）。
function bruteSolutions(board, n) {
  const rows = toRows(board, n);
  const m = (1 << n) - 1;
  const out = [];
  const total = 1 << (n * n);
  const p = new Array(n);
  for (let s = 0; s < total; s++) {
    for (let y = 0; y < n; y++) p[y] = (s >>> (y * n)) & m;
    let ok = true;
    for (let y = 0; y < n && ok; y++) {
      const up = y > 0 ? p[y - 1] : 0;
      const dn = y < n - 1 ? p[y + 1] : 0;
      if ((rows[y] ^ p[y] ^ ((p[y] << 1) & m) ^ (p[y] >> 1) ^ up ^ dn) !== m) ok = false;
    }
    if (ok) out.push(p.slice());
  }
  return out;
}

const bruteMin = (board, n) => {
  let best = Infinity;
  for (const p of bruteSolutions(board, n)) {
    let c = 0;
    for (const row of p) for (let x = 0; x < n; x++) if (row & (1 << x)) c++;
    if (c < best) best = c;
  }
  return best;
};

// 解 → 按压格索引（行优先升序），与 solveAll 的返回形式对齐，便于直接比集合
const bruteIndices = (p, n) => {
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (p[y] & (1 << x)) cells.push(y * n + x);
  return cells;
};

// ---- 规则本 ---------------------------------------------------------------------

test('plusCells: 角上四格、边上三格、中央五格', () => {
  assert.deepEqual(plusCells(0, 0, 5), [[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(plusCells(2, 0, 5), [[2, 0], [1, 0], [3, 0], [2, 1]]);
  assert.deepEqual(plusCells(2, 2, 5).length, 5);
});

test('pressCell 是自身的逆：同一格按两次，盘面一字不变', () => {
  for (const n of [4, 5, 6]) {
    const a = boardFromPresses(n, [0, 7, n * n - 1]);
    const b = Uint8Array.from(a);
    pressCell(b, 3, 3, n);
    pressCell(b, 3, 3, n);
    assert.deepEqual([...b], [...a]);
  }
});

test('boardFromPresses 就是从全亮出发按完这组按压的结果', () => {
  const n = 5;
  // 只按中心：它那十字变暗，其余还亮着。行是位掩码，bit x = 列 x
  assert.deepEqual(Array.from(toRows(boardFromPresses(n, [12]), n)), [31, 27, 17, 27, 31]);
  assert.equal(isSolved(boardFromPresses(n, []), n), true);
  // 全暗在位掩码里是 0，全亮是 m —— 这一眼能验出 toRows 的方向没写反
  assert.deepEqual(Array.from(toRows(new Uint8Array(25).fill(LIT), 5)), [31, 31, 31, 31, 31]);
  assert.deepEqual(Array.from(toRows(new Uint8Array(25).fill(DARK), 5)), [0, 0, 0, 0, 0]);
  assert.equal(isSolved(new Uint8Array(25).fill(DARK), 5), false);
});

test('isSolved 要的是"一盏都不灭"', () => {
  assert.equal(isSolved(new Uint8Array(25).fill(LIT), 5), true);
  const board = new Uint8Array(25).fill(LIT);
  board[0] = DARK;
  assert.equal(isSolved(board, 5), false);
});

// ---- 求解器，与暴力对拍 --------------------------------------------------------

test('solveAll == 暴力枚举的全部解（n=3、n=4，多个盘面）', () => {
  for (const n of [3, 4]) {
    for (const presses of [[], [0], [0, 5], [1, 2, 3, 10], [0, 3, 6, 9, 12, 15]]) {
      const board = boardFromPresses(n, presses);
      const mine = solveAll(board, n).map((s) => [...s].join(',')).sort();
      const brute = bruteSolutions(board, n).map((p) => bruteIndices(p, n).join(',')).sort();
      assert.deepEqual(mine, brute, `n=${n} presses=${presses}`);
    }
  }
});

test('minSolution 的步数 == 暴力最小按压数', () => {
  const cases = [
    [3, [1, 5]],
    [3, [0, 2, 6, 8]],
    [4, [0, 1, 5, 11]],
    [4, [3, 4, 12, 15, 6]],
    [4, [0, 1, 2, 3, 4, 5, 6, 7, 8]],   // 按 9 下：降秩里有更省手的等价解
  ];
  for (const [n, presses] of cases) {
    const board = boardFromPresses(n, presses);
    const mine = minSolution(board, n);
    assert.equal(mine.length, bruteMin(board, n), `n=${n}`);
    assert.ok(mine.length <= presses.length, '最短解不该比抽出来的按压更费手');
    // 返回的解真的能用：按完它就该全亮
    const after = Uint8Array.from(board);
    for (const i of mine) pressCell(after, i % n, (i - (i % n)) / n, n);
    assert.equal(isSolved(after, n), true);
  }
});

test('5×5 经典盘：GF(2) 消元与 2^25 暴力对照给出同一个最短解', () => {
  const n = 5;
  const board = boardFromPresses(n, [0, 6, 12, 18, 24, 2, 8]);
  const mine = minSolution(board, n);
  // 暴力那份是固定 2^25 次枚举，工作量与机器无关，所以不再拿墙钟当断言：
  // 慢机器上它只是慢，不是错 —— 把"跑得完"说成"算得对"是假信号。
  assert.equal(mine.length, bruteMin(board, n));
});

test('降秩给的多解：5×5 每个可解盘面恰有 4 个解，4×4 恰有 16 个', () => {
  assert.equal(nullity(5), 2);
  assert.equal(nullity(4), 4);
  assert.equal(nullity(3), 0);
  // 6×6、7×7 的翻转矩阵是满秩的（评论里曾以为 6×6 也降秩，这里钉住事实）
  assert.equal(nullity(6), 0);
  assert.equal(nullity(7), 0);
  for (const presses of [[4], [0, 11, 22], Array.from({ length: 8 }, (_, i) => i * 3 % 25)]) {
    const board = boardFromPresses(5, presses);
    assert.equal(solveAll(board, 5).length, 4);
  }
  // 满秩尺寸里解唯一
  assert.equal(solveAll(boardFromPresses(7, [10, 24, 38]), 7).length, 1);
});

test('无解的盘面：solveAll 返回空，minSolution 返回 null', () => {
  // 5×5 降秩 ⇒ 存在够不着的盘面：单灭一角就不在值域里（按压的十字永远凑不出那个奇偶形状）。
  const board = new Uint8Array(25).fill(LIT);
  board[0] = DARK;
  assert.deepEqual(solveAll(board, 5), []);
  assert.equal(minSolution(board, 5), null);
});

// ---- 出题 -----------------------------------------------------------------------

test('generate：题面一定可解，par 就是最短解长度', () => {
  for (const key of lightsout.sizes.map((s) => s.key)) {
    for (const seed of ['a', 'b', 'nikoli-daily|2026-09-22|lightsout']) {
      const spec = generate(seed, key);
      const best = minSolution(Uint8Array.from(spec.board), spec.n);
      assert.ok(best, `seed=${seed} 必须可解`);
      assert.equal(best.length, spec.par);
      assert.equal(spec.kind, 'lightsout');
      assert.equal(spec.board.length, spec.n * spec.n);
      assert.ok(spec.par >= 1 && spec.par <= spec.n * spec.n);
      assert.equal(spec.solutions, 2 ** spec.nullity);
    }
  }
});

test('generate 同种子同尺寸给出同一道题', () => {
  assert.deepEqual(generate('same', 5), generate('same', 5));
  assert.notDeepEqual(generate('same', 5), generate('other', 5));
});

test('generate 的门槛卡的是 par，不是抽了几下手', () => {
  // 每档刷 25 个种子：par 的下界就是 TIERS 里的门槛（抽了 14 下手却 3 步就完，不算题）
  const floor = { 4: 4, 5: 6, 6: 9, 7: 12 };
  for (const key of Object.keys(floor)) {
    for (let i = 0; i < 25; i++) {
      const spec = generate(`s${i}`, Number(key));
      assert.ok(spec.par >= floor[key], `tier ${key} seed s${i} 只有 ${spec.par} 步`);
      assert.ok(spec.par <= spec.n * spec.n, 'par 不该超过格子数');
    }
  }
});

// ---- 引擎契约 -------------------------------------------------------------------

const fresh = (key = 5) => create(generate('engine', key));

test('引擎按 CONTRACT 提供全部字段', () => {
  const e = fresh();
  for (const m of ['down', 'move', 'up', 'undo', 'redo', 'canUndo', 'canRedo', 'hint', 'solved', 'stats', 'badCells', 'cellState', 'pressCount', 'draw', 'celebrate']) {
    assert.equal(typeof e[m], 'function', m);
  }
  assert.equal(e.id, 'lightsout');
  assert.deepEqual(e.board, { cols: 5, rows: 5, margin: e.board.margin });
  const v = e.board.margin;
  for (const k of ['l', 't', 'r', 'b']) assert.equal(typeof v[k], 'number');
  assert.deepEqual(e.badCells(), []);
});

// 题面盘面的第 (x,y) 格，归一到 LIT/DARK —— 引擎内部会拷贝一份，对照要拿原始值
const srcCell = (e, x, y) => (e.spec.board[y * e.spec.n + x] ? LIT : DARK);

test('按一下翻它自己和两邻（角上只有三格），moves 记这一下', () => {
  const e = fresh();
  assert.equal(e.down(0, 0), true);
  assert.equal(e.stats().moves, 1);
  assert.equal(e.pressCount(0, 0), 1);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) {
    assert.equal(e.cellState(x, y), srcCell(e, x, y) === LIT ? DARK : LIT, `(${x},${y}) 该翻`);
  }
  for (const [x, y] of [[2, 0], [0, 2], [3, 3], [4, 4]]) {
    assert.equal(e.cellState(x, y), srcCell(e, x, y), `(${x},${y}) 不该动`);
  }
  assert.equal(e.pressCount(4, 4), 0);
});

test('越界与拖动：move 永远不吃输入，边界外不落下', () => {
  const e = fresh();
  assert.equal(e.down(-1, 0), false);
  assert.equal(e.down(5, 0), false);
  assert.equal(e.down(0, 5), false);
  assert.equal(e.move(2, 2), false);
  assert.equal(e.up(2, 2), false);
  assert.equal(e.stats().moves, 0);
});

test('undo/redo 搬回盘面与按压数，但不搬 moves（四家统一：撤销不退款）', () => {
  const e = fresh();
  e.down(0, 0);
  e.down(4, 4);
  const mid = Array.from({ length: 25 }, (_, i) => e.cellState(i % 5, (i - (i % 5)) / 5));
  const midInk = Array.from({ length: 25 }, (_, i) => e.pressCount(i % 5, (i - (i % 5)) / 5));
  assert.equal(e.undo(), true);
  assert.equal(e.stats().moves, 2, '撤销不许把试错的那一步洗掉');
  assert.equal(e.undo(), true);
  assert.equal(e.stats().moves, 2, '退到开局，账还是两步');
  assert.equal(e.canUndo(), false);
  assert.equal(e.undo(), false);
  assert.equal(e.canRedo(), true);
  assert.equal(e.redo(), true);
  assert.equal(e.redo(), true);
  assert.equal(e.stats().moves, 2, '重做只是把付过账的那步放回盘面，不再收一遍');
  assert.deepEqual(
    Array.from({ length: 25 }, (_, i) => e.cellState(i % 5, (i - (i % 5)) / 5)),
    mid,
  );
  assert.deepEqual(
    Array.from({ length: 25 }, (_, i) => e.pressCount(i % 5, (i - (i % 5)) / 5)),
    midInk,
    'redo 之后淡墨点该回到那一步之后的样子',
  );
});

test('按两下等于没按：墨点数到 2 就是给自己看的记号', () => {
  const e = fresh();
  const before = e.cellState(2, 2);
  e.down(2, 2);
  e.down(2, 2);
  assert.equal(e.cellState(2, 2), before);
  assert.equal(e.pressCount(2, 2), 2);
  assert.equal(e.stats().moves, 2);
});

test('hint 走的是最短解的一步，通关后锁输入', () => {
  const e = fresh();
  const par = e.stats().par;
  const h = e.hint();
  assert.ok(h && h.cells.length === 1);
  assert.match(h.note, /最短/);
  assert.equal(e.stats().moves, 1);

  // 顺着提示按，应当恰好用 par 步就全亮
  let guard = 0;
  while (!e.solved() && guard++ < 40) e.hint();
  assert.equal(e.solved(), true);
  assert.equal(e.stats().moves, par, '每次都取最短解的首步，总步数就该是 par');
  assert.equal(e.hint(), null);
  assert.equal(e.down(1, 1), false, '判胜之后棋盘锁输入');
  assert.equal(e.stats().moves, par);
});

test('stats 的 done/total 数的是还剩几盏要救', () => {
  const e = fresh();
  const s0 = e.stats();
  assert.equal(s0.total, 25);
  assert.ok(s0.done >= 1 && s0.done <= 25);
  e.down(0, 0);
  assert.ok(Math.abs(e.stats().done - s0.done) <= 5, '一下最多动五格');
});

test('celebrate 的 k 从 0 走到 1 不该抛', () => {
  const e = fresh();
  const ctx = fakeCtx();
  for (const k of [0, 0.5, 1]) e.celebrate(ctx, view(5), 0, k);
  e.draw(ctx, view(5), 0);
});

// 一个够用的假 2D 上下文：渲染路径只要不被 `undefined` 绊倒就行
function fakeCtx() {
  const grad = { addColorStop() {} };
  const c = {
    fillStyle: null, strokeStyle: null, lineWidth: 0, globalAlpha: 1, font: '', textAlign: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, rect() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {}, clearRect() {},
    setTransform() {}, translate() {}, scale() {}, rotate() {}, fillRect() {},
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
  };
  return c;
}

const view = (n) => ({
  cell: 40, ox: 20, oy: 20, cols: n, rows: n, w: n * 40 + 40, h: n * 40 + 40, dpr: 2,
  hover: { x: 1, y: 1 }, bad: false, reduce: false,
});
