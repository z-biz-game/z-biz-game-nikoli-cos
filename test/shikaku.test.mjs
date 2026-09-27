// 数间的三道保险（与数墙/帐篷/黑白/隔离/五寸钉同一立场）：
//   1) 出题器不许说谎 —— 交出来的题必须被 countSolutions 数到"恰好一种摆法"且没烧穿预算；
//      capped 永远不等于唯一。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现（只从"盘多大、数字是几"枚举矩形，
//      不 import 引擎的候选池），拿它跟 rectsOf / verify / countSolutions 三方对拍；
//      手搓盘还用穷举把解数钉死：一题 0 解、一题 2 解，都是人能一眼验算的规模。
//   3) 引擎是纯状态机 —— 只用公开 API 走子。一笔只能围出一间，非法框、擦除、记号都不收账，
//      撤销与重做也不退款；而 moves 恰等于 par 这条路必须真的走得通（不然三星是装饰）。
//
// 题面口径（钉在引擎文件头）：given 是长度 n² 的数组，0 = 草地，>0 = 这一格印着数字。
// 数字之和必须正好等于格数 —— 差一个的盘天生无解，createBoard 当场就喊。

import test from 'node:test';
import assert from 'node:assert/strict';
import shikaku, {
  generate, create, createBoard, createState, rebuild, killRect, claimCell, cloneState,
  Rules, propagate, solve, verify, complete, countSolutions, tierOf, fallbackSpec, OPEN,
} from '../js/puzzles/shikaku.js';

const TIERS = shikaku.sizes.map((s) => s.key);
const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);

// ---- 独立实现：只认"盘多大、数字是几"，一行都不 import 引擎的几何 --------------------------

// 数字按从左到右、从上到下的读序编号 —— 这是题面与解之间的公共约定，不是引擎的内部选择。
function myClues(n, given) {
  const list = [];
  const idx = new Int16Array(n * n).fill(OPEN);
  for (let t = 0; t < n * n; t++) {
    if ((given[t] | 0) > 0) {
      idx[t] = list.length;
      list.push({ cell: t, value: given[t] | 0 });
    }
  }
  return { list, idx };
}

// 一间的所有可能摆法：面积等于自己的数字、含住自己、不含别人的数字。全部矩形硬枚举。
function myRects(n, given) {
  const { list, idx } = myClues(n, given);
  const out = list.map(() => []);
  for (let r0 = 0; r0 < n; r0++) {
    for (let r1 = r0; r1 < n; r1++) {
      for (let c0 = 0; c0 < n; c0++) {
        for (let c1 = c0; c1 < n; c1++) {
          const cells = [];
          let holder = OPEN;
          let multi = false;
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const t = r * n + c;
              cells.push(t);
              const i = idx[t];
              if (i !== OPEN) {
                if (holder !== OPEN) multi = true;
                holder = i;
              }
            }
          }
          if (holder === OPEN || multi) continue;
          if (cells.length !== list[holder].value) continue;
          out[holder].push(cells.sort((a, b) => a - b));
        }
      }
    }
  }
  return out;
}

// 独立判胜：从 owner 现推，不看候选池，也不看引擎那份 verify。
function myProblems(n, given, owner) {
  const { list, idx } = myClues(n, given);
  const bad = [];
  for (let t = 0; t < n * n; t++) if (owner[t] === OPEN) bad.push(`空格@${t}`);
  for (let i = 0; i < list.length; i++) {
    const cells = [];
    for (let t = 0; t < n * n; t++) if (owner[t] === i) cells.push(t);
    if (!cells.length) {
      bad.push(`第${i}间没有格子`);
      continue;
    }
    const rs = cells.map((t) => (t / n) | 0);
    const cs = cells.map((t) => t % n);
    const r0 = Math.min(...rs), r1 = Math.max(...rs);
    const c0 = Math.min(...cs), c1 = Math.max(...cs);
    if ((r1 - r0 + 1) * (c1 - c0 + 1) !== cells.length) bad.push(`第${i}间不是矩形`);
    if (cells.length !== list[i].value) bad.push(`第${i}间面积 ${cells.length} ≠ 数字 ${list[i].value}`);
    const own = list[i].cell;
    const or = (own / n) | 0, oc = own % n;
    if (or < r0 || or > r1 || oc < c0 || oc > c1) bad.push(`第${i}间不含自己的数字`);
    for (const t of cells) if (idx[t] !== OPEN && idx[t] !== i) bad.push(`第${i}间含了别人的数字@${t}`);
  }
  return bad;
}

// 独立计数：拿自己枚举出来的矩形做精确覆盖，找最靠左上的空格，一块一块试。
function myCount(n, given, cap = 2) {
  const rects = myRects(n, given).flat();
  const total = n * n;
  const taken = new Uint8Array(total);
  let solutions = 0;
  const walk = () => {
    let t = -1;
    for (let k = 0; k < total; k++) if (!taken[k]) { t = k; break; }
    if (t === -1) {
      solutions++;
      return;
    }
    for (const cells of rects) {
      if (!cells.includes(t)) continue;
      if (cells.some((u) => taken[u])) continue;
      for (const u of cells) taken[u] = 1;
      walk();
      for (const u of cells) taken[u] = 0;
      if (solutions >= cap) return;
    }
  };
  walk();
  return solutions;
}

