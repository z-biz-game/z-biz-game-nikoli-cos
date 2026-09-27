// 帐篷的四道保险（与数墙同一立场）：
//   1) 出题器只发"一遍传播就能推满全盘"的题面 —— 推得完本身就是唯一性证明，
//      countSolutions 只是给这条证明上的保险丝；两边都过关才端上桌。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现 bruteOk，直接照四条白话规则数一遍，
//      拿它跟引擎的 validate 对拍；谁多认一张盘都当场露馅。
//   3) 引擎是纯状态机 —— 只用公开 API 走子；帐篷收账，副笔的"不放"记号不收账，撤销不退款。
//   4) 配对口径钉死：行线索之和 = 树数 = 帐篷数，"一顶帐侍候两棵树 + 一顶孤帐"这种摆法不算解。

import test from 'node:test';
import assert from 'node:assert/strict';
import tents, {
  generate, create, validate, logicSolve, countSolutions, passesGate, growPairing,
  UNKNOWN, TENT, NO, TREE,
} from '../js/puzzles/tents.js';
import { rngFrom } from '../js/core/rng.js';

const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);
const TIERS = tents.sizes.map((s) => s.key);

// ASCII 手摆盘：'T' 树，'A' 帐篷（只用来造 solution），'.' 草地
function hand(rows, rowClues, colClues) {
  const n = rows.length;
  const trees = new Array(n * n).fill(0);
  const solution = new Array(n * n).fill(NO);
  const list = [];
  rows.forEach((row, y) => {
    assert.equal(row.length, n, `第 ${y} 行宽度不对`);
    [...row].forEach((ch, x) => {
      const i = y * n + x;
      if (ch === 'T') { trees[i] = 1; solution[i] = TREE; }
      else if (ch === 'A') { solution[i] = TENT; list.push([x, y]); }
    });
  });
  return {
    kind: 'tents', n, trees, rowClues, colClues, solution, tents: list,
    par: list.length, count: 0, capped: false, seed: 'hand', tier: '手摆',
  };
}

// 与引擎无关的第二套实现
function bruteOk(spec, grid) {
  const n = spec.n;
  const at = (x, y) => y * n + x;
  const touch8 = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      if (grid[at(a, b)] === TENT) return true;
    }
    return false;
  };
  const tentCells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = grid[at(x, y)];
    if (v === TREE && !spec.trees[at(x, y)]) return false;      // 树坑位置必须与题面一致
    if (spec.trees[at(x, y)] && v !== TREE) return false;
    if (v === TENT) tentCells.push([x, y]);
    if (v !== TENT && v !== NO && v !== TREE) return false;     // 不许留未定格
  }
  for (const [x, y] of tentCells) if (touch8(x, y)) return false;   // 八邻域互斥
  const rows = new Array(n).fill(0), cols = new Array(n).fill(0);
  for (const [x, y] of tentCells) { rows[y]++; cols[x]++; }
  if (rows.join(',') !== spec.rowClues.join(',')) return false;
  if (cols.join(',') !== spec.colClues.join(',')) return false;
  // 每棵树恰有一顶相邻（横竖）的帐篷，每顶帐篷也恰挨着一棵树
  const nb4 = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n);
  for (let i = 0; i < n * n; i++) if (spec.trees[i]) {
    const x = i % n, y = (i - x) / n;
    if (nb4(x, y).filter(([a, b]) => grid[at(a, b)] === TENT).length !== 1) return false;
  }
  for (const [x, y] of tentCells) {
    if (nb4(x, y).filter(([a, b]) => spec.trees[at(a, b)]).length !== 1) return false;
  }
  return true;
}

// 一张最小的手摆真题（4×4）：两棵树两顶帐，行列线索各两个
const HAND_OK = hand(['TA..', '....', '..T.', '..A.'], [1, 0, 0, 1], [0, 1, 1, 0]);
// 两棵树上下并排、行列线索各两个：这一步还有两种搭法（左列两顶或右列两顶），
// 正好拿来验"多解就说多解"与"推不完就别装推完了"
const HAND_TWO = hand(['.T..', '.T..', '....', '....'], [1, 1, 0, 0], [1, 0, 1, 0]);

test('玩法描述齐三件：标题、规则文案、档位表', () => {
  assert.equal(tents.id, 'tents');
  assert.equal(tents.title, '帐篷');
  assert.equal(tents.latin, 'TENTS');
  assert.equal(tents.unit, '顶');
  assert.ok(tents.rules.length >= 4);
  assert.deepEqual(TIERS, [6, 8, 10], '档位表动了：出题预算与移动端布局都按这三档量过');
  assert.deepEqual(tents.sizes.map((s) => s.tier), ['入门', '熟手', '挑战']);
});

