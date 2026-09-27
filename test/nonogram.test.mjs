import test from 'node:test';
import assert from 'node:assert/strict';
import nonogram, {
  arrangements, deduceLine, logicSolve, pictureToSpec, isGoodSpec, generate, create,
  FILLED, EMPTY, UNKNOWN, cluesFromLine,
} from '../js/puzzles/nonogram.js';

const HEART = ['##.##', '#####', '#####', '.###.', '..#..'];

test('arrangements: 2,2 in a line of 5 has exactly one placement', () => {
  const { list } = arrangements(5, [2, 2], new Int8Array(5));
  assert.equal(list.length, 1);
  assert.deepEqual([...list[0]], [1, 1, 0, 1, 1]);
});

test('arrangements: a forced cell admits every block that covers it', () => {
  const known = new Int8Array(5);
  known[2] = FILLED;
  const { list } = arrangements(5, [3], known);
  assert.equal(list.length, 3);
  for (const a of list) assert.equal(a[2], 1);
  // …so the intersection still teaches us exactly one cell
  assert.deepEqual(deduceLine(5, [3], known).filled, []);
  // …so an empty line of the same shape teaches exactly one cell, and nothing else
  const d = deduceLine(5, [3], new Int8Array(5));
  assert.deepEqual(d.filled, [2]);
  assert.deepEqual(d.empty, []);
});

test('arrangements: contradiction when the clue cannot fit the known cells', () => {
  const known = new Int8Array(5);
  known[0] = EMPTY;
  known[4] = EMPTY;
  const { list } = arrangements(5, [5], known);
  assert.equal(list.length, 0);
});