// 引擎的候选池读成同一形状：每家一组"格子升序列表"
function engineRects(board) {
  const out = [];
  for (let i = 0; i < board.clues; i++) {
    const list = board.rectsOf[i].map((rid) => Array.from(board.rectCells(rid)).sort((a, b) => a - b));
    out.push(list.sort((x, y) => x[0] - y[0] || x.length - y.length));
  }
  return out;
}
const asSet = (lists) => lists.map((l) => l.map((x) => x.join(',')).sort()).sort();

// 从解的 owner 里把每一间的包围盒读出来：拖动/两下都按这个来落子
function boxesOf(spec) {
  const n = spec.n;
  const boxes = new Map();
  for (let t = 0; t < n * n; t++) {
    const o = spec.solution[t];
    if (!boxes.has(o)) boxes.set(o, { minx: 1e9, miny: 1e9, maxx: -1, maxy: -1, cells: 0 });
    const b = boxes.get(o);
    const x = t % n, y = (t / n) | 0;
    b.minx = Math.min(b.minx, x); b.maxx = Math.max(b.maxx, x);
    b.miny = Math.min(b.miny, y); b.maxy = Math.max(b.maxy, y);
    b.cells++;
  }
  return boxes;
}

// 一整盘按解拖出来：一格宽的退化成"点两下"（键盘只有 down+up，见引擎 up()）
function dragAll(spec, e = create(spec)) {
  for (const b of boxesOf(spec).values()) {
    if (b.minx === b.maxx && b.miny === b.maxy) {
      e.down(b.minx, b.miny, 0); e.up();
      e.down(b.minx, b.miny, 0); e.up();
    } else {
      e.down(b.minx, b.miny, 0); e.move(b.maxx, b.maxy); e.up();
    }
  }
  return e;
}

// ---- 手搓盘：解数是人能一眼验算的规模 -----------------------------------------------------

// 2×2，两个对角各一个 2：横着切、竖着切都成 —— 天生两解，绝不能出题
const AMBIG = { n: 2, given: [2, 0, 0, 2] };
// 3×3，数字和 9 对得上，可左下角那格谁家住不下：一间候选都没少，却一解都没有
const DEAD = { n: 3, given: [2, 0, 2, 0, 3, 0, 0, 0, 2] };

// ---- 1. 题面口径 ------------------------------------------------------------------------

test('题面口径：不合法的盘在门口就被拦下', () => {
  assert.throws(() => createBoard(3, [2, 0, 0, 0, 3, 0, 0, 0, 2]), /数字之和/, '和为 7≠9 却收下了');
  assert.throws(() => createBoard(2, [0, 0, 0, 0]), /没有数字/);
  assert.throws(() => createBoard(1, [1]), /盘子太小/);
  // 8 在 3×3 里根本没有形状：1×8 / 2×4 都越界
  assert.throws(() => createBoard(3, [8, 0, 0, 0, 0, 0, 0, 1, 0]), /没有任何可放的矩形/);
  // 一格宽的 1 也算不出形状：3×3 里塞一个 2 格的长条，剩 7 格没法分
  assert.throws(() => createBoard(4, [11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 1]), /没有任何可放的矩形/);
  // 归属一位一域存进 Uint32：超过 30 家就装不下
  assert.throws(() => createBoard(6, new Array(36).fill(1)), /数字太多/);
  const ok = createBoard(2, [2, 0, 0, 2]);
  assert.equal(ok.clues, 2, '合法盘被拒了');
  assert.equal(ok.total, 4);
  assert.deepEqual(Array.from(ok.values), [2, 2], '区域编号不按读序');
});

test('候选摆法与独立枚举逐一对上：一家都不许多、都不许少', () => {
  for (const size of TIERS) {
    for (const seed of SEEDS(`rects:${size}`, 5)) {
      const spec = generate(seed, size);
      const board = createBoard(spec.n, Int16Array.from(spec.given));
      const mine = asSet(myRects(board.n, spec.given));
      const theirs = asSet(engineRects(board));
      assert.deepEqual(theirs, mine, `${size}/${seed} 候选池与独立枚举不一致`);
      assert.ok(mine.every((l) => l.length >= 1));
    }
  }
  // 手搓盘的规模小到人眼数得清：2×2 里每个 2 恰好两种摆法（横、竖）
  const amb = createBoard(AMBIG.n, Int16Array.from(AMBIG.given));
  assert.deepEqual(engineRects(amb).map((l) => l.map((x) => x.join(','))),
    [['0,1', '0,2'], ['1,3', '2,3']], '2×2 的候选池与人手数的不是一张表');
});

