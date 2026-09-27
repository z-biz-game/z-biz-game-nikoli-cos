// 五寸钉的三道保险（与数墙/帐篷/黑白/隔离同一立场）：
//   1) 出题器不许说谎 —— 交出来的题必须被 countSolutions 数到"恰好一种画法"且没烧穿预算；
//      capped 永远不等于唯一。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现（自己从"格的四个角"推节点归属，
//      不 import 引擎的 nodeAt），拿它跟 cluesFrom / rulesOk / countSolutions 对拍；
//      3×3 还把全部 512 张画色盘穷举核过一遍解数。
//   3) 引擎是纯状态机 —— 只用公开 API 走子；空格定下方向才收一步，换向、擦除、记号都不收账，
//      撤销与重做也不退款。
//
// 题面口径（钉在引擎文件头）：clue 是 (n+1)² 长的定长数组，下标 = y*(n+1)+x，值 = 收在该节点
// 上的线头条数，-1 = 这个点没有数字。**0 是真线索**，不是"没有数字"——这条最容易写错，
// 所以第 5 组断言专门拿它开刀。

import test from 'node:test';
import assert from 'node:assert/strict';
import slant, {
  generate, create, nodeAt, cluesFrom, rulesOk, violatedNodes, logicSolve, reachable,
  countSolutions, OPEN, SLASH, BACK, NO_CLUE,
} from '../js/puzzles/slant.js';

const TIERS = slant.sizes.map((s) => s.key);
const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);

// ---- 独立实现（一行都不 import 引擎的几何工具） -------------------------------------
// 从"格 (cx,cy) 的四个角"反推节点归属，与引擎里"节点的四邻"那个方向正好相反：
// 两套代码只要有一边写错，对拍就会炸。
const otherOf = (v) => (v === SLASH ? BACK : SLASH);

// 格 (cx,cy) 的斜线能碰到哪四个节点："/" 碰左下与右上，"\" 碰左上与右下
function myNodeLists(n) {
  const lists = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) lists.push([]);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      lists[cy * (n + 1) + cx].push([i, BACK]);            // 左上角
      lists[cy * (n + 1) + cx + 1].push([i, SLASH]);       // 右上角
      lists[(cy + 1) * (n + 1) + cx].push([i, SLASH]);     // 左下角
      lists[(cy + 1) * (n + 1) + cx + 1].push([i, BACK]);  // 右下角
    }
  }
  return lists;
}

// 独立判定：照规则把每个数字再数一遍
function myOk(n, clue, cells) {
  if (cells.length !== n * n) return false;
  for (const v of cells) if (v === OPEN) return false;
  const lists = myNodeLists(n);
  for (let i = 0; i < clue.length; i++) {
    if (clue[i] === NO_CLUE) continue;
    let have = 0;
    for (const [cell, value] of lists[i]) if (cells[cell] === value) have++;
    if (have !== clue[i]) return false;
  }
  return true;
}

// 独立计数：n ≤ 3 时把 2^(n²) 张盘全枚举一遍
function myAllSolutions(n, clue) {
  const lists = myNodeLists(n);
  const out = [];
  for (let mask = 0; mask < (1 << (n * n)); mask++) {
    const cells = [];
    for (let i = 0; i < n * n; i++) cells.push((mask >> i) & 1 ? SLASH : BACK);
    let good = true;
    for (let k = 0; k < clue.length && good; k++) {
      if (clue[k] === NO_CLUE) continue;
      let have = 0;
      for (const [cell, value] of lists[k]) if (cells[cell] === value) have++;
      if (have !== clue[k]) good = false;
    }
    if (good) out.push(cells);
  }
  return out;
}

function myCount(n, clue, limit = Infinity) {
  const lists = myNodeLists(n);
  let count = 0;
  let witness = null;
  for (let mask = 0; mask < (1 << (n * n)); mask++) {
    const cells = [];
    for (let i = 0; i < n * n; i++) cells.push((mask >> i) & 1 ? SLASH : BACK);
    let good = true;
    for (let k = 0; k < clue.length && good; k++) {
      if (clue[k] === NO_CLUE) continue;
      let have = 0;
      for (const [cell, value] of lists[k]) if (cells[cell] === value) have++;
      if (have !== clue[k]) good = false;
    }
    if (good) {
      count++;
      if (!witness) witness = cells.slice();
      if (count >= limit) return { count, witness };
    }
  }
  return { count, witness };
}