test('手摆的 4×4 真题在两层实现里都算合法', () => {
  assert.equal(bruteOk(HAND_OK, HAND_OK.solution), true, 'fixture 自己就不合法');
  assert.equal(validate(HAND_OK, HAND_OK.solution), true, '引擎不认这张真题');
});

test('validate 逐条咬合：帐篷贴角、树没帐、行超数、帐上树坑都算非法', () => {
  const n = HAND_OK.n;
  const withTents = (cells) => {
    const spec = hand(['T...', '....', '..T.', '....'], [1, 0, 0, 1], [0, 1, 0, 1]);
    const g = spec.solution.map((v) => (v === TREE ? TREE : NO));
    for (const [x, y] of cells) g[y * n + x] = TENT;
    return { spec, g };
  };
  const a = withTents([[1, 0], [2, 1]]);          // 两顶帐篷斜角相贴
  assert.equal(bruteOk(a.spec, a.g), false);
  assert.equal(validate(a.spec, a.g), false, '帐篷挨着斜角还判合法');
  const b = withTents([[1, 0], [3, 3]]);          // 第二顶离任何树都远
  assert.equal(bruteOk(b.spec, b.g), false);
  assert.equal(validate(b.spec, b.g), false, '孤帐（不挨任何树）还判合法');
  const c = withTents([[1, 0], [1, 1]]);          // 树 (0,0) 被两顶帐同时认领
  assert.equal(bruteOk(c.spec, c.g), false);
  assert.equal(validate(c.spec, c.g), false, '一树两帐还判合法');
  const d = hand(['TA..', '....', '..T.', '....'], [2, 0, 0, 1], [0, 1, 0, 1]);
  assert.equal(validate(d, d.solution), false, '行线索写着 2 却只有一顶，竟算对');
  const e = hand(['AA..', '....', '..T.', '..A.'], [1, 0, 0, 2], [1, 0, 0, 1]);
  assert.equal(bruteOk(e, e.solution), false);
  assert.equal(validate(e, e.solution), false, '帐篷搭进树坑还判合法');
});

test('两层实现对拍：生成盘 + 挖一格反例，判到合法的必须是同一批', () => {
  let agree = 0;
  for (const key of TIERS) {
    for (const seed of SEEDS(`cross${key}`, 6)) {
      const spec = generate(seed, key);
      const g = Uint8Array.from(spec.solution);
      assert.equal(validate(spec, g), bruteOk(spec, g), `${seed} 两层判得不一致（原盘）`);
      assert.equal(bruteOk(spec, g), true, `${seed} 出题器发的盘不合法`);
      agree++;
      // 把一顶帐篷挪到隔壁草地：至少一套实现得说不合法
      const [tx, ty] = spec.tents[0];
      const moved = Uint8Array.from(g);
      moved[ty * spec.n + tx] = NO;
      moved[ty * spec.n + ((tx + 1) % spec.n)] = TENT;
      assert.equal(bruteOk(spec, moved), false, `${seed} 挪了帐篷独立实现还在点头`);
      assert.equal(validate(spec, moved), false, `${seed} 挪了帐篷引擎还在点头`);
      agree++;
    }
  }
  assert.equal(agree, 12 * TIERS.length);
});

test('countSolutions 老实：两种搭法就数出两种，没数完不许当唯一', () => {
  const two = countSolutions(HAND_TWO, 2, null, 200000);
  assert.equal(two.capped, false, '4×4 都数不完？');
  assert.equal(two.count, 2, `这张盘明摆着两种搭法，数出 ${two.count}`);
  const one = countSolutions(HAND_OK, 2, null, 200000);
  assert.equal(one.count, 1, `手摆真题本该只有一种搭法，数出 ${one.count}`);
  assert.equal(one.capped, false);
  // "没数完"要拿真得分支的盘验：只给一个节点时必须老实报 capped，
  // 而且 capped 不等于"没有解"—— 这张盘其实有两种搭法。
  const starved = countSolutions(HAND_TWO, 2, null, 1);
  assert.equal(starved.capped, true, '只给一个节点却不肯承认没数完');
  assert.notEqual(starved.count, 1, '没数完却敢报"唯一解"');
  // 反过来：一遍传播就推满全盘的题，数解只花一个节点 —— 生成器发的题全是这种
  const quick = countSolutions(generate('starve:0', 10), 2, null, 4);
  assert.equal(quick.nodes, 1, '推得完的盘不该再分支');
  assert.equal(quick.count, 1);
  assert.equal(quick.capped, false);
  // 行线索改成谁都不可能满足的数：0 解，而且不算 capped
  const dead = hand(['TA..', '....', '..T.', '..A.'], [9, 0, 0, 1], [0, 1, 0, 1]);
  const r = countSolutions(dead, 2, null, 200000);
  assert.equal(r.count, 0, '行线索 9 还数得出解？');
  assert.equal(r.capped, false);
});