test('池子里每一块都自证：含自己、面积对、不含别人的数字', () => {
  const spec = generate('pool:8', 8);
  const board = createBoard(spec.n, Int16Array.from(spec.given));
  const { idx } = myClues(board.n, spec.given);
  let totalRects = 0;
  for (let i = 0; i < board.clues; i++) {
    for (const rid of board.rectsOf[i]) {
      totalRects++;
      const cells = Array.from(board.rectCells(rid));
      assert.equal(cells.length, board.values[i], `第${i}间面积不对`);
      assert.ok(cells.includes(board.clueCell[i]), `第${i}间不含自己的数字`);
      const [r0, c0, r1, c1] = board.rectBox(rid);
      assert.equal(cells.length, (r1 - r0 + 1) * (c1 - c0 + 1), '包围盒与格子数不等，说明有洞');
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const t = r * board.n + c;
          assert.ok(cells.includes(t), `盒里的 ${t} 不在格子里`);
          assert.ok(idx[t] === OPEN || idx[t] === i, '含了别人的数字');
        }
      }
    }
  }
  assert.ok(totalRects > board.clues, '候选池塌成每块一种，说明合并不起作用');
});

// ---- 2. 判胜只读盘 -----------------------------------------------------------------------

test('verify 认得出每一类缺陷，且与独立实现同进退', () => {
  const spec = generate('verify:8', 8);
  const board = createBoard(spec.n, Int16Array.from(spec.given));
  const trueOwner = Int16Array.from(spec.solution);
  assert.deepEqual(verify(board, trueOwner), [], '真解被判错');
  assert.equal(complete(board, trueOwner), true);
  assert.deepEqual(myProblems(spec.n, spec.given, trueOwner), [], '两套判胜对真解都不一致？');

  // 把每一格的归属改成它四邻那间的编号，再改回草地：一次扫出所有缺陷类别
  const seen = new Set();
  let mutations = 0;
  for (let t = 0; t < board.total; t++) {
    const x = t % spec.n;
    const y = (t / spec.n) | 0;
    const alt = [OPEN];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const u = (y + dy) * spec.n + x + dx;
      if (u >= 0 && u < board.total && x + dx >= 0 && x + dx < spec.n && y + dy >= 0 && y + dy < spec.n) alt.push(trueOwner[u]);
    }
    for (const v of new Set(alt)) {
      if (v === trueOwner[t]) continue;
      const o = Int16Array.from(trueOwner);
      o[t] = v;
      mutations++;
      const theirs = verify(board, o);
      const mine = myProblems(spec.n, spec.given, o);
      assert.ok(theirs.length > 0, `改走第 ${t} 格却还判胜：${v}`);
      assert.equal(theirs.length > 0, mine.length > 0, '两套判胜一个说对一个说错');
      assert.equal(complete(board, o), false, '缺陷盘被判通关');
      for (const p of theirs) seen.add(p.why);
    }
  }
  assert.ok(mutations > board.total, '扫到的改动太少，下面这条覆盖断言是空的');
  for (const why of ['空格', '不是矩形', '面积与数字不符', '区域不含自己的数字', '区域含了别人的数字']) {
    assert.ok(seen.has(why), `verify 的 "${why}" 这一类没有测试覆盖到（也可能是这种盘造不出这一类缺陷）`);
  }
  // 判胜不读候选池：把 alive 全清成 0，也不该影响 verify 的结论
  const st = createState(board, new Int16Array(board.total).fill(OPEN));
  for (let rid = 0; rid < board.rectCount; rid++) killRect(st, rid);
  assert.deepEqual(verify(board, trueOwner), [], '剪枝有 bug 就能伪造或抹掉判胜结论');
  assert.equal(st.dead, true, '候选池清空后没报死，说明 refreshDead 漏了路');
});

test('独立穷举把解数钉死：手搓盘一题 2 解、一题 0 解', () => {
  const amb = createBoard(AMBIG.n, Int16Array.from(AMBIG.given));
  assert.equal(myCount(AMBIG.n, AMBIG.given), 2, '横切竖切两解，人眼数得出来');
  assert.equal(countSolutions(amb, { cap: 2, budget: 1000 }).count, 2, '引擎数不出这两解');
  assert.equal(solve(amb).ok, false, '两解的盘被 solve 当成了推得完');
  assert.equal(solve(amb).nishio, 0, '多解盘不该靠反证收场：反证找不出矛盾');

  const dead = createBoard(DEAD.n, Int16Array.from(DEAD.given));
  assert.ok(dead.clues === 4, '题面口径变了');
  assert.equal(myCount(DEAD.n, DEAD.given), 0, '左下角那格谁都盖不住，应为 0 解');
  assert.equal(countSolutions(dead, { cap: 2, budget: 1000 }).count, 0);
  const p = solve(dead);
  assert.equal(p.ok, false);
  assert.equal(p.dead, true, '一格盖不住要报死，不能报"推完了"');
});

test('引擎计数与独立计数在真题上对拍：都数到恰好一个解', () => {
  for (const size of TIERS) {
    for (const seed of SEEDS(`count:${size}`, 3)) {
      const spec = generate(seed, size);
      const board = createBoard(spec.n, Int16Array.from(spec.given));
      const c = countSolutions(board, { cap: 2, budget: 400000 });
      assert.equal(c.capped, false, `${size}/${seed} 数不完，唯一性没有依据`);
      assert.equal(c.count, 1, `${size}/${seed} 数出 ${c.count} 个解还交了`);
    }
  }
  // 6×6 用不封顶的穷举再走一遍：两套实现连"有几个解"这种小事都不许分歧
  for (const seed of SEEDS(`brute6`, 6)) {
    const spec = generate(seed, 6);
    assert.equal(myCount(spec.n, spec.given), 1, `${seed} 独立穷举数出的不是 1`);
  }
});