test('deduceLine: a long clue forces its overlap cells', () => {
  assert.deepEqual(deduceLine(7, [5], new Int8Array(7)).filled, [2, 3, 4]);
  assert.deepEqual(deduceLine(7, [7], new Int8Array(7)).filled, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(deduceLine(7, [1], new Int8Array(7)).filled, []);
  // [3,3] in 7 fits exactly one way, so the whole line becomes known
  const full = deduceLine(7, [3, 3], new Int8Array(7));
  assert.deepEqual(full.filled, [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(full.empty, [3]);
});

test('cluesFromLine round-trips a drawn line', () => {
  assert.deepEqual(cluesFromLine([1, 1, 0, 1]), [2, 1]);
  assert.deepEqual(cluesFromLine([0, 0, 0]), []);
});

test('spec from a picture carries the picture', () => {
  const spec = pictureToSpec(HEART);
  assert.equal(spec.w, 5);
  assert.equal(spec.h, 5);
  assert.deepEqual(spec.rowClues, [[2, 2], [5], [5], [3], [1]]);
  assert.ok(isGoodSpec(spec));
});

test('logicSolve from empty reaches the picture — that is the uniqueness proof', () => {
  const spec = pictureToSpec(HEART);
  const res = logicSolve(new Int8Array(spec.w * spec.h), spec.w, spec.h, spec.rowClues, spec.colClues);
  assert.equal(res.solved, true);
  const got = [];
  for (let y = 0; y < spec.h; y++) {
    let row = '';
    for (let x = 0; x < spec.w; x++) row += res.grid[y * spec.w + x] === FILLED ? '#' : '.';
    got.push(row);
  }
  assert.deepEqual(got, HEART);
});

for (const size of nonogram.sizes.map((s) => s.key)) {
  test(`generate ${size}×${size}: pure-logic solvable over 12 seeds`, () => {
    for (let i = 0; i < 12; i++) {
      const spec = generate(`n${size}-${i}`, size);
      assert.equal(spec.w, size);
      assert.equal(spec.h, size);
      assert.ok(isGoodSpec(spec), `seed ${i} is not logic-solvable`);
      const res = logicSolve(new Int8Array(size * size), size, size, spec.rowClues, spec.colClues);
      assert.equal(res.solved, true);
      let painted = 0;
      for (const v of res.grid) if (v === FILLED) painted++;
      assert.equal(painted, spec.rowClues.flat().reduce((a, b) => a + b, 0));
    }
  });
}

test('generated boards are not all the same board', () => {
  const clues = new Set();
  for (let i = 0; i < 30; i++) clues.add(JSON.stringify(generate(`variety-${i}`, 10).rowClues));
  assert.ok(clues.size >= 8, `only ${clues.size} distinct 10x10 boards from 30 seeds`);
});

test('same seed, same puzzle', () => {
  assert.deepEqual(generate('daily-2026-09-27', 10), generate('daily-2026-09-27', 10));
});

// The engine is driven the way the UI drives it: integer cell taps, undo, hint.
function board(size = 5, seed = 'engine') {
  return create(generate(seed, size));
}

const cellsOf = (pic) => {
  const on = [];
  const off = [];
  pic.forEach((row, y) => [...row].forEach((c, x) => (c === '#' ? on : off).push([x, y])));
  return { on, off };
};

test('engine: the main pen fills and clears', () => {
  const e = board();
  const { on } = cellsOf(e.spec.picture.split('\n'));
  const [x0, y0] = on[0];
  assert.equal(e.down(x0, y0, 0), true);
  assert.equal(e.cellState(x0, y0), FILLED);
  assert.equal(e.stats().done, 1);
  assert.equal(e.down(x0, y0, 0), true);
  assert.equal(e.cellState(x0, y0), UNKNOWN);
  assert.equal(e.stats().done, 0);
});

test('engine: the secondary pen toggles a cross out', () => {
  const e = board();
  const { off } = cellsOf(e.spec.picture.split('\n'));
  const [x1, y1] = off[0];
  assert.equal(e.down(x1, y1, 1), true);
  assert.equal(e.cellState(x1, y1), EMPTY);
  assert.equal(e.down(x1, y1, 1), true);
  assert.equal(e.cellState(x1, y1), UNKNOWN);
});

test('engine: drawing the picture wins, a missing cell does not', () => {
  for (const size of [5, 10]) {
    const e = board(size, `win-${size}`);
    const { on } = cellsOf(e.spec.picture.split('\n'));
    for (const [x, y] of on) e.down(x, y, 0);
    assert.equal(e.solved(), true, `${size}x${size} correct draw did not win`);
  }
  const near = board(7, 'near-miss');
  const { on } = cellsOf(near.spec.picture.split('\n'));
  for (const [x, y] of on.slice(0, -1)) near.down(x, y, 0);
  assert.equal(near.solved(), false);
});

test('engine: a move that makes a line impossible is reported', () => {
  const e = create(pictureToSpec(['#..', '.#.', '..#']));
  assert.equal(e.down(0, 0, 0), true);
  assert.equal(e.badCells().length, 0);
  assert.equal(e.down(1, 0, 0), true);   // two fills in a row whose clue is one 1
  assert.ok(e.badCells().length >= 2, 'both offenders should light up');
});

test('engine: undo and redo move the board back and forward', () => {
  const e = board();
  e.down(0, 0, 0);
  assert.equal(e.canUndo(), true);
  e.undo();
  assert.equal(e.stats().done, 0);
  assert.equal(e.canRedo(), true);
  e.redo();
  assert.equal(e.stats().done, 1);
});

test('engine: hints alone finish every size — the solver is a real solver', () => {
  for (const size of [5, 7, 10, 12]) {
    const e = board(size, `hint-${size}`);
    let guard = 0;
    while (!e.solved() && guard++ < size * size * 3) {
      const h = e.hint();
      if (!h) break;
    }
    assert.equal(e.solved(), true, `hints stalled on ${size}x${size} after ${guard}`);
  }
});

test('engine: a satisfied line crosses out its own leftovers', () => {
  const e = board();
  const { on, off } = cellsOf(e.spec.picture.split('\n'));
  // fill one row completely; every other cell of that row must end up marked out
  const row = Math.min(...on.map(([, y]) => y));
  const inRow = on.filter(([, y]) => y === row);
  const sum = e.spec.rowClues[row].reduce((a, b) => a + b, 0);
  assert.equal(inRow.length, sum);
  for (const [x, y] of inRow) e.down(x, y, 0);
  for (let x = 0; x < 5; x++) {
    if (inRow.some(([ix]) => ix === x)) continue;
    assert.equal(e.cellState(x, row), EMPTY, `(${x},${row}) should have been crossed out`);
  }
  assert.ok(off.length > 0);
});

// 评星用的是引擎自己的两个量，所以它们的关系必须锁住
test('engine: moves counts effort — a clean draw hits par, a correction misses it', () => {
  const e = board(7, 'par-check');
  const { on } = cellsOf(e.spec.picture.split('\n'));
  for (const [x, y] of on.slice(0, -1)) e.down(x, y, 0);
  assert.equal(e.stats().par, on.length);
  assert.equal(e.stats().moves, on.length - 1);

  // 已经判胜的棋盘锁住了输入，所以"涂错再涂对"必须发生在收尾之前
  const [lx, ly] = on[on.length - 1];
  const [wx, wy] = on[0];
  e.down(wx, wy, 0);   // 擦掉：抹掉自己不记数
  assert.equal(e.stats().moves, on.length - 1);
  e.down(wx, wy, 0);   // 重涂：这一下才是浪费
  assert.equal(e.stats().moves, on.length);
  e.down(lx, ly, 0);
  assert.equal(e.solved(), true);
  assert.equal(e.stats().moves, e.stats().par + 1, '一次涂错再涂对 = 比基准多一步');
  assert.equal(e.down(0, 0, 0), false, 'a solved board takes no more input');
});

test('generate 15×15 stays fast enough to run on a phone', () => {
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) generate(`fast-${i}`, 15);
  assert.ok(Date.now() - t0 < 9000, '15x15 generation took over 1.8s/level');
});