test('logicSolve 从空盘推满全盘才算证明，推不完要如实报 open', () => {
  const hit = logicSolve(HAND_OK);
  assert.equal(hit.contradiction, false);
  assert.equal(hit.solved, true, '这张小题面推不完，说明传播规则没写全');
  for (let i = 0; i < HAND_OK.n * HAND_OK.n; i++) {
    if (HAND_OK.trees[i]) continue;
    assert.equal(hit.grid[i], HAND_OK.solution[i], `第 ${i} 格推出来的与答案不符`);
  }
  const wide = logicSolve(HAND_TWO);
  assert.equal(wide.solved, false, '两种搭法的盘被"一遍推完"了 —— 那证明是假的');
  assert.ok(wide.open > 0);
  // 自相矛盾的题面要当场报 contradiction
  const bad = hand(['TA..', '....', '..T.', '..A.'], [0, 0, 0, 1], [0, 1, 0, 1]);
  assert.equal(logicSolve(bad).contradiction, true, '行线索写着 0 却有帐篷，传播居然没喊矛盾');
});

for (const key of TIERS) test(`生成器发的每道题都推得完、数得唯一（${key}×${key}，40 颗种子）`, () => {
  const faces = new Set();
  for (const seed of SEEDS(`gen${key}`, 40)) {
    const spec = generate(seed, key);
    assert.equal(spec.n, key);
    assert.equal(spec.kind, 'tents');
    faces.add(spec.trees.join('') + '|' + spec.rowClues.join(',') + '|' + spec.colClues.join(','));
    assert.equal(validate(spec, spec.solution), true, `${seed} 题面与答案不自洽`);
    assert.equal(bruteOk(spec, Uint8Array.from(spec.solution)), true, `${seed} 独立实现不认这张答案`);
    assert.equal(passesGate(spec), true, `${seed} 一遍传播推不满全盘，这题不该发`);
    const audit = countSolutions(spec, 2, null, 200000);
    assert.equal(audit.count, 1, `${seed} 数出 ${audit.count} 个解`);
    assert.equal(audit.capped, false, `${seed} 没数完就发了题`);
    assert.equal(spec.count, 1, `${seed} 没把审计结果标进 spec`);
    assert.equal(spec.capped, false);
    // 配对不变量：行和 == 列和 == 树数 == 帐篷数 == par
    const trees = spec.trees.reduce((a, b) => a + b, 0);
    assert.equal(spec.rowClues.reduce((a, b) => a + b, 0), trees, '行线索之和不等于树数');
    assert.equal(spec.colClues.reduce((a, b) => a + b, 0), trees, '列线索之和不等于树数');
    assert.equal(spec.tents.length, trees);
    assert.equal(spec.par, trees);
  }
  assert.equal(faces.size, 40, `${key}×${key} 四十颗种子只交出 ${faces.size} 道题`);
});

test('配对生长器只会长出合法配对，且随种子换开', () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) {
    const made = growPairing(6, rngFrom(`grow:${k}`), { want: [6, 8], min: 5 });
    if (!made) continue;
    const n = 6;
    const g = new Array(n * n).fill(NO);
    for (let i = 0; i < n * n; i++) if (made.trees[i]) g[i] = TREE;
    for (let i = 0; i < n * n; i++) if (made.tents[i]) g[i] = TENT;
    const rowC = new Array(n).fill(0), colC = new Array(n).fill(0);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y * n + x] === TENT) { rowC[y]++; colC[x]++; }
    const shell = { kind: 'tents', n, trees: Array.from(made.trees), rowClues: rowC, colClues: colC, solution: g, tents: [], par: 0 };
    assert.equal(bruteOk(shell, g), true, `种子 ${k} 长出的配对本身就不合法`);
    seen.add(g.join(''));
  }
  assert.ok(seen.size >= 30, `四十次生长只长出 ${seen.size} 种配对`);
});