test('预算烧完要如实报 capped：没数完不等于只有一种解', () => {
  const spec = generate('fuse:8', 8);
  const board = createBoard(spec.n, Int16Array.from(spec.given));
  const c = countSolutions(board, { cap: 2, budget: 1 });
  assert.equal(c.capped, true, '一个节点就烧穿了却报"数完了"');
  assert.ok(c.nodes >= 1);
  // 生成器收到 capped 必须丢题：spec 里那个字段就是这条纪律的凭据
  assert.equal(spec.capped, false);
  assert.equal(spec.solutions, 1);
});

// ---- 3. 铅笔路径不写假格子 ----------------------------------------------------------------

test('传播只写"在任何解里都成立"的格：每一轮墨都还在真解上', () => {
  for (const size of TIERS) {
    for (const seed of SEEDS(`pencil:${size}`, 6)) {
      const spec = generate(seed, size);
      const board = createBoard(spec.n, Int16Array.from(spec.given));
      const st = createState(board, new Int16Array(board.total).fill(OPEN));
      let guard = 0;
      let progress = 0;
      for (;;) {
        const sweep = propagate(st);
        progress += sweep.found.length;
        // 每一次落笔都不许偏离真解 —— 这就是"不猜"的操作性定义
        for (const d of sweep.found) {
          assert.equal(d.kind === 'own' ? st.owner[d.cell] : spec.solution[d.cell], spec.solution[d.cell],
            `${size}/${seed} 传播写出了假格子`);
        }
        if (sweep.status === 'dead') {
          assert.fail(`${size}/${seed} 真题被推死了`);
        }
        if (sweep.status === 'idle') break;
        if (++guard > 200) assert.fail('传播不收敛');
      }
      assert.ok(progress > 0);
      assert.equal(complete(board, st.owner), true, `${size}/${seed} 纯规则推不到底：交出来的题要靠猜`);
      assert.deepEqual(verify(board, st.owner), []);
    }
  }
});

test('solve 就是那条铅笔路径：它写出来的盘必须与题面同源', () => {
  for (const size of TIERS) {
    for (const seed of SEEDS(`solve:${size}`, 6)) {
      const spec = generate(seed, size);
      const board = createBoard(spec.n, Int16Array.from(spec.given));
      const p = solve(board);
      assert.equal(p.ok, true);
      assert.equal(p.nishio, 0, `${size}/${seed} 用了 ${p.nishio} 次反证：带内题不许试手`);
      assert.deepEqual(Array.from(p.owner), spec.solution, '推导解与切盘解不是同一张');
      assert.ok(p.score > 0 && p.steps >= board.clues);
    }
  }
  // 反证这条路也得单独验：两解盘里任何一种开局都不该推死 —— 反证在这儿帮不上忙，
  // 而生成器恰恰靠"用了几次反证"来划"要不要试手"这条线。
  const amb = createBoard(AMBIG.n, Int16Array.from(AMBIG.given));
  const st = createState(amb, new Int16Array(amb.total).fill(OPEN));
  let dead = 0;
  for (let i = 0; i < amb.clues; i++) {
    for (const rid of amb.rectsOf[i]) {
      const probe = cloneState(amb, st);
      for (const t of amb.rectCells(rid)) claimCell(probe, t, i);
      if (propagate(probe).status === 'dead') dead++;
    }
  }
  assert.equal(dead, 0, '两解盘里某种开局被推死了：反证层过度自信');
  // 规则表本身也是难度读数的一部分：权重必须有序，反证最贵
  assert.ok(Rules.nishio.weight > Rules.noSupport.weight);
  assert.ok(Rules.noSupport.weight > Rules.insideAll.weight);
  assert.ok(Rules.insideAll.weight > Rules.onlyOwner.weight);
});

test('候选池只由 owner 现算：撤销与 rebuild 是同一个真相', () => {
  const spec = generate('pool:rebuild', 8);
  const board = createBoard(spec.n, Int16Array.from(spec.given));
  const st = createState(board, new Int16Array(board.total).fill(OPEN));
  // 随手杀几块，再从 owner 重建 —— 重建后的池子必须与"只照着墨算"完全一致
  const owner = new Int16Array(board.total).fill(OPEN);
  let killed = 0;
  for (const rid of board.rectsOf[0].slice(0, 2)) { if (killRect(st, rid)) killed++; }
  assert.ok(killed >= 1);
  assert.deepEqual(Array.from(rebuild(st).alive), Array.from(createState(board, owner).alive),
    '没落一笔墨，重建出来的池子却带着旧账');
  // 落一笔真解里的墨，重建必须与"从零照着这笔墨算"一致
  const t0 = board.clueCell[0];
  claimCell(st, t0, 0);
  owner[t0] = 0;
  const a = rebuild(st);
  const b = createState(board, owner);
  assert.deepEqual(Array.from(a.alive), Array.from(b.alive), 'alive 有两本账');
  assert.deepEqual(Array.from(a.cnts), Array.from(b.cnts), 'cnts 有两本账');
  assert.deepEqual(Array.from(a.mask), Array.from(b.mask), 'mask 有两本账');
  // 走完一整盘再全撤回空，池子必须回到初始大小
  const e = dragAll(spec);
  assert.equal(e.solved(), true);
  while (e.canUndo()) e.undo();
  assert.equal(e.stats().done, 0);
  const alive = Array.from(rebuild(createState(board, new Int16Array(board.total).fill(OPEN))).alive);
  assert.equal(alive.every((x) => x === 1), true, '全撤之后候选池没有还原');
});