// 用公开 API 把整张盘读回来（引擎不许有第二条取状态的近路）
function cellsOf(e, n) {
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = e.cellState(i % n, (i - (i % n)) / n);
  return out;
}

// ---- 1 几何 ----------------------------------------------------------------------

test('斜线的方向定义只有一处："/" 收在左下与右上，"\\" 收在左上与右下', () => {
  // 1×1 盘是全部几何的最小样本：四个角各要一条特定的线
  assert.deepEqual(nodeAt(1, 0, 0), [[0, BACK]]);
  assert.deepEqual(nodeAt(1, 1, 0), [[0, SLASH]]);
  assert.deepEqual(nodeAt(1, 0, 1), [[0, SLASH]]);
  assert.deepEqual(nodeAt(1, 1, 1), [[0, BACK]]);
  // cluesFrom 就是这四句话的加总：斜杠盘的右上/左下记 1，另两个记 0
  assert.deepEqual(Array.from(cluesFrom(1, [SLASH])), [0, 1, 1, 0]);
  assert.deepEqual(Array.from(cluesFrom(1, [BACK])), [1, 0, 0, 1]);
});

test('引擎的节点表与独立几何逐点相符（含边界与角点）', () => {
  for (const n of [1, 2, 4, 5]) {
    const mine = myNodeLists(n);
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x <= n; x++) {
        const i = y * (n + 1) + x;
        const a = nodeAt(n, x, y).map(([c, v]) => `${c}:${v}`).sort();
        const b = mine[i].map(([c, v]) => `${c}:${v}`).sort();
        assert.deepEqual(a, b, `${n}×${n} 的节点(${x},${y}) 两边算的不是同一批格`);
      }
    }
  }
});

// ---- 2 规则层与求解器对拍 ------------------------------------------------------------

test('3×3 全集：求解器数出的解数与 512 张盘的穷举一位不差', () => {
  for (const clue of [
    Array.from(cluesFrom(3, [SLASH, BACK, SLASH, BACK, SLASH, BACK, SLASH, BACK, SLASH])),
    Array.from(cluesFrom(3, new Array(9).fill(BACK))),
    ...Array.from({ length: 24 }, (_, k) => {
      // 从满数字盘上随机抠几个点，留下大量多解与无解盘 —— 正是这种盘量得出计数器的谎
      const base = Array.from(cluesFrom(3, new Array(9).fill(k % 2 ? SLASH : BACK)));
      for (let j = 0; j < 4; j++) base[(k * 7 + j * 5) % 16] = NO_CLUE;
      return base;
    }),
  ]) {
    const brute = myCount(3, clue);
    const eng = countSolutions({ n: 3, clue }, 200000, { limit: 1024 });
    assert.equal(eng.capped, false, '3×3 全集都烧穿预算了？');
    assert.equal(eng.count, brute.count, `解数对不上：引擎 ${eng.count}，穷举 ${brute.count}`);
    if (brute.count) assert.equal(myOk(3, clue, eng.witness), true, '引擎交出的"解"根本不满足题面');
  }
});

test('满数字盘必然唯一且必然推得完：这是生成器的地基', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    for (const seed of SEEDS(`full:${n}`, 6)) {
      const sol = Array.from(cluesFrom(n, randomPaint(n, seed)));
      const cells = logicSolve(n, sol);
      assert.ok(cells, `满数字盘推不完（${n}×${n} / ${seed}）：铅笔路径有漏`);
      assert.equal(myOk(n, sol, cells), true, '纯逻辑推出来的盘不满足规则');
      const { count, capped } = countSolutions({ n, clue: sol }, 200000);
      assert.equal(capped, false);
      assert.equal(count, 1, `满数字盘竟然不止一解：${n}×${n}`);
    }
  }
});