test('同一颗种子在任何设备上得到同一道题，spec 过一遍 JSON 也不变味', () => {
  for (const key of TIERS) {
    const a = generate('daily:2026-09-27|tents', key);
    const b = generate('daily:2026-09-27|tents', key);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
    const copy = JSON.parse(JSON.stringify(a));
    const e = create(copy);
    assert.equal(e.stats().par, a.par);
    for (const [x, y] of copy.tents) { e.down(x, y, 0); e.up(); }
    assert.equal(e.solved(), true, 'JSON 往返之后就通不了关');
  }
});

test('引擎开局：树坑不给落子，进度按帐篷数走', () => {
  const spec = generate('start:0', 6);
  const n = spec.n;
  const e = create(spec);
  assert.equal(e.board.cols, n);
  assert.equal(e.board.rows, n);
  const ti = spec.trees.findIndex((t) => t);
  const tx = ti % n, ty = (ti - tx) / n;
  assert.equal(e.isTree(tx, ty), true);
  assert.equal(e.cellState(tx, ty), TREE, '树坑的格子状态该直接报树');
  assert.equal(e.down(tx, ty, 0), false, '树坑里竟然能搭帐篷');
  assert.equal(e.down(tx, ty, 1), false, '树坑里竟然能打"不放"记号');
  assert.deepEqual(e.stats(), { moves: 0, par: spec.par, done: 0, total: spec.par });
  assert.equal(e.solved(), false);
});

test('帐篷收账、"不放"记号不收账，撤销与重做都不退款', () => {
  const spec = generate('moves:0', 6);
  const n = spec.n;
  const at = (i) => [i % n, (i - i % n) / n];
  const grass = spec.solution.map((v, i) => (v === NO ? i : -1)).filter((i) => i >= 0);
  const e = create(spec);
  const [t0x, t0y] = spec.tents[0];
  assert.equal(e.down(t0x, t0y, 0), true);
  e.up();
  assert.deepEqual(e.stats(), { moves: 1, par: spec.par, done: 1, total: spec.par });
  assert.equal(e.down(t0x, t0y, 0), true);                 // 再点一下 = 拆掉
  e.up();
  assert.equal(e.cellState(t0x, t0y), UNKNOWN);
  assert.equal(e.stats().moves, 1, '拆帐篷是反悔，不许再收一笔');
  assert.equal(e.stats().done, 0);
  const [gx, gy] = at(grass[grass.length - 1]);            // 最后一格草地：肯定不是帐篷位
  assert.equal(e.down(gx, gy, 1), true);
  e.up();
  assert.equal(e.cellState(gx, gy), NO, '副笔该把格子记成"不放帐篷"');
  assert.equal(e.stats().moves, 1, '记号不是落子，不许收账');
  assert.equal(e.down(gx, gy, 1), true);                   // 再点一下擦掉记号
  e.up();
  assert.equal(e.cellState(gx, gy), UNKNOWN);
  assert.equal(e.stats().moves, 1);
  assert.equal(e.undo(), true);
  assert.equal(e.stats().moves, 1, '撤销退回盘面，账却已经付过');
  assert.equal(e.redo(), true);
  assert.equal(e.stats().moves, 1, '重做不许另收一笔');
});

test('拖动一路搭帐，每顶恰好一笔账；途中不替玩家拆帐', () => {
  const spec = generate('drag:0', 8);
  const e = create(spec);
  const picks = spec.tents.slice(0, 3);
  e.down(...picks[0], 0);
  for (const [x, y] of picks.slice(1)) assert.equal(e.move(x, y), true);
  e.up();
  // 拖动是"沿线一路搭帐"，路上每一格都收一笔：账要等于盘上真的搭起来的帐篷数
  let painted = 0;
  for (let y = 0; y < spec.n; y++) for (let x = 0; x < spec.n; x++) if (e.cellState(x, y) === TENT) painted++;
  assert.equal(e.stats().moves, painted, `搭了 ${painted} 顶却收 ${e.stats().moves} 笔`);
  assert.ok(painted >= picks.length);
  for (const [x, y] of picks) assert.equal(e.cellState(x, y), TENT);
  // 已经搭了帐的格子，拖动经过时不该被拆掉
  assert.equal(e.move(...picks[0]), false, '拖动把已搭好的帐篷拆了');
  assert.equal(e.cellState(...picks[0]), TENT);
});