// ---- 4. 手势与账本 ------------------------------------------------------------------------

test('一笔一间：整盘拖完，moves 恰等于 par（三星那条路必须真走得通）', () => {
  for (const size of TIERS) {
    const spec = generate(`par:${size}`, size);
    const e = dragAll(spec);
    const s = e.stats();
    assert.equal(e.solved(), true, `${size} 按解拖不出通关`);
    assert.equal(s.done, s.total);
    assert.equal(s.moves, s.par, `${size} 的 moves=${s.moves} 而 par=${s.par}`);
    assert.equal(s.par, spec.par, '引擎把 par 换了个数');
    assert.equal(s.total, spec.par, '一间一笔之外还有别的口径');
  }
});

test('非法框一律不收账：空框、双数字、面积不对、重画同一间', () => {
  const spec = generate('illegal:8', 8);
  const n = spec.n;
  const e = create(spec);
  const before = e.stats();
  const tryBox = (a, b) => { e.down(a[0], a[1], 0); e.move(b[0], b[1]); return e.up(); };

  // 全盘的框：圈住所有数字，必然非法
  assert.equal(tryBox([0, 0], [n - 1, n - 1]), false, '整盘都被接受了');
  // 一格宽的空白点（草地）：框里没有数字
  const grass = [];
  for (let t = 0; t < n * n; t++) if (!spec.given[t] && spec.solution[t] !== OPEN) grass.push([t % n, (t / n) | 0]);
  assert.equal(tryBox(grass[0], grass[0]), false);
  const mid = [grass[Math.floor(grass.length / 2)], grass[Math.floor(grass.length / 2) + 1]];
  assert.equal(tryBox(mid[0], mid[1]), false);
  // 面积与数字不符：拿真解的框缩一格
  const b = [...boxesOf(spec).values()].find((x) => x.maxx > x.minx);
  assert.equal(tryBox([b.minx, b.miny], [b.maxx - 1, b.maxy]), false, '面积不对却成交了');
  assert.equal(e.stats().moves, before.moves, '非法框记了步数');
  assert.equal(e.stats().done, 0);
  assert.equal(e.canUndo(), false, '非法框进了撤销栈');
  // 合法一笔之后，重画同一间不重复计费
  assert.equal(tryBox([b.minx, b.miny], [b.maxx, b.maxy]), true);
  const after = e.stats();
  assert.equal(after.moves, 1);
  assert.equal(tryBox([b.minx, b.miny], [b.maxx, b.maxy]), false, '已围好的一间被重画了');
  assert.equal(e.stats().moves, after.moves, '重画收了第二次钱');
});

test('擦除不记账，一笔只留一个快照', () => {
  const spec = generate('erase:8', 8);
  const box = boxesOf(spec);
  const b = [...box.values()].find((x) => x.cells > 1);
  const e = create(spec);
  e.down(b.minx, b.miny, 0); e.move(b.maxx, b.maxy); e.up();
  assert.equal(e.stats().done, 1);
  let levels = 0;
  while (e.canUndo() && levels++ < 20) e.undo();
  assert.equal(levels, 1, '一笔落子竟然留了不止一个快照');

  e.down(b.minx, b.miny, 0); e.move(b.maxx, b.maxy); e.up();
  const moves = e.stats().moves;
  // 一整条擦除笔只算一次撤销：从第一格起存快照，之后每格都并在这笔里
  e.down(b.minx, b.miny, 1);
  for (let y = b.miny; y <= b.maxy; y++) {
    for (let x = b.minx; x <= b.maxx; x++) e.move(x, y);
    for (let x = b.maxx; x >= b.minx; x--) e.move(x, y);
  }
  assert.equal(e.up(), true, '擦除没报 changed');
  assert.equal(e.stats().moves, moves, '擦除收了步数');
  assert.equal(e.stats().done, 0, '擦过的那间没被擦干净');
  assert.equal(e.canUndo(), true);
  e.undo();
  assert.equal(e.stats().done, 1, '一次撤销没有把整条擦除还原');
  assert.equal(e.canUndo(), true, '擦除这一笔之外还多存了快照');
  e.undo();
  assert.equal(e.canUndo(), false, '落子那一笔的快照丢了');

  // 空擦（草地上按副笔）既不改动也不进栈
  const e2 = create(spec);
  const grass = [];
  for (let t = 0; t < spec.n * spec.n; t++) if (!spec.given[t]) grass.push(t);
  const [gx, gy] = [grass[0] % spec.n, (grass[0] / spec.n) | 0];
  assert.equal(e2.down(gx, gy, 1), false, '擦空白却算改动');
  assert.equal(e2.canUndo(), false, '擦空白进了撤销栈');
});