// 只借一个自带的随机源，不借引擎任何判定逻辑
function randomPaint(n, seed) {
  const rng = mulberry(seed);
  return Array.from({ length: n * n }, () => (rng() < 0.5 ? SLASH : BACK));
}
function mulberry(a) {
  let s = 0;
  for (let i = 0; i < String(a).length; i++) s = (s * 31 + String(a).charCodeAt(i)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('纯逻辑推得完的题，穷举出来的每一个解都一模一样：传播既不越权也不漏', () => {
  // 这条同时钉住两件事：① logicSolve 交出来的盘确实是解（不越权）；
  // ② 只要它推得完，盘上就没有第二种画法（不遗漏）。3×3 全集只有 512 张盘，逐个对。
  for (const clue of Array.from({ length: 60 }, (_, k) => {
    const base = Array.from(cluesFrom(3, randomPaint(3, `prop:${k}`)));
    for (let j = 0; j < 4 + (k % 8); j++) base[(k * 5 + j * 3) % 16] = NO_CLUE;
    return base;
  })) {
    const hit = logicSolve(3, clue);
    const all = myAllSolutions(3, clue);
    if (!hit) {
      // 推不完：那这题要么无解、要么多解，绝不能是"恰好一个解但我们的规则太笨"
      assert.notEqual(all.length, 1, `题面明明只有一个解，铅笔路径却推不完：${clue.join('')}`);
      continue;
    }
    assert.equal(myOk(3, clue, hit), true, 'logicSolve 交的盘不满足规则');
    assert.equal(all.length, 1, `推得完的题竟然有 ${all.length} 个解`);
    assert.deepEqual(all[0], Array.from(hit), '唯一的解与推导结果不符');
  }
});

// ---- 3 0 是真线索 ------------------------------------------------------------------

test('0 是真线索：把 0 当"没有数字"会放走一整批错盘', () => {
  // 1×1：两个对角写 0、其余不写 —— 只有 "/" 收得掉两个 0，"\" 一个都不剩
  const withZero = [0, NO_CLUE, NO_CLUE, 0];
  assert.equal(myCount(1, withZero).count, 1);
  assert.equal(countSolutions({ n: 1, clue: withZero }, 1000).count, 1, '0 被当成"没有数字"了');
  // 同一个题面把 0 抹成"没有数字"，解就变成 2 个 —— 差别必须体现在解数上
  assert.equal(myCount(1, [NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).count, 2);
  // 一个 4 的节点强制四格全收过来
  const four = [NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, 4, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE];
  assert.deepEqual(Array.from(cluesFrom(2, [SLASH, SLASH, SLASH, SLASH])).filter((v) => v === 4).length, 0);
  const c = countSolutions({ n: 2, clue: four }, 1000);
  assert.equal(c.count, 1, '中心写 4 的 2×2 盘只该有一种画法');
  assert.deepEqual(c.witness, [BACK, SLASH, SLASH, BACK], '四格都得把线头收到中心');
});

test('题面里没写数字的点可以随便画：全 NO_CLUE 的盘解数 = 2^(n²)', () => {
  const n = 3;
  const blank = new Array((n + 1) * (n + 1)).fill(NO_CLUE);
  assert.equal(countSolutions({ n, clue: blank }, 100000, { limit: 600 }).count, 512);
  assert.equal(logicSolve(n, blank), null, '一个数字都没有也该"推得完"？那是编译器在骗人');
});

// ---- 4 出题器 ----------------------------------------------------------------------

test('每档 40 颗种子：交出来的题全部唯一、全部推得完、全部与独立判定相符', () => {
  for (const key of TIERS) {
    const seen = new Set();
    let zeroBoards = 0;
    for (const seed of SEEDS(`gen:${key}`, 40)) {
      const spec = generate(seed, key);
      assert.equal(spec.n, key);
      assert.equal(spec.kind, 'slant');
      assert.equal(spec.clue.length, (key + 1) * (key + 1));
      assert.equal(spec.par, key * key, 'par 口径：每格欠一子');
      assert.ok(spec.cluesGiven > 0 && spec.cluesGiven <= spec.clue.length, '数字个数不在合法区间');
      const cells = logicSolve(spec.n, spec.clue);
      assert.ok(cells, `${key}×${key} ${seed}：交了一张推不完的题`);
      assert.deepEqual(cells, spec.solution, `${key}×${key} ${seed}：spec.solution 与推导结果不符`);
      assert.equal(myOk(spec.n, spec.clue, cells), true, `${key}×${key} ${seed}：推出来的盘不满足规则`);
      const { count, capped } = countSolutions({ n: spec.n, clue: spec.clue }, 60000);
      assert.equal(capped, false, `${key}×${key} ${seed}：计数烧穿预算，凭什么说唯一`);
      assert.equal(count, 1, `${key}×${key} ${seed}：这题不止一种画法`);
      if (spec.clue.some((v) => v === 0)) zeroBoards++;
      seen.add(spec.clue.join(','));
    }
    assert.ok(seen.size >= 38, `${key}×${key} 40 道题只有 ${seen.size} 张不同题面`);
    assert.equal(zeroBoards, 40, `${key}×${key} 一批题里一个 0 都没有：0 是这玩法的招牌`);
  }
});

test('同一颗种子永远同一道题，且题面能过 JSON 往返（存档就靠这条）', () => {
  for (const key of TIERS) {
    const a = generate(`same:${key}`, key);
    const b = generate(`same:${key}`, key);
    assert.deepEqual(a, b, '同种子不同题：每日挑战的"全球同题"当场失效');
    const round = JSON.parse(JSON.stringify(a));
    assert.deepEqual(round, a, '题面不可序列化');
    const e = create(round);
    assert.equal(e.solved(), false);
    assert.equal(e.stats().total, key * key);
  }
});

test('档位要分得开：越大的盘推导遍数越多，难度不是形容词', () => {
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const rounds = TIERS.map((key) => med(SEEDS(`rank:${key}`, 20).map((s) => generate(s, key).rounds)));
  for (let i = 1; i < TIERS.length; i++) {
    assert.ok(rounds[i] >= rounds[i - 1], `第 ${i} 档的推导遍数 ${rounds.join('/')} 没有比上一档多`);
  }
  // 分数铺得开才有挑题的意义
  const scores = TIERS.map((key) => {
    const list = SEEDS(`spread:${key}`, 20).map((s) => generate(s, key).score);
    return Math.max(...list) - Math.min(...list);
  });
  scores.forEach((sp, i) => assert.ok(sp >= 3, `${TIERS[i]}×${TIERS[i]} 的推导分只铺开 ${sp}`));
});

test('题面不会只靠"数字多"装难：留下的数字明显少于全标数', () => {
  for (const key of TIERS) {
    const nodes = (key + 1) * (key + 1);
    const kept = SEEDS(`keep:${key}`, 20).map((s) => generate(s, key).cluesGiven / nodes);
    const m = med(kept);
    assert.ok(m < 0.8, `留了 ${(m * 100) | 0}% 的数字，这不是出题是默写`);
    assert.ok(m > 0.2, `只留 ${(m * 100) | 0}%：这一档基本只能靠猜`);
  }
});
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

// ---- 5 引擎：落子与账 ----------------------------------------------------------------

test('主笔三态循环：空格定方向收一步，换向与擦除不再收账', () => {
  const spec = generate('move:0', 6);
  const e = create(spec);
  assert.equal(e.down(0, 0, 0), true, '空格里点第一下不该落子');
  assert.equal(e.cellState(0, 0), SLASH);
  assert.equal(e.stats().moves, 1);
  assert.equal(e.down(0, 0, 0), true, '空格→斜线之后，换向也得允许');
  assert.equal(e.cellState(0, 0), BACK);
  assert.equal(e.stats().moves, 1, '换向又收了一步：par 就对不上了');
  assert.equal(e.down(0, 0, 0), true);
  assert.equal(e.cellState(0, 0), OPEN);
  assert.equal(e.stats().moves, 1, '擦除必须退款，否则★★★ 评星测的是运气');
  assert.equal(e.down(0, 0, 0), true);
  assert.equal(e.cellState(0, 0), SLASH);
  assert.equal(e.stats().moves, 2, '重新落子该再收一步');
});

test('拖动沿用手起手那一笔：一路画过去不用逐格点', () => {
  const spec = generate('drag:0', 6);
  const e = create(spec);
  assert.equal(e.down(1, 1, 0), true);
  assert.equal(e.cellState(1, 1), SLASH);
  for (let x = 2; x < 5; x++) assert.equal(e.move(x, 1), true, `拖到 (${x},1) 没画`);
  assert.equal(e.move(5, 5), true);
  for (let x = 2; x < 5; x++) assert.equal(e.cellState(x, 1), SLASH, `拖过的格 ${x} 没跟上`);
  assert.equal(e.cellState(5, 5), SLASH);
  assert.equal(e.stats().moves, 5, '五格各收一步');
  e.up();
  assert.equal(e.move(0, 0), false, '抬手之后 move 还能动盘：拖动没收尾');
  assert.equal(e.cellState(0, 0), OPEN);
});

test('副笔是备忘录：不定线、不收步，定了线的格不受理', () => {
  const spec = generate('pen:0', 6);
  const e = create(spec);
  assert.equal(e.down(2, 2, 1), true);
  assert.equal(e.cellState(2, 2), OPEN, '副笔把线画出来了：它不该定形');
  assert.equal(e.stats().moves, 0, '副笔收了步：记号不该算落子');
  assert.equal(e.down(2, 2, 1), true, '再点一下该把记号擦掉');
  assert.equal(e.down(2, 2, 1), true);
  e.down(2, 2, 0);
  assert.equal(e.cellState(2, 2), SLASH);
  assert.equal(e.down(2, 2, 1), false, '已经有线的格还接受副笔记号：图上会出现两种东西叠着');
});

test('撤销与重做还原盘面，但已经付过的步数不退', () => {
  const spec = generate('undo:0', 6);
  const e = create(spec);
  const sol = spec.solution;
  for (let i = 0; i < 4; i++) { const x = i % spec.n; e.down(x, 0, 0); e.up(); }
  const paid = e.stats().moves;
  assert.equal(paid, 4);
  assert.equal(e.undo(), true);
  assert.equal(e.cellState(3, 0), OPEN, '撤销没把这格擦回去');
  assert.equal(e.stats().moves, paid, '撤销退款：moves − par 就测不出人在试错了');
  assert.equal(e.canRedo(), true);
  assert.equal(e.redo(), true);
  assert.equal(e.cellState(3, 0), sol[3]);
  assert.equal(e.stats().moves, paid, '重做又收一次：那一步早就付过账');
  assert.equal(e.canUndo(), true);
  while (e.undo()) { /* 一路退到空盘 */ }
  assert.equal(e.canUndo(), false);
  assert.equal(e.undo(), false, '退到底了还说撤销成功');
  for (let i = 0; i < spec.n * spec.n; i++) assert.equal(e.cellState(i % spec.n, (i - (i % spec.n)) / spec.n), OPEN);
});

test('照唯一解画满即通关，零误笔时 moves 恰好等于 par', () => {
  const spec = generate('win:0', 8);
  const e = create(spec);
  for (let i = 0; i < spec.n * spec.n; i++) {
    const x = i % spec.n;
    const y = (i - x) / spec.n;
    e.down(x, y, 0);
    if (spec.solution[i] === BACK) e.down(x, y, 0);
    e.up();
  }
  assert.equal(e.solved(), true, '照着唯一解画满却没判胜');
  assert.equal(e.stats().done, spec.n * spec.n);
  assert.equal(e.stats().moves, spec.par, '每格一笔画满，moves 必须等于 par');
  assert.equal(e.hint(), null, '通关之后还给提示');
  assert.equal(e.down(0, 0, 0), false, '判胜之后棋盘没锁输入');
});

test('判胜用的是规则本身，不是题面答案：画一张满足题面的盘就能赢', () => {
  // 从空盘开始用传播推到底 —— 这条路完全不读 spec.solution
  const spec = generate('win2:0', 6);
  const cells = logicSolve(spec.n, spec.clue);
  const e = create({ ...spec, solution: new Array(spec.n * spec.n).fill(OPEN) });
  for (let i = 0; i < cells.length; i++) {
    const x = i % spec.n;
    const y = (i - x) / spec.n;
    e.down(x, y, 0);
    if (cells[i] === BACK) e.down(x, y, 0);
    e.up();
  }
  assert.equal(e.solved(), true, '引擎判胜其实是在抄答案');
});

test('badCells 只报真正数坏了的线，不会一开局就全红', () => {
  const spec = generate('bad:0', 6);
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '空盘就报矛盾');
  // 挑一个写 0 的点（"一条线都不许收到这儿"，实测每道题平均有五个）：
  // 把它四周全画成"收过来"，就是一次确凿的数超；再全换方向，矛盾必须跟着消失。
  const ni = spec.clue.indexOf(0);
  assert.ok(ni >= 0, '这道题里一个 0 都没有，样本挑得太窄');
  const nx = ni % (spec.n + 1);
  const ny = (ni - nx) / (spec.n + 1);
  const list = nodeAt(spec.n, nx, ny);
  assert.ok(list.length >= 1);
  for (const [cell, value] of list) {
    const x = cell % spec.n;
    const y = (cell - x) / spec.n;
    e.down(x, y, 0);
    if (value === BACK) e.down(x, y, 0);
    e.up();
    assert.equal(e.cellState(x, y), value, '落子没落下去');
  }
  const bad = e.badCells();
  assert.ok(bad.length, '0 被画成了 4 却没报矛盾');
  const listed = new Set(bad.map(([x, y]) => y * spec.n + x));
  for (const [cell] of list) assert.ok(listed.has(cell), `矛盾点 ${ni} 的格 ${cell} 没被标出来`);
  assert.ok(violatedNodes(spec.n, Int8Array.from(spec.clue), cellsOf(e, spec.n)).includes(ni),
    'violatedNodes 漏了这个点');
  for (const [cell] of list) {
    const x = cell % spec.n;
    const y = (cell - x) / spec.n;
    e.down(x, y, 0);
    e.up();
  }
  assert.equal(violatedNodes(spec.n, Int8Array.from(spec.clue), cellsOf(e, spec.n)).includes(ni), false,
    `矛盾点 ${ni} 的线已经全换方向了，还在报矛盾`);
});

// ---- 6 提示 ------------------------------------------------------------------------

test('提示永远真改动状态：从零一路提示到通关，且从不交整份答案', () => {
  for (const key of TIERS) {
    const spec = generate(`hint:${key}`, key);
    const e = create(spec);
    let used = 0;
    while (!e.solved() && used < spec.n * spec.n + 4) {
      const h = e.hint();
      assert.ok(h, '没通关却没给提示');
      assert.ok(Array.isArray(h.cells) && h.cells.length >= 1, '提示没指出格子');
      assert.ok(typeof h.note === 'string' && h.note.length > 4, '提示没解释');
      for (const [x, y] of h.cells) {
        assert.ok(x >= 0 && y >= 0 && x < spec.n && y < spec.n, `提示指到盘外 (${x},${y})`);
        assert.notEqual(e.cellState(x, y), OPEN, '提示指的那格没落子：它只是嘴上说说');
      }
      assert.equal(e.canUndo(), true, '提示没进撤销栈');
      used++;
    }
    assert.equal(e.solved(), true, `${key}×${key} 提示 ${used} 次还没做到通关`);
    assert.ok(used <= spec.n * spec.n, `提示用了 ${used} 次，比格子数还多`);
  }
});

test('画错的那一笔优先擦：拿错线当已知数推出来的"必然"不算推理', () => {
  const spec = generate('hint-wrong:0', 6);
  const e = create(spec);
  const i = spec.solution.indexOf(SLASH);
  const x = i % spec.n;
  const y = (i - x) / spec.n;
  e.down(x, y, 0);
  e.down(x, y, 0);                       // 画成 BACK，与唯一解相反
  e.up();
  assert.equal(e.cellState(x, y), BACK);
  const h = e.hint();
  assert.equal(e.cellState(x, y), OPEN, '提示没先把这一笔擦掉');
  assert.match(h.note, /擦掉/, '擦错子却没说明为什么');
  assert.deepEqual(h.cells, [[x, y]]);
});

test('reachable 说得出口："这一笔画死了自己"', () => {
  const spec = generate('reach:0', 6);
  const n = spec.n;
  const blank = new Uint8Array(n * n);
  assert.equal(reachable(n, Int8Array.from(spec.clue), blank), true, '空盘怎么会推死');
  // 照唯一解画一半，必然还活着；再随机搅满一整盘错线，早晚会死
  const half = Int8Array.from(spec.solution);
  assert.equal(reachable(n, Int8Array.from(spec.clue), half), true, '唯一解本身被判定为死局');
  let dead = 0;
  for (let k = 0; k < 30; k++) {
    const g = Int8Array.from(spec.solution);
    for (let j = 0; j < g.length; j++) if ((j + k) % 3 === 0) g[j] = otherOf(g[j]);
    if (!reachable(n, Int8Array.from(spec.clue), g)) dead++;
  }
  assert.ok(dead > 0, '把三分之一的线翻掉还个个都活着：这条判据是摆设');
});

// ---- 7 纯度与预算 -------------------------------------------------------------------

test('引擎是纯状态机：不碰时钟、随机源、DOM 与存档', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/slant.js', import.meta.url), 'utf8'));
  assert.equal(/Math\.random/.test(src), false, '引擎里出现 Math.random：同一颗种子就不再是同一道题');
  assert.equal(/\bnew Date\b/.test(src), false, '引擎不许读当前时间');
  assert.equal(/document\.|localStorage|window\./.test(src), false, '引擎不许碰 DOM 与存档');
});

test('draw 只要一个空壳上下文就能画完一帧，通关动画也不炸', () => {
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
  const v = { cell: 38, ox: 20, oy: 20, cols: spec.n, rows: spec.n, w: 420, h: 420, dpr: 2, hover: { x: 1, y: 1 }, bad: [[0, 0]], reduce: false };
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20, '一帧什么都没画');
  const filled = spec.solution.filter((v2) => v2 !== OPEN).length;
  assert.equal(filled, spec.n * spec.n);
  for (let i = 0; i < spec.n * spec.n; i++) {
    const x = i % spec.n;
    const y = (i - x) / spec.n;
    e.down(x, y, 0);
    if (spec.solution[i] === BACK) e.down(x, y, 0);
    e.up();
  }
  const n0 = calls.length;
  e.draw(ctx, v, 2000);
  assert.ok(calls.length > n0, '通关后再画一帧什么都没画');
  e.celebrate(ctx, v, 3000, 0.5);
  v.reduce = true;
  e.draw(ctx, v, 4000);
});