test('照着答案搭满才算赢；缺一顶、多一顶、贴角都不算，赢了就锁盘', () => {
  const spec = generate('win:0', 6);
  const e = create(spec);
  for (const [x, y] of spec.tents) { e.down(x, y, 0); e.up(); }
  assert.equal(e.solved(), true);
  assert.deepEqual(e.stats(), { moves: spec.par, par: spec.par, done: spec.par, total: spec.par });
  assert.equal(e.down(spec.tents[0][0], spec.tents[0][1], 0), false, '赢了还能改盘');
  assert.equal(e.move(0, 0), false);
  assert.equal(e.hint(), null, '通关之后不许再给提示');
  // 少一顶
  const f = create(spec);
  for (const [x, y] of spec.tents.slice(1)) { f.down(x, y, 0); f.up(); }
  assert.equal(f.solved(), false, '还差一顶就判胜');
  // 多一顶（往任意草地加一顶，行列线索立刻超）
  const n = spec.n;
  const free = spec.solution.map((v, i) => (v === NO ? i : -1)).filter((i) => i >= 0)[0];
  f.down(free % n, (free - free % n) / n, 0); f.up();
  assert.equal(f.solved(), false, '多搭一顶还凑得出正确答案？');
});

test('badCells 只冤枉真矛盾的格子', () => {
  const spec = generate('bad:0', 8);
  const n = spec.n;
  const keys = (list) => list.map(([x, y]) => y * n + x).sort((a, b) => a - b).join(',');
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '空盘不许报任何格子');
  const [ax, ay] = spec.tents[0];
  e.down(ax, ay, 0); e.up();
  assert.deepEqual(e.badCells(), [], '正解里的一顶帐篷不该被冤枉');
  // 在答案帐篷的斜角再搭一顶：两顶都该红
  const bx = ax + 1, by = ay + 1;
  if (bx < n && by < n && spec.solution[by * n + bx] === NO) {
    e.down(bx, by, 0); e.up();
    const flagged = keys(e.badCells()).split(',');
    assert.ok(flagged.includes(String(by * n + bx)), '两顶帐篷贴了角却没人报警');
  }
  // 把整盘按答案搭满：一路都不许红
  const f = create(spec);
  for (const [x, y] of spec.tents) { f.down(x, y, 0); f.up(); }
  assert.deepEqual(f.badCells(), [], '正解落盘却被报错');
});

test('提示一格一格推得动，一路点下去能点到通关', () => {
  for (const key of [6, 8]) {
    const spec = generate(`hint:${key}`, key);
    const n = spec.n;
    const e = create(spec);
    let guard = 0;
    while (!e.solved() && guard++ < 400) {
      const before = e.stats().done;
      const h = e.hint();
      assert.ok(h, `第 ${guard} 次提示撒手，盘却还没解完`);
      assert.ok(h.cells.length >= 1 && typeof h.note === 'string');
      assert.ok(e.stats().done > before || h.cells.every(([x, y]) => e.cellState(x, y) === NO),
        `hint 落下去盘面没动 ${JSON.stringify(h.cells)}`);
      for (const [x, y] of h.cells) {
        const v = e.cellState(x, y);
        assert.ok(v === spec.solution[y * n + x] || v === NO,
          `hint 落下的格子与唯一解不符：${x},${y} 落成 ${v}，答案是 ${spec.solution[y * n + x]}`);
      }
    }
    assert.ok(guard < 400, `点了 ${guard} 次还没通关`);
    assert.equal(e.solved(), true);
  }
});

test('提示不许一次点完全盘，也不许倒退款', () => {
  const spec = generate('hint-one:0', 8);
  const e = create(spec);
  const h = e.hint();
  assert.ok(h);
  assert.ok(h.cells.length < spec.par, '一次提示就把全盘的帐都搭完，玩家还玩什么');
  const dots = e.stats().moves;
  e.hint();
  assert.ok(e.stats().moves >= dots);
});

test('引擎不碰时钟也不碰随机数：模块里不许出现 Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/tents.js', import.meta.url), 'utf8'));
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
  const v = { cell: 40, ox: 20, oy: 20, cols: spec.n, rows: spec.n, w: 420, h: 420, dpr: 2, hover: { x: 1, y: 1 }, bad: [], reduce: false };
  for (const [x, y] of spec.tents) { e.down(x, y, 0); e.up(); }
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20, '一帧什么都没画');
  if (e.celebrate) e.celebrate(ctx, v, 1000, 0.5);
});

test('出题在手机上不卡：每档十道题各有预算', () => {
  // 绝对毫秒不是算法量：本机、能效核、CI 那台 4 核（并发 10 个测试文件）实测差到 30 倍。
  // 这条只当"算法塌成指数"的保险丝，可证的手感上界在各档 audit/tries 里。
  const BUDGET = { 6: 4000, 8: 6000, 10: 9000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`t${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < BUDGET[key], `${key}×${key} 十道题花了 ${ms}ms，超过 ${BUDGET[key]}ms`);
  }
});