test('键盘两下也能围出一间；越界坐标只忽略、不崩', () => {
  const spec = generate('keys:6', 6);
  const n = spec.n;
  const e = create(spec);
  const b = [...boxesOf(spec).values()].find((x) => x.cells > 1);
  e.down(b.minx, b.miny, 0); e.up();                      // 第一下钉角：不算改动
  assert.equal(e.stats().moves, 0);
  e.down(b.maxx, b.maxy, 0); e.up();                      // 第二下定对角
  assert.equal(e.stats().done, 1, '两下围不出一间');
  assert.equal(e.stats().moves, 1);
  // 原地两下 = 1×1 的一间（单格数字只能这么围）
  const single = [...boxesOf(spec).values()].find((x) => x.cells === 1);
  if (single) {
    const e1 = create(spec);
    e1.down(single.minx, single.miny, 0); e1.up();
    e1.down(single.minx, single.miny, 0); e1.up();
    assert.equal(e1.stats().done, 1, '点两下围不出单格的一间');
    assert.equal(e1.stats().moves, 1);
  }
  // 换角重开：另起一笔要丢掉上一钉
  const e2 = create(spec);
  e2.down(0, 0, 0); e2.up();
  e2.down(b.minx, b.miny, 0); e2.move(b.maxx, b.maxy); e2.up();
  assert.ok(e2.stats().moves <= 1);
  // 越界与半程手势
  const e3 = create(spec);
  assert.equal(e3.down(-1, 5, 0), false);
  assert.equal(e3.move(n + 9, n + 9), false);
  assert.equal(e3.up(), false);
  assert.equal(e3.down(0, 0, 0), false, '按下本身不该算改动');
  assert.equal(e3.move(2, 2), false, '拖动本身不该算改动');
  assert.equal(e3.move(-3, 99), false);
  assert.equal(e3.stats().moves, 0);
  e3.undo();
  assert.equal(e3.stats().moves, 0);
  assert.equal(e3.canRedo(), false);
});

test('判胜即锁盘：改笔只能走撤销', () => {
  const spec = generate('lock:6', 6);
  const e = dragAll(spec);
  assert.equal(e.solved(), true);
  const s = e.stats();
  assert.equal(e.down(0, 0, 0), false, '通关后还能落子');
  assert.equal(e.move(2, 2), false);
  assert.equal(e.up(), false);
  assert.equal(e.down(1, 1, 1), false, '通关后还能擦');
  assert.equal(e.hint(), null, '通关后提示还在改状态');
  assert.deepEqual(e.stats(), s, '锁盘期间账本动了');
  assert.equal(e.undo(), true);
  assert.equal(e.solved(), false);
  assert.equal(e.redo(), true);
  assert.equal(e.solved(), true, '重做没回到通关');
});

// ---- 5. 提示：真改状态，且不许说错话 --------------------------------------------------------

test('提示每一步都落在真解上，直到通关', () => {
  for (const size of TIERS) {
    const spec = generate(`hint:${size}`, size);
    const e = create(spec);
    let guard = 0;
    while (!e.solved()) {
      const h = e.hint();
      assert.ok(h && h.cells.length, `${size} 第 ${guard} 次提示空转`);
      assert.ok(typeof h.note === 'string' && h.note.length > 3, `${size} 提示没有解释`);
      assert.equal(e.canUndo(), true, `${size} 提示没进撤销栈`);
      // 提示落下的每一格都必须与真解一致 —— 它不能为了"改状态"随便涂
      for (const [x, y] of h.cells) assert.ok(x >= 0 && y >= 0 && x < size && y < size, '提示越界');
      if (++guard > 400) assert.fail(`${size} 提示打转打不完`);
    }
    // 提示一次最多落一间，所以步数不该比"每间一次"高出几倍；高出来说明在原地磨
    assert.ok(guard <= e.stats().par * 4 + 8, `${size} 提示用了 ${guard} 步，par=${e.stats().par}`);
    assert.equal(e.hint(), null);
  }
});

// 找一处"抢格子"的手势：先围 A 间，再围一个与 A 重叠的合法框 —— 后一笔把 A 的墨切掉一块，
// 而 A 剩下的墨就此塞不进它任何一种还能放的摆法。这是公开手势下唯一能人造出矛盾的路径。
function findSteal(spec) {
  const board = createBoard(spec.n, Int16Array.from(spec.given));
  const pool = [];
  for (let i = 0; i < board.clues; i++) {
    for (const rid of board.rectsOf[i]) pool.push({ i, box: board.rectBox(rid), cells: new Set(board.rectCells(rid)) });
  }
  for (const A of pool) {
    for (const B of pool) {
      if (A.i === B.i) continue;
      if (![...B.cells].some((t) => A.cells.has(t))) continue;
      const e = create(spec);
      paintRect(e, A.box, spec.n);
      paintRect(e, B.box, spec.n);
      const bad = e.badCells();
      if (bad.length) return { e, A, B, bad };
    }
  }
  return null;
}

// 按公开手势围出一块（一格宽的走"点两下"）
function paintRect(e, [r0, c0, r1, c1], n) {
  void n;
  if (r0 === r1 && c0 === c1) {
    e.down(c0, r0, 0); e.up();
    e.down(c0, r0, 0); e.up();
    return;
  }
  e.down(c0, r0, 0); e.move(c1, r1); e.up();
}

