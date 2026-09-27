// 数墙的三道保险（与数织/点灯同一立场）：
//   1) 出题器不许说谎 —— 交出来的每道题都得被 countSolutions 真数出唯一解（数完，不是没数完）；
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立的 bruteOk()，只按题面白话判黑白，
//      拿它跟引擎的 rulesOk 对拍四百年，两边谁多说一句"合法"都当场露馅；
//   3) 引擎是纯状态机 —— 只用公开 API 走子；落墨才收账，打点是记号，撤销与重做都不退款。
//
// 规则口径（钉死在引擎文件头，这里按同一条测）：数字数的是它上下左右四邻的墨滴数，
// 数字格自身是海；墨连成块，块的大小凑成与盘上数字一模一样的多重集（一块一数字、不重复用）；
// 海整体连通，且任何 2×2 不许全是海。

import test from 'node:test';
import assert from 'node:assert/strict';
import nurikabe, {
  generate, fallbackSpec, create, countSolutions, logicSolve,
  rulesOk, clueMap, seaConnected, components, everyTwoByTwoInked,
  WHITE, BLACK, EMPTY,
} from '../js/puzzles/nurikabe.js';

const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}:${i}`);
const TIERS = nurikabe.sizes.map((s) => s.key);

// 把 ASCII 棋盘翻成 { n, clues, color }：'#' 墨，'.' 海，数字是贴在海格上的题面数字
function board(rows) {
  const n = rows.length;
  const clues = [];
  const color = new Uint8Array(n * n);
  rows.forEach((row, y) => {
    assert.equal(row.length, n, `第 ${y} 行宽度 ${row.length} 与边长 ${n} 不符`);
    [...row].forEach((ch, x) => {
      const i = y * n + x;
      if (ch === '#') color[i] = BLACK;
      else if (ch === '.') color[i] = WHITE;
      else { clues.push([i, +ch]); color[i] = WHITE; }
    });
  });
  return { n, clues, color };
}
const idx = (n, x, y) => y * n + x;

// 与引擎毫无关系的另一套实现：只为对拍，宁可写得直白也不写得快。
function bruteOk(n, clues, color) {
  const N = n * n;
  if (color.length !== N) return false;
  for (const c of color) if (c !== WHITE && c !== BLACK) return false;      // 必须全落定
  const nb = (i) => {
    const x = i % n, y = (i - x) / n, o = [];
    if (x > 0) o.push(i - 1);
    if (x < n - 1) o.push(i + 1);
    if (y > 0) o.push(i - n);
    if (y < n - 1) o.push(i + n);
    return o;
  };
  const vals = new Map(clues);
  for (const [i, v] of vals) {
    if (color[i] !== WHITE) return false;
    if (nb(i).filter((j) => color[j] === BLACK).length !== v) return false;
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const w = [idx(n, x, y), idx(n, x + 1, y), idx(n, x, y + 1), idx(n, x + 1, y + 1)];
    if (w.every((j) => color[j] === WHITE)) return false;
  }
  const seen = new Set(), sizes = [];
  for (let i = 0; i < N; i++) {
    if (color[i] !== BLACK || seen.has(i)) continue;
    const st = [i]; seen.add(i); let s = 0;
    while (st.length) {
      const c = st.pop(); s++;
      for (const j of nb(c)) if (color[j] === BLACK && !seen.has(j)) { seen.add(j); st.push(j); }
    }
    sizes.push(s);
  }
  if (sizes.sort((a, b) => a - b).join(',') !== [...vals.values()].sort((a, b) => a - b).join(',')) return false;
  const sea = []; for (let i = 0; i < N; i++) if (color[i] === WHITE) sea.push(i);
  if (!sea.length) return false;
  const vs = new Set([sea[0]]), q = [sea[0]];
  while (q.length) {
    const c = q.pop();
    for (const j of nb(c)) if (color[j] === WHITE && !vs.has(j)) { vs.add(j); q.push(j); }
  }
  return vs.size === sea.length;
}

// 一张最小的手摆真题（4×4）：四滴孤墨配四个 1，海连通、无全海 2×2。
// 它是"正例"的锚点，故意不从引擎来 —— 引擎哪天把规则改松了，这张图还得说它是合法的。
const HAND_OK = ['#.#1', '....', '#.#1', '1.1.'];

test('玩法描述齐三件：标题、规则文案、档位表', () => {
  assert.equal(nurikabe.id, 'nurikabe');
  assert.equal(nurikabe.title, '数墙');
  assert.equal(nurikabe.latin, 'NURIKABE');
  assert.equal(nurikabe.unit, '格');
  assert.ok(nurikabe.rules.length >= 3, '首页"怎么玩"至少三条');
  assert.equal(nurikabe.rules.every((r) => r.length > 8), true, '规则文案里有空条目');
  assert.deepEqual(TIERS, [7, 8, 10], '档位表动了：出题预算与移动端布局都按这三档量过');
  assert.deepEqual(nurikabe.sizes.map((s) => s.tier), ['入门', '进阶', '烧脑']);
  assert.deepEqual([typeof nurikabe.generate, typeof nurikabe.create], ['function', 'function']);
});

test('手摆的 4×4 真题在两层实现里都算合法', () => {
  const b = board(HAND_OK);
  assert.equal(bruteOk(b.n, b.clues, b.color), true, 'fixture 自己就不合法，后面全白测');
  assert.equal(rulesOk(b.n, clueMap(b.n, b.clues), b.color), true, '引擎把一张真题判成非法');
  assert.equal(everyTwoByTwoInked(b.n, b.color), true);
  assert.equal(seaConnected(b.n, b.color, null), true);
  assert.deepEqual(components(b.n, b.color).map((c) => c.length).sort(), [1, 1, 1, 1]);
});

test('规则层对拍：四百张随机盘面，引擎说合法的和独立实现说合法的是同一批', () => {
  // 随机黑白 + 随机贴数字：绝大多数都不合法，正是要看两边是否在"同一处"说不合法
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let agree = 0, bothOk = 0;
  for (const n of [4, 5, 6]) {
    for (let t = 0; t < 140; t++) {
      const color = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) color[i] = rnd() < 0.42 ? BLACK : WHITE;
      const clues = [];
      for (let i = 0; i < n * n; i++) if (color[i] === WHITE && rnd() < 0.3) clues.push([i, 1 + Math.floor(rnd() * 4)]);
      const mine = bruteOk(n, clues, color);
      const eng = rulesOk(n, clueMap(n, clues), color);
      assert.equal(eng, mine, `${n}×${n} 对拍分家：引擎 ${eng} 独立实现 ${mine} clues ${JSON.stringify(clues)}`);
      agree++;
      if (mine) bothOk++;
    }
  }
  // 随机盘面几乎不可能合法（那条"块大小多重集 == 数字多重集"的规则太紧），所以正例得自己端上来：
  // 手摆的 4×4 与三档各一道生成题，两层实现都得说合法 —— 不然上面那句"对拍一致"是同义反复。
  const valid = [board(HAND_OK)];
  for (const key of TIERS) {
    const spec = generate(`cross:${key}`, key);
    valid.push({ n: spec.n, clues: spec.clues, color: Uint8Array.from(spec.solution) });
  }
  for (const v of valid) {
    assert.equal(bruteOk(v.n, v.clues, v.color), true, `${v.n}×${v.n} 这张正例连独立实现都不认`);
    assert.equal(rulesOk(v.n, clueMap(v.n, v.clues), v.color), true, `${v.n}×${v.n} 正例被引擎判成非法`);
    bothOk++;
    // 再各挖一格：把一滴墨扳成海，两边必须同时说不合法（谁单独放行都是漏）
    const flip = v.color.findIndex((c, i) => c === BLACK && !v.clues.some(([k]) => k === i));
    const mut = Uint8Array.from(v.color); mut[flip] = WHITE;
    assert.equal(bruteOk(v.n, v.clues, mut), false);
    assert.equal(rulesOk(v.n, clueMap(v.n, v.clues), mut), false, '扳掉一滴墨之后引擎还在判合法');
    bothOk++;
  }
  assert.equal(agree, 420);
  assert.equal(bothOk, (1 + TIERS.length) * 2, '正例 + 挖格反例的账对不上');
});

test('rulesOk 逐条咬合：少一墨、多一墨、数字格自己落墨、留空格都算非法', () => {
  const b = board(HAND_OK);
  const ok = (color, clues = b.clues) => rulesOk(b.n, clueMap(b.n, clues), color);
  assert.equal(ok(Uint8Array.from(b.color)), true);
  const hole = Uint8Array.from(b.color); hole[idx(4, 1, 1)] = EMPTY;
  assert.equal(ok(hole), false, '还有没落定的格子竟算解');
  const inkedNumber = Uint8Array.from(b.color); inkedNumber[idx(4, 3, 0)] = BLACK;
  assert.equal(ok(inkedNumber), false, '数字格自身必须是海');
  const oneTooMany = Uint8Array.from(b.color); oneTooMany[idx(4, 1, 3)] = BLACK;
  assert.equal(ok(oneTooMany), false, '给 1 号数字旁边再滴一滴墨，还叫合法？');
  const oneTooFew = Uint8Array.from(b.color); oneTooFew[idx(4, 0, 0)] = WHITE;
  assert.equal(ok(oneTooFew), false, '把 1 号数字唯一的墨擦掉，还叫合法？');
});

test('rulesOk 认全局结构：墨块大小对不上数字、海断成两半、2×2 全海，一律非法', () => {
  const b = board(HAND_OK);
  const ok = (color, clues) => rulesOk(b.n, clueMap(b.n, clues), color);
  // 把两滴孤墨接成一块 2 墨，数字却仍是四个 1：块数与多重集都塌了
  const merged = Uint8Array.from(b.color); merged[idx(4, 1, 0)] = BLACK;
  assert.equal(bruteOk(b.n, b.clues, merged), false);
  assert.equal(ok(merged, b.clues), false, '两块并成一块，尺寸多重集就不配数字了');
  assert.equal(ok(merged, [[3, 1], [11, 1], [12, 1], [idx(4, 1, 0), 2]]), false, '数字凑数也不许通过');
  // 把一角围死：(0,0) 这片海再也游不出去。rulesOk 的这条分支排在多重集之后，
  // 4×4 上没有一张盘能"只犯海这一条"，所以这里单测 helper，整条链的对拍交给上一个测试。
  const cut = Uint8Array.from(b.color);
  for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) cut[idx(4, x, y)] = BLACK;   // 把 (1,1) 围成一口井
  assert.equal(cut[idx(4, 1, 1)], WHITE);
  assert.equal(seaConnected(b.n, cut, null), false, '海被切开了，helper 却没看出来');
  assert.equal(seaConnected(b.n, b.color, null), true, '没切的时候 helper 反而报错');
  const sea22 = Uint8Array.from(b.color); sea22[idx(4, 0, 0)] = WHITE;
  assert.equal(everyTwoByTwoInked(b.n, sea22), false, '左上角被抹成一片全海 2×2');
  assert.equal(ok(sea22, b.clues), false, '2×2 全海还判合法');
});

test('seaConnected 只数从给定格子出发的那片海', () => {
  const b = board(HAND_OK);
  const into = [];
  const count = seaConnected(b.n, b.color, into, idx(4, 3, 3));
  const set = new Set(into);
  assert.equal(count, b.color.length - components(b.n, b.color).reduce((a, c) => a + c.length, 0));
  assert.equal(set.size, count, '灌进 into 的格子必须不重不漏');
  assert.ok(set.has(idx(4, 0, 1)) && set.has(idx(4, 3, 0)), '整片海都该在里面');
});

test('countSolutions 老实：多解就说多解，没数完就报 capped，绝不把没数完当唯一', () => {
  const b = board(HAND_OK);
  const full = countSolutions(b.n, b.clues, { cap: 2, budget: 200000 });
  assert.equal(full.capped, false, '4×4 这么小的空间都能烧穿预算？');
  assert.equal(full.count, 1, '手摆题竟然不止一解');
  assert.deepEqual(Array.from(full.solution), Array.from(b.color), '数出来的唯一解与题面不符');
  // 4×4 的全集只有 65536 张黑白盘：拿穷举当尺子量求解器，解数一位都不能差。
  // 这条比"找一道多解题"硬 —— 多解不设在那种小盘上（多重集规则一卡就没解），漏解却随时可能发生。
  const N4 = 4 * 4;
  const sets = [b.clues, [[0, 1], [1, 1]], [[5, 2], [10, 2]], [[0, 2], [5, 1], [10, 1], [15, 2]], []];
  for (const clues of sets) {
    let brute = 0;
    for (let mask = 0; mask < (1 << N4); mask++) {
      const color = new Uint8Array(N4);
      for (let i = 0; i < N4; i++) color[i] = (mask >> i & 1) ? BLACK : WHITE;
      if (bruteOk(4, clues, color)) brute++;
    }
    const r = countSolutions(4, clues, { cap: 1000, budget: 4000000 });
    assert.equal(r.capped, false, `4×4 穷举都烧穿预算了：${JSON.stringify(clues)}`);
    assert.equal(r.count, brute, `求解器数出 ${r.count}，穷举数出 ${brute}（题面 ${JSON.stringify(clues)}）`);
  }
  // 预算压到 1 个节点：必须报 capped，且不得声称唯一
  const starved = countSolutions(b.n, b.clues, { cap: 2, budget: 1 });
  assert.equal(starved.capped, true, '预算烧穿了却没说没数完');
  // 自相矛盾的题面：0 解，而且不算 capped
  const dead = countSolutions(4, [[0, 4], [3, 4]], { cap: 2, budget: 200000 });
  assert.equal(dead.count, 0, '两个角上的 4 谁都凑不齐，还数出了' + dead.count + '解');
  assert.equal(dead.capped, false);
});

test('logicSolve 只在真推得完时才交盘，交出来的盘两层都认', () => {
  const b = board(HAND_OK);
  const hit = logicSolve(b.n, b.clues);
  if (hit) {
    assert.equal(bruteOk(b.n, b.clues, Uint8Array.from(hit)), true, '纯逻辑推出来的盘不合法');
  }
  // 推不完就返回 null，绝不硬交一张半定的盘
  const hard = generate('logic:hard', 10);
  const r = logicSolve(hard.n, hard.clues);
  if (r) assert.equal(rulesOk(hard.n, clueMap(hard.n, hard.clues), Uint8Array.from(r)), true);
  else assert.equal(r, null);
});

for (const key of TIERS) test(`生成器说的唯一解，重数一遍还得是唯一解（${key}×${key}，40 颗种子）`, () => {
  const faces = new Set();
  let ms = 0, worst = 0;
  for (const seed of SEEDS(`gen${key}`, 40)) {
    const t0 = performance.now();
    const spec = generate(seed, key);
    ms += performance.now() - t0; worst = Math.max(worst, performance.now() - t0 - t0);
    assert.equal(spec.n, key);
    assert.equal(spec.kind, 'nurikabe');
    faces.add(spec.clues.map((c) => c.join('')).join(',') + '|' + spec.solution.join(''));
    const color = Uint8Array.from(spec.solution);
    assert.equal(bruteOk(spec.n, spec.clues, color), true, `${seed} 题面与答案不自洽（独立实现判的）`);
    assert.equal(rulesOk(spec.n, clueMap(spec.n, spec.clues), color), true, `${seed} 引擎自己都不认自己的答案`);
    const r = countSolutions(spec.n, spec.clues, { cap: 2, budget: 60000 });
    assert.equal(r.capped, false, `${seed} 这题没数完就端上桌了`);
    assert.equal(r.count, 1, `${seed} 数出 ${r.count} 个解`);
    assert.deepEqual(r.solution, spec.solution, `${seed} 数出来的解与发出去的题面不符`);
    assert.equal(spec.par, spec.solution.filter((c) => c === BLACK).length, 'par 不等于唯一解的墨格数');
    assert.equal(spec.par, spec.sum, '全盘墨数必须等于数字之和（一块一数字）');
    assert.equal(spec.blocks, spec.clues.length);
  }
  assert.equal(faces.size, 40, `${key}×${key} 四十颗种子只交出 ${faces.size} 道题`);
  assert.ok(ms / 40 < 400, `${key}×${key} 平均 ${(ms / 40).toFixed(0)}ms，手机上出题太慢`);
});

test('兜底题面也是一道真题：生成器哑火的最后一手得数得出唯一解', () => {
  for (const key of TIERS) {
    const spec = fallbackSpec('fb', key);
    assert.equal(spec.n, key);
    assert.equal(rulesOk(spec.n, clueMap(spec.n, spec.clues), Uint8Array.from(spec.solution)), true,
      `${key}×${key} 的兜底题面连自洽都不过`);
    const r = countSolutions(spec.n, spec.clues, { cap: 2, budget: 60000 });
    assert.equal(r.count, 1, `${key}×${key} 兜底数出 ${r.count} 个解`);
    assert.equal(r.capped, false, `${key}×${key} 兜底没数完`);
    assert.ok(spec.par > 0);
  }
});

test('同一颗种子在任何设备上得到同一道题，spec 过一遍 JSON 也不变味', () => {
  for (const key of TIERS) {
    const a = generate(`daily:2026-09-27|nurikabe`, key);
    const b = generate(`daily:2026-09-27|nurikabe`, key);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
    const copy = JSON.parse(JSON.stringify(a));
    const e = create(copy);
    assert.equal(e.stats().par, a.par);
    paintAll(e, copy);
    assert.equal(e.solved(), true, 'JSON 往返后就没法通关了');
  }
});

// 按答案把整盘落完：墨用主笔，海用副笔（打点），一格一动作
function paintAll(e, spec) {
  const n = spec.n;
  const fixed = new Set(spec.clues.map((c) => c[0]));
  for (let i = 0; i < n * n; i++) {
    if (fixed.has(i)) continue;
    const x = i % n, y = (i - x) / n;
    if (spec.solution[i] === BLACK) { e.down(x, y, 0); e.up(); }
    else { e.down(x, y, 1); e.up(); }
  }
}

test('引擎开局：数字格钉死为海且不给落子，其余格子一律未定', () => {
  const spec = generate('start:0', 7);
  const e = create(spec);
  assert.equal(e.board.cols, spec.n);
  assert.equal(e.board.rows, spec.n);
  assert.deepEqual(Object.keys(e.board.margin).sort(), ['b', 'l', 'r', 't']);
  const [i] = spec.clues[0];                       // clues 是 [[格号, 数字], …]
  const x = i % spec.n, y = (i - x) / spec.n;
  assert.equal(e.isGiven(x, y), true);
  assert.equal(e.clueAt(x, y), spec.clues[0][1]);
  // 数字格的"海"是外壳画上去的，引擎的 cellState 留给玩家落子记录：开局它谁都没染
  assert.equal(e.cellState(x, y), EMPTY);
  assert.equal(e.down(x, y, 0), false, '数字格竟然能落墨');
  assert.equal(e.down(x, y, 1), false, '数字格竟然能打点');
  assert.deepEqual(e.stats(), { moves: 0, par: spec.par, done: 0, total: spec.n * spec.n - spec.clues.length });
  assert.equal(e.solved(), false);
});

test('落墨收账、打点不收账，撤销与重做都不退款', () => {
  const spec = generate('moves:1', 7);
  const n = spec.n;
  const at = (i) => [i % n, (i - i % n) / n];
  const clueSet = new Set(spec.clues.map((c) => c[0]));
  const inks = spec.solution.map((c, i) => i).filter((i) => spec.solution[i] === BLACK).slice(0, 3);
  const seas = spec.solution.map((c, i) => i).filter((i) => spec.solution[i] === WHITE && !clueSet.has(i)).slice(0, 2);
  assert.equal(inks.length, 3);
  assert.equal(seas.length, 2);
  const e = create(spec);
  for (const i of inks) { assert.equal(e.down(...at(i), 0), true); e.up(); }
  assert.equal(e.stats().moves, 3, '三滴墨该收三笔账');
  assert.equal(e.stats().done, 3);
  e.down(...at(inks[0]), 0); e.up();                      // 再点一下同一格 = 擦掉
  assert.equal(e.cellState(...at(inks[0])), EMPTY);
  assert.equal(e.stats().moves, 3, '擦格子是反悔，不许再收一笔');
  assert.equal(e.down(...at(inks[0]), 0), true);          // 又落回来：这一笔重新付
  assert.equal(e.stats().moves, 4);
  const dots = e.stats().moves;
  assert.equal(e.down(...at(seas[0]), 1), true);          // 副笔打点
  e.up();
  assert.equal(e.cellState(...at(seas[0])), WHITE, '副笔该把格子标成确认为海');
  assert.equal(e.stats().moves, dots, '打点是记号，不许收落子的账');
  const done = e.stats().done;
  assert.equal(done, 4, '三滴墨 + 一个点 = 四格落定');
  assert.equal(e.undo(), true, '打点也得能撤');
  assert.equal(e.stats().done, done - 1);
  assert.equal(e.stats().moves, dots, '撤销把打点退回去了，账却没退');
  assert.equal(e.canRedo(), true, '刚撤的那一步必须还能重做');
  assert.equal(e.redo(), true);
  assert.equal(e.stats().done, done);
  assert.equal(e.stats().moves, dots, '重做不许另收一笔');
  assert.equal(e.canUndo(), true);
  assert.equal(e.canRedo(), false, '重做用完了历史，redo 栈就该空了');
  while (e.undo()) ;
  assert.equal(e.stats().done, 0);
  assert.equal(e.stats().moves, dots, '把整条历史撤销干净，账也该留着');
});

test('拖动一路落墨，每格恰好一笔账', () => {
  const spec = generate('drag:0', 8);
  const e = create(spec);
  const ink = spec.solution.map((c, i) => [c, i]).filter(([c]) => c === BLACK).slice(0, 4).map(([, i]) => i);
  const at = (i) => [i % spec.n, (i - (i % spec.n)) / spec.n];
  e.down(...at(ink[0]), 0);
  for (const i of ink.slice(1)) e.move(...at(i));
  e.up();
  assert.equal(e.stats().moves, ink.length);
  for (const i of ink) assert.equal(e.cellState(...at(i)), BLACK);
  // 副笔起手不许被拖动一路带走
  const other = spec.solution.map((c, i) => i).filter((i) => spec.solution[i] === WHITE && !spec.clues.some(([k]) => k === i))[0];
  e.down(...at(other), 1);
  assert.equal(e.move(...at(other === 0 ? 1 : 0)), false, '打点不该拖出一条');
  e.up();
});

test('照着答案落满全盘才算赢，缺一格、错一格都不算', () => {
  const spec = generate('win:0', 7);
  const e = create(spec);
  paintAll(e, spec);
  assert.equal(e.solved(), true);
  const st = e.stats();
  assert.equal(st.done, st.total);
  assert.equal(st.moves, spec.par, '照答案落墨的步数就该等于 par');
  // 判胜之后锁盘
  assert.equal(e.down(0, 0, 0), false, '赢了还能改盘');
  assert.equal(e.move(1, 1), false);
  assert.equal(e.hint(), null);
  // 差一格不算赢
  const f = create(spec);
  const cells = [];
  for (let i = 0; i < spec.n * spec.n; i++) if (!spec.clues.some(([k]) => k === i)) cells.push(i);
  for (const i of cells.slice(0, cells.length - 1)) {
    const x = i % spec.n, y = (i - x) / spec.n;
    f.down(x, y, spec.solution[i] === BLACK ? 0 : 1); f.up();
  }
  assert.equal(f.solved(), false, '还有一格没定，怎么就赢了');
  // 全盘落满但落错：不算赢，而且必须报出问题格子
  const g = create(spec);
  const wrong = Uint8Array.from(spec.solution);
  const flip = cells.find((i) => wrong[i] === BLACK);
  wrong[flip] = WHITE;
  for (const i of cells) {
    const x = i % spec.n, y = (i - x) / spec.n;
    g.down(x, y, wrong[i] === BLACK ? 0 : 1); g.up();
  }
  assert.equal(g.solved(), false, '一张错盘竟然判胜');
  assert.ok(g.badCells().length > 0, '全盘矛盾却一个红点都不给');
});

test('badCells 只冤枉真矛盾的格子', () => {
  const spec = generate('bad:0', 7);
  const n = spec.n;
  const at = (i) => [i % n, (i - i % n) / n];
  const keys = (list) => list.map(([x, y]) => y * n + x).sort((a, b) => a - b).join(',');
  // 挑一个"邻居比自己的数字多"的数字格：全滴成墨才叫犯到题面头上
  let ci = -1, freeInk = [];
  for (const [k, v] of spec.clues) {
    const x = k % n, y = (k - x) / n;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && !spec.clues.some(([c]) => c === b * n + a));
    if (nb.length > v + 1) { ci = k; freeInk = nb.map(([a, b]) => b * n + a); break; }
  }
  assert.ok(ci >= 0, '这道题没有一个数字格犯得起"多滴一滴墨"，换一颗种子');
  const e = create(spec);
  assert.deepEqual(e.badCells(), [], '空盘不许报任何格子');
  for (const i of freeInk) { e.down(...at(i), 0); e.up(); }
  assert.ok(keys(e.badCells()).split(',').includes(String(ci)), `滴满 ${freeInk.length} 墨之后还不点它？`);
  for (const i of freeInk) { e.down(...at(i), 0); e.up(); }                // 再点一遍：全擦干净
  assert.ok(!keys(e.badCells()).split(',').filter(Boolean).includes(String(ci)), '矛盾解除了还红着');
  // 按答案落满全盘：一条都不许红
  const f = create(spec);
  paintAll(f, spec);
  assert.deepEqual(f.badCells(), [], '正解落盘却被报错');
  // 挑一个只差一滴墨就全海的 2×2：把那滴墨打成海，四个格子都该被点出来
  const g = create(spec);
  let quad = null;
  const isClue = (i) => spec.clues.some(([c]) => c === i);
  for (let y = 0; y + 1 < n && !quad; y++) for (let x = 0; x + 1 < n && !quad; x++) {
    const w = [idx(n, x, y), idx(n, x + 1, y), idx(n, x, y + 1), idx(n, x + 1, y + 1)];
    // 四格里恰好一滴墨、其余三格是普通海格：把四格全打成海，这一片就成了全海 2×2
    if (w.filter((i) => spec.solution[i] === BLACK).length === 1 && w.filter((i) => isClue(i)).length === 0) quad = w;
  }
  assert.ok(quad, '这道题找不到"只靠一滴墨撑着"的 2×2，换一颗种子');
  for (const i of quad) { g.down(...at(i), 1); g.up(); }
  const flagged = keys(g.badCells()).split(',');
  for (const i of quad) assert.ok(flagged.includes(String(i)), `抹掉那滴墨，2×2 全海却漏了格子 ${i}`);
});

test('提示一格一格推得动，一路点下去能点到通关', () => {
  for (const key of [7, 8]) {
    const spec = generate(`hint:${key}`, key);
    const e = create(spec);
    let guard = 0;
    while (!e.solved() && guard++ < 600) {
      const before = e.stats().done;                     // hint 自己动手落子（契约：必须真的改动状态）
      const h = e.hint();
      assert.ok(h, `第 ${guard} 次提示撒手，盘却还没解完`);
      assert.equal(Array.isArray(h.cells) && h.cells.length >= 1, true, 'hint 得指出格子');
      assert.equal(typeof h.note, 'string');
      assert.ok(e.stats().done > before, `hint 报的格子没让盘面动一步 ${JSON.stringify(h.cells)}`);
      for (const [x, y] of h.cells) {
        assert.equal(e.cellState(x, y), spec.solution[y * spec.n + x],
          `hint 落下去的格子与唯一解不符：${x},${y} 落成 ${e.cellState(x, y)}，答案却是 ${spec.solution[y * spec.n + x]}`);
      }
    }
    assert.ok(guard < 600, `点了 ${guard} 次还没通关`);
    assert.equal(e.solved(), true);
    assert.equal(e.hint(), null, '通关之后不许再给提示');
  }
});

test('提示不许把整道题一次点完：它一次只往前走一小步', () => {
  const spec = generate('hint-one:0', 7);
  const e = create(spec);
  const h = e.hint();
  assert.ok(h);
  assert.ok(h.cells.length < spec.n * spec.n, '一次提示就把全盘点满，玩家还玩什么');
  assert.equal(e.stats().done, h.cells.length, '一次提示落了几格，进度就该走几格');
  const dots = e.stats().moves;
  e.hint();
  assert.ok(e.stats().moves >= dots, '提示不许倒退款');
});

test('引擎不碰时钟也不碰随机数：模块里不许出现 Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/nurikabe.js', import.meta.url), 'utf8'));
  assert.equal(/Math\.random/.test(src), false, '引擎里出现 Math.random：同一颗种子就不再是同一道题了');
  assert.equal(/\bnew Date\b/.test(src), false, '引擎不许读当前时间');
  assert.equal(/document\.|localStorage|window\./.test(src), false, '引擎不许碰 DOM 与存档');
});

test('draw 只要一个空壳上下文就能画完一帧，通关动画也不炸', async () => {
  const spec = generate('draw:0', 7);
  const e = create(spec);
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'canvas') return { width: 420, height: 420 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return () => ({ addColorStop: () => {} });
      }
      if (k === 'setLineDash' || k === 'save' || k === 'restore') return () => {};
      return (...args) => { calls.push(k); };
    },
    set() { return true; },
  });
  const v = { cell: 40, ox: 8, oy: 8, cols: spec.n, rows: spec.n, w: 420, h: 420, dpr: 2, hover: { x: 1, y: 1 }, bad: [], reduce: false };
  paintAll(e, spec);
  e.draw(ctx, v, 1000);
  assert.ok(calls.length > 20, '一帧什么都没画');
  if (e.celebrate) e.celebrate(ctx, v, 1000, 0.5);
});

test('出题在手机上不卡：每档十道题各有预算', () => {
  const BUDGET = { 7: 1500, 8: 2500, 10: 6000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`t${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < BUDGET[key], `${key}×${key} 十道题花了 ${ms}ms，超过 ${BUDGET[key]}ms`);
  }
});