test('出题在手机上不卡：每档十道题各有预算', () => {
  // 这条线防的是"算法塌成指数"，不是防负载：同一份代码在本机 15 核、能效核、CI 那台
  // 4 核（还要并发 10 个测试文件）之间实测差到 30 倍，把毫秒当验收项就是掷硬币。
  // 真正可证的手感上界在各档 tries/audit 里；要按工作量钉，见 pegsolitaire 那条对照。
  const BUDGET = { 6: 9000, 8: 14000, 10: 24000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`budget:${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < BUDGET[key], `${key}×${key} 十道题花了 ${ms}ms，预算 ${BUDGET[key]}ms`);
  }
});

test('题面描述齐整：首页与"怎么玩"抽屉要读的每一栏都在', () => {
  assert.equal(slant.id, 'slant');
  assert.equal(slant.title, '五寸钉');
  assert.equal(slant.latin, 'SLANT');
  assert.ok(slant.tagline.length > 4);
  assert.ok(slant.rules.length >= 4, '玩法说明少于四条，抽屉里展不开');
  assert.equal(slant.unit, '格');
  assert.deepEqual(slant.sizes.map((s) => s.key), TIERS);
  for (const s of slant.sizes) assert.ok(s.label && s.tier, '档位少了名字');
  assert.equal(typeof slant.generate, 'function');
  assert.equal(typeof slant.create, 'function');
});