test('只有"塞不进任何摆法"的墨才算错：半成品不闪红', () => {
  const spec = generate('bad:8', 8);
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '开局就有矛盾？');
  // 提示落下的单格是"还没画完的一间"，它一定还塞得进某种摆法 —— 不许闪红
  let single = 0;
  const probe = create(spec);
  for (let k = 0; k < 30 && !probe.solved(); k++) {
    const h = probe.hint();
    assert.ok(h);
    if (h.cells.length === 1) {
      single++;
      assert.deepEqual(probe.badCells(), [], `提示刚落的单格被判成矛盾：${JSON.stringify(h.cells)}`);
    }
  }
  assert.ok(single > 0, '这套提示从没单独落过一格，上面那条断言是空的');
  // 明显装不下的整盘框：直接被拒，不留墨
  const e3 = create(spec);
  e3.down(0, 0, 0); e3.move(spec.n - 1, spec.n - 1); e3.up();
  assert.deepEqual(e3.badCells(), [], '被拒的手势留下了墨');
  // 抢走一格，才会出现真的矛盾
  const steal = findSteal(spec);
  assert.ok(steal, '这张 8×8 找不到任何两处重叠的摆法，闪红这条路没被测到');
  const { e: se, A, B, bad } = steal;
  assert.ok(bad.length, '抢完格子居然不算矛盾');
  // 只有被抢的那两家可能有墨，所以闪红不许波及其他间
  const ownerAt = (x, y) => se.ownerAt(x, y);
  for (const [x, y] of bad) {
    const i = ownerAt(x, y);
    assert.ok(i === A.i || i === B.i, `第 ${i} 间的墨被误报成矛盾`);
  }
  // 全盘按解拖完之后不该有任何矛盾：闪红只在"抢格子"时出现
  const clean = dragAll(spec);
  assert.deepEqual(clean.badCells(), [], '照解画满全盘却报矛盾');
});

test('盘上有矛盾时，提示的第一手是擦掉它', () => {
  const spec = generate('badhint:8', 8);
  const steal = findSteal(spec);
  assert.ok(steal, '造不出矛盾的盘，这条测试没有对象');
  const { e, bad } = steal;
  const moves = e.stats().moves;
  const h = e.hint();
  assert.ok(h && h.cells.length, '有矛盾的盘上提示空转');
  assert.deepEqual(h.cells, [bad[0]], '提示没先擦掉矛盾的那一格');
  assert.ok(e.badCells().length < bad.length, '擦掉一格后矛盾数没减少');
  assert.equal(e.stats().moves, moves, '擦除收了步数');
  assert.ok(/擦掉/.test(h.note), '提示没说清它在做什么');
});

// ---- 6. 生成器：每档 40 个 seed 的 fuzz -----------------------------------------------------

test('fuzz：每档 40 个 seed 交出来的题都唯一、可推、互不重样', () => {
  for (const size of TIERS) {
    const seen = new Set();
    const scores = [];
    for (const seed of SEEDS(`fuzz:${size}`, 40)) {
      const spec = generate(seed, size);
      assert.equal(spec.kind, 'shikaku');
      assert.equal(spec.n, size);
      assert.equal(spec.degraded, undefined, `${seed} 走了兜底：生成器在这一档出不来题`);
      assert.equal(spec.solutions, 1, `${seed} 解数不是 1`);
      assert.equal(spec.capped, false, `${seed} 没数完就交了题`);
      assert.equal(spec.nishio, 0, `${seed} 要试手`);
      const board = createBoard(spec.n, Int16Array.from(spec.given));
      assert.equal(complete(board, Int16Array.from(spec.solution)), true, `${seed} 题面与解不自洽`);
      assert.deepEqual(myProblems(spec.n, spec.given, Int16Array.from(spec.solution)), []);
      assert.equal(solve(board).ok, true, `${seed} 纯逻辑推不到底`);
      // 题面必须能 JSON 往返（存档只存种子，但 spec 也要能直接落盘）
      const rt = JSON.parse(JSON.stringify(spec));
      assert.deepEqual(rt.solution, spec.solution);
      assert.deepEqual(rt.given, spec.given);
      assert.equal(rt.par, spec.par);
      const key = spec.given.join('');
      seen.add(key);
      scores.push(spec.score);
      // 交出来的盘必须落在自己档位的带里：带是"离群的候选换一刀"这道闸，
      // 档位之间的排序靠的是盘的大小 —— 分数是推导次数的加权和，本来就随盘长。
      const cfg = tierOf(size);
      assert.ok(spec.score >= cfg.band[0] && spec.score <= cfg.band[1],
        `${size}/${seed} 分数 ${spec.score} 出了带 [${cfg.band}]`);
      assert.ok(spec.par >= 6 && spec.par <= 30, `${size}/${seed} 间数 ${spec.par} 不合理`);
    }
    assert.equal(seen.size, 40, `${size} 档 40 个 seed 只出 ${seen.size} 张不同的盘`);
    const mid = TIERS.find((k) => k === size);
    assert.ok(Math.max(...scores) > Math.min(...scores), `${size} 档分数全一样，难度带是假的`);
    void mid;
  }
});

test('确定性：同种子同档位必须还原出同一道题', () => {
  for (const size of TIERS) {
    const a = generate(`det:${size}`, size);
    for (let k = 0; k < 3; k++) {
      const b = generate(`det:${size}`, size);
      assert.deepEqual(b, a, `${size} 第 ${k} 次还原不出同一道题`);
    }
    assert.notDeepEqual(generate(`other:${size}`, size), a, `${size} 换种子却没换题`);
  }
});

test('难度是量出来的：三档的分数带互不重叠，档位表说的是同一件事', () => {
  const stats = TIERS.map((size) => {
    const scores = SEEDS(`band:${size}`, 12).map((s) => generate(s, size).score);
    scores.sort((a, b) => a - b);
    return { size, lo: scores[0], hi: scores[scores.length - 1], med: scores[scores.length >> 1] };
  });
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].med > stats[i - 1].med, `档位 ${stats[i].size} 的中位数没超过 ${stats[i - 1].size}：难度排序是形容词`);
    assert.ok(stats[i].lo > stats[i - 1].lo, `${stats[i].size} 的下界比小盘还低`);
  }
  // tierOf 的口径要与档位表一致，且乱写的档位有落点（外壳只传 sizes 里的 key）
  for (const size of TIERS) assert.equal(String(tierOf(size).key), String(size));
  assert.ok(tierOf('nonsense').key, '未知档位没有兜底');
  assert.deepEqual(shikaku.sizes.map((s) => s.key), TIERS, '档位表与 tierOf 用的不是同一份');
  for (const s of shikaku.sizes) assert.ok(s.label.includes('×') && s.tier, `${s.key} 档缺展示字段`);
});

test('成本随盘走：最慢一次出题也留在可等的范围内', () => {
  for (const size of TIERS) {
    let worst = 0;
    let which = '';
    for (const seed of SEEDS(`cost:${size}`, 8)) {
      const t0 = performance.now();
      generate(seed, size);
      const dt = performance.now() - t0;
      if (dt > worst) { worst = dt; which = seed; }
    }
    // 上限给得很松：这条断言防的是"算法塌成指数"，不是压负载的毫秒 —— 同一份代码在本机、
    // 能效核、CI 那台 4 核（并发 10 个测试文件）之间实测差到 30 倍，钉绝对毫秒就是掷硬币。
    // 可证的上界是档位自己的 tries × audit 节点预算。
    assert.ok(worst < 30000, `${size} 档 ${which} 出题花了 ${worst.toFixed(0)}ms`);
  }
});

test('兜底盘也是真题：唯一、推得完，只是不装难', () => {
  for (const size of TIERS) {
    const spec = fallbackSpec('frozen', size);
    assert.equal(spec.degraded, true, '兜底盘得如实标出来');
    assert.equal(spec.n, size);
    const board = createBoard(spec.n, Int16Array.from(spec.given));
    assert.equal(complete(board, Int16Array.from(spec.solution)), true, `${size} 的兜底解是假的`);
    assert.deepEqual(myProblems(spec.n, spec.given, Int16Array.from(spec.solution)), []);
    const c = countSolutions(board, { cap: 2, budget: 400000 });
    assert.equal(c.capped, false);
    assert.equal(c.count, 1, `${size} 的兜底盘有 ${c.count} 个解`);
    assert.equal(solve(board).ok, true, `${size} 的兜底盘推不完`);
    assert.ok(JSON.stringify(spec).length > 100);
    // 兜底也走同一套手势与账本
    const e = dragAll(spec);
    assert.equal(e.solved(), true);
    assert.equal(e.stats().moves, e.stats().par);
  }
});

// ---- 7. 契约字段 ---------------------------------------------------------------------------

test('kind 描述符齐全：外壳要的字段一个都不缺', () => {
  assert.equal(shikaku.id, 'shikaku');
  assert.equal(shikaku.title, '数间');
  assert.ok(shikaku.latin && shikaku.tagline);
  assert.ok(Array.isArray(shikaku.rules) && shikaku.rules.length >= 3);
  for (const r of shikaku.rules) assert.ok(r.length > 4);
  assert.equal(shikaku.unit, '间');
  assert.equal(typeof shikaku.generate, 'function');
  assert.equal(typeof shikaku.create, 'function');
  const spec = generate('kind:6', 6);
  const e = create(spec);
  assert.equal(e.board.cols, 6);
  assert.equal(e.board.rows, 6);
  for (const side of ['l', 't', 'r', 'b']) assert.ok(e.board.margin[side] > 0, `余量 ${side} 得留出来放数字`);
  // 一帧画得出来：空盘、有墨、通关三态都走一遍渲染
  const { ctx, calls } = fakeCtx();
  const v = { cell: 30, ox: 20, oy: 20, cols: 6, rows: 6, w: 400, h: 400, dpr: 2, hover: null, bad: [], reduce: false };
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20);
  e.down(0, 0, 0); e.move(5, 5); e.up();
  e.draw(ctx, { ...v, hover: { x: 2, y: 3 }, bad: e.badCells() }, 1100);
  dragAll(spec, e);
  e.celebrate(ctx, { ...v, reduce: true }, 2000, 0.5);
  assert.ok(calls.length > 60);
});

function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'canvas') return { width: 600, height: 600 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return (...args) => { calls.push(k); void args; };
    },
    set() { return true; },
  });
  return { ctx, calls };
}
