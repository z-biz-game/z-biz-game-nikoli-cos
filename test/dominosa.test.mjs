// 数邻的四道保险（与帐篷/数间同一立场）：
//   1) 出题器不许说谎 —— 交出来的题必须被 countSolutions 数到"恰好一种切法"且没烧穿预算；
//      capped 永远不等于唯一，也永远不等于无解；撞预算的盘当场丢掉，绝不端上桌。
//   2) 规则层与求解器互不引用 —— 本文件自带一份独立实现：myCheck 直接照白话规则数一遍，
//      myCount 把全盘所有骨牌铺法穷举出来再数合格的（不做任何数对剪枝）。拿它跟 validate /
//      countSolutions 对拍，谁多认一张盘都当场露馅。
//   3) 提示不许说谎 —— 每张题面交给 hint() 循环用到通关，每一步交出的两块必须与 spec.solution
//      的配对一致（越轨必须 0 条），note 得说清是哪条规则给的：P1/P2/P4/反证/答案。
//   4) 引擎是纯状态机 —— 只用公开 API 走子。落一块骨牌收一步，擦掉与副笔划线都不收账，
//      撤销与重做都不退款；"照解走一遍 moves 恰好等于 par"必须真的走得通（不然三星是装饰）。
//
// 本机实跑的读数（node 26，每档 40 颗 seed，量法见工作区根的 _tmp-dominosa-readings.mjs）：
//   墙钟/张：4×5 p50 0.20 · p95 0.55（max 2.9）ms｜6×7 0.37 / 2.59（max 4.3）｜8×9 12.7 / 39.6（max 83.9）
//   对调次数 p50：10 / 14 / 25（p95 24 / 43 / 95，上限 27 / 50 / 119）· 计数器撞预算 0 次
//   纯铅笔（P1+P2+P4）推满全盘：95% / 60% / 40% · 照解走一遍 moves === par：40/40 每档
//   提示命中：P1 370/668/1125 · P2 24/136/259 · P4 3/9/5 · 反证 3/27/51 · 答案 0/0/0 · 越轨 0 条
//   —— 答案那一级在这三档各 40 颗 seed 里一次都没逼出来（反证都收住了），所以它由下面
//      "三条铅笔与一层反证都收不住"那条测试用一张手摆 2×3 单独覆盖，而不是在 fuzz 里假装覆盖到。
//      fuzz 自己会往 stdout 打一行本档实测命中（seed 集合与上面不同，数字略有出入）。
//   下面几条绝对毫秒只当"算法塌成指数"的保险丝，钉的是量级不是负载（同一份代码在本机与
//   CI 那台 4 核上实测差到几十倍，这条仓库已经在 verify.sh 的坑记录里吃过一次）。

import test from 'node:test';
import assert from 'node:assert/strict';
import dominosa, {
  generate, create, validate, logicSolve, countSolutions, plant, labelNums, frozenSpec, tierOf, FREE,
} from '../js/puzzles/dominosa.js';
import { rngFrom } from '../js/core/rng.js';

const TIERS = dominosa.sizes.map((s) => s.key);
const SEEDS = (tag, k = 10) => Array.from({ length: k }, (_, i) => `${tag}|${i}`);

// ---- 独立实现：只认"盘多大、数字是几"，一行都不 import 引擎的候选池 -----------------------

// 白话规则数一遍：切法要铺满全盘、每块是横竖相邻的两格、无序数对（含双数）恰好各出现一次。
function myCheck(spec, blocks) {
  const { w, h } = spec;
  const total = w * h;
  const at = (x, y) => y * w + x;
  const owner = new Int16Array(total).fill(FREE);
  const want = new Set();
  for (let a = 0; a < spec.k; a++) for (let b = a; b < spec.k; b++) want.add(`${a}-${b}`);
  const got = [];
  for (const [i, j] of blocks) {
    if (i < 0 || j < 0 || i >= total || j >= total) return false;
    if (owner[i] !== FREE || owner[j] !== FREE) return false;         // 一格不许进两块
    const xi = i % w;
    const yi = (i - xi) / w;
    const xj = j % w;
    const yj = (j - xj) / w;
    if (Math.abs(xi - xj) + Math.abs(yi - yj) !== 1) return false;     // 不是 1×2 也不是 2×1
    owner[i] = j;
    owner[j] = i;
    const a = spec.nums[i];
    const b = spec.nums[j];
    got.push(a <= b ? `${a}-${b}` : `${b}-${a}`);
  }
  for (let i = 0; i < total; i++) if (owner[i] === FREE) return false;  // 铺满：一格不许剩
  if (got.length !== total / 2) return false;
  const left = new Set(want);
  for (const p of got) {
    if (!left.has(p)) return false;                                     // 重号或凭空多出一对
    left.delete(p);
  }
  return left.size === 0;
}

// 独立计数：把全盘所有骨牌铺法穷举出来（不做数对剪枝），再拿 myCheck 挑出合格的。
// 只用在 4×5 这种规模上人眼也数得清的盘上。
function myCount(spec, cap = 2) {
  const total = spec.w * spec.h;
  const taken = new Uint8Array(total);
  const blocks = [];
  let hits = 0;
  const walk = () => {
    let i = 0;
    while (i < total && taken[i]) i++;
    if (i === total) {
      if (myCheck(spec, blocks.slice())) hits++;
      return hits >= cap;
    }
    const x = i % spec.w;
    const y = (i - x) / spec.w;
    const tries = [];
    if (x + 1 < spec.w) tries.push(i + 1);
    if (y + 1 < spec.h) tries.push(i + spec.w);
    for (const j of tries) {
      if (taken[j]) continue;
      taken[i] = 1;
      taken[j] = 1;
      blocks.push([i, j]);
      const stop = walk();
      blocks.pop();
      taken[i] = 0;
      taken[j] = 0;
      if (stop) return true;
    }
    return false;
  };
  walk();
  return hits;
}

const flatToBlocks = (spec) => {
  const out = [];
  for (let i = 0; i < spec.solution.length; i++) {
    const j = spec.solution[i];
    if (j > i) out.push([i, j]);
  }
  return out;
};

// 手摆盘：2×3（k=2，数对只有 1-1 / 1-2 / 2-2 三张）。格子按读序记作
//   a=1 b=1 / c=2 d=2 / e=1 f=2
// 横切 {ab,cd,ef} 与"上横 + 下两竖" {ab,ce,df} 都各数齐三对 ⇒ 天生两解，绝不能出题。
const HAND_TWO = (() => {
  const k = 2;
  const w = 2;
  const h = 3;
  const nums = [0, 0, 1, 1, 0, 1];
  const solution = new Array(w * h).fill(FREE);
  const set = (i, j) => { solution[i] = j; solution[j] = i; };
  set(0, 1); set(2, 4); set(3, 5);
  return { kind: 'dominosa', k, w, h, nums, solution, par: 3, count: 2, capped: false, seed: 'hand', tier: '手摆' };
})();

// 一解的手摆盘：2 1 / 1 2 / 1 2。三种铺法里只有 {ab,ce,df} 数得齐三对
// （{ab,cd,ef} 出两块 2-1、{ac,bd,ef} 里 bd 与 ef 同号），人眼三行就能验算。
const HAND_ONE = (() => {
  const nums = [1, 0, 0, 1, 0, 1];
  const solution = new Array(6).fill(FREE);
  const set = (i, j) => { solution[i] = j; solution[j] = i; };
  set(0, 1); set(2, 4); set(3, 5);
  return { kind: 'dominosa', k: 2, w: 2, h: 3, nums, solution, par: 3, count: 1, capped: false, seed: 'hand', tier: '手摆' };
})();

// 三层铅笔 + 一层反证都收不住的手摆盘：2 1 / 2 1 / 2 1。
// 2-1 有三处落点、2-2 与 1-1 各两处 ⇒ P1 开不了口；P4 只能划掉 cd（划完还剩两处，落不了子）；
// 两种切法 {ab,ce,df} 与 {ac,bd,ef} 各自都推得满 ⇒ 反证也判不了谁活。只剩答案可交。
const HAND_STUCK = (() => {
  const nums = [1, 0, 1, 0, 1, 0];
  const solution = new Array(6).fill(FREE);
  const set = (i, j) => { solution[i] = j; solution[j] = i; };
  set(0, 1); set(2, 4); set(3, 5);
  return { kind: 'dominosa', k: 2, w: 2, h: 3, nums, solution, par: 3, count: 2, capped: false, seed: 'hand', tier: '手摆' };
})();

// ---- 1. 题面口径 ------------------------------------------------------------------------

test('kind 描述符齐三件，档位表就是三档（不许有 10×11）', () => {
  assert.equal(dominosa.id, 'dominosa');
  assert.equal(dominosa.title, '数邻');
  assert.equal(dominosa.latin, 'DOMINOSA');
  assert.ok(dominosa.tagline);
  assert.equal(dominosa.unit, '块');
  assert.equal(dominosa.rules.length, 5);
  for (const r of dominosa.rules) assert.ok(r.length > 6);
  assert.deepEqual(dominosa.sizes, [
    { key: 4, label: '4×5', tier: '入门' },
    { key: 6, label: '6×7', tier: '进阶' },
    { key: 8, label: '8×9', tier: '高手' },
  ]);
  assert.deepEqual(TIERS, [4, 6, 8]);
  for (const s of dominosa.sizes) assert.equal(String(tierOf(s.key).key), String(s.key));
  assert.equal(String(tierOf('nonsense').key), '4', '乱写的档位要有落点');
  assert.equal(typeof dominosa.generate, 'function');
  assert.equal(typeof dominosa.create, 'function');
});

test('题面口径：盘是 k×(k+1)，数字是 1..k，par 是骨牌张数', () => {
  for (const key of TIERS) {
    const spec = generate(`face:${key}`, key);
    assert.equal(spec.kind, 'dominosa');
    assert.equal(spec.k, key);
    assert.equal(spec.w, key);
    assert.equal(spec.h, key + 1);
    assert.equal(spec.nums.length, key * (key + 1));
    assert.equal(spec.solution.length, key * (key + 1));
    assert.ok(spec.nums.every((n) => n >= 0 && n < key), '内部数字必须 0-based 且落在 1..k');
    assert.equal(spec.par, (key * (key + 1)) / 2);
    assert.equal(spec.dominoes.length, spec.par);
    const e = create(spec);
    assert.deepEqual(e.board, { cols: key, rows: key + 1, margin: { l: 0, t: 0, r: 0, b: 0 } },
      '题面没有行列提示，margin 就该是 0');
    assert.equal(e.numberAt(0, 0), spec.nums[0] + 1, '画出来的数字得是 1..k');
    assert.ok(e.layoutIn({ w: 1000, h: 1000 }) >= 16);
    // 与外壳 board_view.layout() 同一条式子：可用边长先扣 2px 画布留白，再按 cols/rows 分
    const cell = e.layoutIn({ w: 800, h: 600 });
    assert.ok(Math.abs(cell - Math.min((800 - 2) / key, (600 - 2) / (key + 1))) < 1e-6,
      `${key}×${key + 1} 的 layoutIn 与外壳口径不符：${cell}`);
    assert.equal(e.layoutIn({ w: 20, h: 20 }), Math.max(16, Math.min(120 / key, 120 / (key + 1))),
      '盒子再小也得被 120 的下限与 16px 的格宽托住');
  }
});

test('validate 逐条咬合：拆一块、重号、留空、斜着配都不算', () => {
  const spec = generate('validate:0', 4);
  const blocks = flatToBlocks(spec);
  assert.equal(validate(spec, spec.solution), true, '引擎不认自己的解');
  assert.equal(myCheck(spec, blocks), true, '独立实现反倒不认');
  assert.equal(validate(spec, blocks), true, '骨牌清单 [[i,j],…] 喂不进去');
  assert.equal(validate(spec, spec.dominoes), true, '骨牌清单 [x1,y1,x2,y2]（spec.dominoes 的形状）喂不进去');
  assert.equal(validate(spec, spec.dominoes.map(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]])), true,
    '骨牌清单 [[x1,y1],[x2,y2]] 喂不进去');
  // 故意拆掉一块：留两格空着
  assert.equal(validate(spec, blocks.slice(1)), false, '少一块还判合法');
  assert.equal(myCheck(spec, blocks.slice(1)), false, '独立实现对少一块的盘点头');
  // 把一块挪一格：既有空格又有重号
  const moved = blocks.slice(1).concat([[blocks[1][0] + 1, blocks[1][1] + 1]]);
  assert.equal(validate(spec, moved), false, '挪了一块还判合法');
  assert.equal(myCheck(spec, moved), false);
  // 一格进两块
  const twice = blocks.slice();
  twice[1] = [twice[0][0], twice[1][1]];
  assert.equal(validate(spec, twice), false, '一格两主还判合法');
  assert.equal(myCheck(spec, twice), false);
  // 空盘、缺一格的扁平解
  assert.equal(validate(spec, []), false);
  assert.equal(validate(spec, spec.solution.map((v, i) => (i === 0 ? FREE : v))), false);
});

// ---- 2. 两层实现对拍 ---------------------------------------------------------------------

test('对拍：生成盘 + 挖一格反例，两层判到合法的必须是同一批', () => {
  let n = 0;
  for (const key of TIERS) {
    for (const seed of SEEDS(`cross:${key}`, 6)) {
      const spec = generate(seed, key);
      const blocks = flatToBlocks(spec);
      assert.equal(validate(spec, spec.solution), myCheck(spec, blocks), `${seed} 两层判得不一致`);
      assert.equal(myCheck(spec, blocks), true, `${seed} 出题器发的解不合法`);
      n++;
      const broken = blocks.slice(0, -1).concat([[blocks[blocks.length - 1][0], blocks[blocks.length - 1][1] + (spec.k % spec.w ? spec.w : 1)]]);
      assert.equal(myCheck(spec, broken), false, `${seed} 挪了一块独立实现还在点头`);
      assert.equal(validate(spec, broken), false, `${seed} 挪了一块引擎还在点头`);
      n++;
    }
  }
  assert.equal(n, 36, '对拍条数对不上：三档 × 六颗 seed × 两类断言（正解 + 挪一块）');
});

test('计数对拍：4×5 的每题都用无剪枝穷举再数一遍', () => {
  assert.equal(countSolutions(HAND_TWO, 2, null, 200000).count, myCount(HAND_TWO, 99), '手摆两解盘两层数出的不一样');
  assert.equal(myCount(HAND_TWO, 99), 2, '2×3 那张盘明摆着两种切法');
  assert.equal(myCount(HAND_ONE, 99), 1, '一解的手摆盘被独立穷举数成了几个？');
  assert.equal(countSolutions(HAND_ONE, 2, null, 200000).count, myCount(HAND_ONE, 99), '一解的手摆盘两层数出的不一样');
  assert.equal(validate(HAND_ONE, HAND_ONE.solution), true);
  assert.equal(validate(HAND_TWO, [[0, 1], [2, 3], [4, 5]]), true, '两解盘的第二种切法该也被认下来');
  for (const seed of SEEDS(`brute4`, 12)) {
    const spec = generate(seed, 4);
    const c = countSolutions(spec, 2, null, 400000);
    assert.equal(c.capped, false, `${seed} 4×5 都数不完？`);
    assert.equal(c.count, 1);
    assert.equal(myCount(spec, 99), 1, `${seed} 独立穷举数出的不是 1 个解`);
  }
  // 多解的盘必须报多解，不许被"唯一性保险丝"糊过去
  const two = countSolutions(HAND_TWO, 2, null, 200000);
  assert.equal(two.count, 2);
  assert.equal(two.capped, false);
  assert.equal(logicSolve(HAND_TWO).solved, false, '两种切法的盘被一遍推完了 —— 那证明是假的');
  assert.equal(logicSolve(HAND_TWO).open > 0, true);
  // 没数完不等于只有一种解
  const starved = countSolutions(generate('starve:4', 4), 2, null, 1);
  assert.equal(starved.capped, true, '一个节点就烧穿了却报数完了');
  assert.notEqual(starved.count, 1, '没数完却敢报"唯一解"');
  // 推得满全盘的题，数解不必分支：节点的用量与 logicSolve 的结论互相印证
  const quick = countSolutions(generate('quick:4', 4), 2, null, 64);
  assert.equal(quick.count, 1);
  assert.equal(quick.capped, false);
});

test('生成不变量：种下的那套铺法永远是一个解（对调数字破坏不了它）', () => {
  for (const key of TIERS) {
    for (const seed of SEEDS(`plant:${key}`, 8)) {
      const rng = rngFrom(seed);
      const dom = plant(key, key + 1, rng);
      assert.ok(dom, `${seed} 种不出铺满的骨牌`);
      assert.equal(dom.length, key * (key + 1) / 2);
      const nums = labelNums(key, dom, rng);
      const spec = { kind: 'dominosa', k: key, w: key, h: key + 1, nums: Array.from(nums) };
      const blocks = dom.map((d) => [d[0], d[1]]);
      assert.equal(myCheck(spec, blocks), true, `${seed} 长出来的解本身不合法`);
      assert.equal(validate({ ...spec, solution: Array.from(nums) }, blocks), true, `${seed} 引擎不认这套配对`);
      const c = countSolutions(spec, 2, null, 400000);
      assert.ok(c.count >= 1 || c.capped, `${seed} 数解器把种下的解弄丢了`);
    }
  }
});

// ---- 3. 每档 40 颗 seed 的 fuzz -----------------------------------------------------------

const TAGS = ['P1', 'P2', 'P4', '反证', '答案', '擦掉'];

test('fuzz：每档 40 颗 seed —— 唯一、自洽、提示零越轨、照解走一遍 moves === par', () => {
  for (const key of TIERS) {
    const faces = new Set();
    const seen = Object.fromEntries(TAGS.map((t) => [t, 0]));
    let offTrack = 0;
    let parHits = 0;
    let logicFull = 0;
    let capped = 0;
    for (const seed of SEEDS(`fuzz:${key}`, 40)) {
      const spec = generate(seed, key);
      // ① 唯一性：数到 1 且没撞预算；spec 里那两个字段就是这条纪律的凭据
      const audit = countSolutions(spec, 2, null, 400000);
      assert.equal(audit.count, 1, `${key}/${seed} 数出 ${audit.count} 个解还交了题`);
      assert.equal(audit.capped, false, `${key}/${seed} 没数完就发了题`);
      assert.equal(spec.count, 1, `${key}/${seed} 没把审计结果写进 spec`);
      assert.equal(spec.capped, false, `${key}/${seed} 把 capped 端上桌`);
      if (spec.rescued) assert.fail(`${key}/${seed} 走了兜底：这一档的出题循环出不来题`);
      capped += spec.cappedTries;
      // ② validate 判真；故意拆掉一块之后判假
      const blocks = flatToBlocks(spec);
      assert.equal(validate(spec, spec.solution), true, `${key}/${seed} 题面与答案不自洽`);
      assert.equal(myCheck(spec, blocks), true, `${key}/${seed} 独立实现不认这道解`);
      assert.equal(validate(spec, blocks.slice(1)), false, `${key}/${seed} 少一块还算赢`);
      assert.equal(myCheck(spec, blocks.slice(1)), false);
      // ③ 提示用到通关：每一步的两块必须与 spec.solution 的配对一致
      const e = create(spec);
      let guard = 0;
      while (!e.solved()) {
        const before = e.stats().done;
        const h = e.hint();
        assert.ok(h, `${key}/${seed} 第 ${guard} 次提示撒手，盘却还没铺满`);
        assert.equal(h.cells.length, 2, `${key}/${seed} 一次提示落了 ${h.cells.length} 格，不是一块骨牌`);
        assert.ok(e.canUndo(), `${key}/${seed} 提示没进撤销栈`);
        assert.equal(e.stats().done, before + 1, `${key}/${seed} 提示没真的落一块`);
        const tag = /^(P1|P2|P4|反证|答案|擦掉)/.exec(h.note);
        assert.ok(tag, `${key}/${seed} 提示没说清是哪条规则给的：${h.note}`);
        seen[tag[1]]++;
        const [p, q] = h.cells;
        const pi = p[1] * spec.w + p[0];
        const qi = q[1] * spec.w + q[0];
        if (spec.solution[pi] !== qi || spec.solution[qi] !== pi) {
          offTrack++;
          console.log(`越轨 ${key}/${seed}: ${JSON.stringify(h.cells)} ← ${h.note}`);
        }
        for (const [x, y] of h.cells) assert.ok(x >= 0 && y >= 0 && x < spec.w && y < spec.h, `${key}/${seed} 提示越界`);
        if (++guard > 400) assert.fail(`${key}/${seed} 提示打转打不完（${guard} 次）`);
      }
      assert.equal(e.hint(), null, '通关之后不许再给提示');
      // ④ 照解走一遍：点两下成交一块，moves 恰等于 par
      const f = create(spec);
      for (const [x1, y1, x2, y2] of spec.dominoes) { f.down(x1, y1, 0); f.down(x2, y2, 0); }
      assert.equal(f.solved(), true, `${key}/${seed} 照解点两下点不通`);
      assert.deepEqual(f.stats(), { moves: spec.par, par: spec.par, done: spec.par, total: spec.par },
        `${key}/${seed} 的 moves 与 par 不同：三星那条路走不通`);
      if (f.stats().moves === f.stats().par) parHits++;
      // ⑤ 题面互不重样 + spec 过 JSON 不变味
      faces.add(spec.nums.join(''));
      assert.deepEqual(JSON.parse(JSON.stringify(spec)), spec, `${key}/${seed} spec 过一遍 JSON 就变味了`);
      if (spec.logicOnly) logicFull++;
    }
    assert.equal(offTrack, 0, `${key}×${key + 1} 出现 ${offTrack} 条越轨提示（必须 0）`);
    assert.equal(parHits, 40, `${key}×${key + 1} 只有 ${parHits}/40 张题照解走得通`);
    assert.equal(faces.size, 40, `${key}×${key + 1} 四十颗 seed 只交出 ${faces.size} 道题`);
    assert.equal(capped, 0, `${key}×${key + 1} 这批 seed 撞了 ${capped} 次数解除预算`);
    // 三级铅笔 + 反证都必须在 fuzz 里真的出现过（本机实测 P1/P2/P4/反证 三档都有命中）
    for (const tag of ['P1', 'P2', 'P4', '反证']) {
      assert.ok(seen[tag] > 0, `${key}×${key + 1} 这批 40 颗 seed 里 ${tag} 一次都没出现：这条断言是空的（不是覆盖，是缺口）`);
    }
    // 答案那一級：三档各 40 颗 seed 都没逼出来（反证都收住了）—— 如实记下，不当已覆盖。
    // 它由下面「两解手摆盘」那条单独验，见 test 名『再卡住就交出唯一解里的一块』。
    test.diagnostic?.(`${key}×${key + 1} fuzz 命中 ${JSON.stringify(seen)}，纯铅笔推满 ${logicFull}/40`);
    console.log(`[${key}×${key + 1}] 提示命中 ${JSON.stringify(seen)} · 越轨 0 · 纯铅笔推满 ${logicFull}/40 · 撞预算 ${capped}`);
  }
});

test('确定性：同 seed 同档位两次 generate 逐字节同题，换 seed 就换题', () => {
  for (const key of TIERS) {
    const a = JSON.stringify(generate(`daily:2026-09-27|dominosa`, key));
    for (let k = 0; k < 2; k++) {
      assert.equal(JSON.stringify(generate(`daily:2026-09-27|dominosa`, key)), a, `${key} 第 ${k} 次还原不出同一道题`);
    }
    assert.notEqual(JSON.stringify(generate(`daily:2026-09-28|dominosa`, key)), a, `${key} 换日期却没换题`);
    // JSON 往返之后照样能玩、能判胜
    const spec = JSON.parse(a);
    const e = create(spec);
    for (const [x1, y1, x2, y2] of spec.dominoes) { e.down(x1, y1, 0); e.down(x2, y2, 0); }
    assert.equal(e.solved(), true, 'JSON 往返之后就通不了关');
    assert.equal(e.stats().moves, e.stats().par);
  }
});

// 每日档位的轮转不在这里复算：接线之前这条是照 registry 的公式手抄一遍的自证 —— registry.js 改了
// 公式它照样绿，生产却在轮转别的东西。现在由 test/registry.test.mjs 拿真实的 dailySpec() 对每个
// KINDS 成员断言（『档位真的在轮转』+『加玩法不改别人的排期』两条），dominosa 一注册就自动在内。

// ---- 4. 手势与账本 ------------------------------------------------------------------------

test('主笔两步一块：落子收账、擦掉不退账、非邻格只换锚点', () => {
  const spec = generate('gestures:0', 4);
  const e = create(spec);
  const [x1, y1, x2, y2] = spec.dominoes[0];
  assert.equal(e.down(x1, y1, 0), false, '选锚点本身不算改动');
  assert.deepEqual(e.selected(), [x1, y1]);
  assert.equal(e.stats().moves, 0);
  assert.equal(e.down(x2, y2, 0), true, '点邻格没成交');
  assert.deepEqual(e.stats(), { moves: 1, par: spec.par, done: 1, total: spec.par });
  assert.equal(e.selected(), null);
  const i1 = y1 * spec.w + x1;
  const i2 = y2 * spec.w + x2;
  assert.equal(e.cellState(x1, y1), i2, '锚点没记下它的搭档');
  assert.equal(e.cellState(x2, y2), i1, '搭档没回头认锚点');
  assert.equal(e.partnerAt(x1, y1), i2);
  assert.equal(e.numberAt(x1, y1), spec.nums[i1] + 1, '题面数字得按 1..k 印');
  // 再点其中一格 = 整块擦掉，账不退
  assert.equal(e.down(x2, y2, 0), true);
  assert.equal(e.cellState(x1, y1), FREE);
  assert.equal(e.cellState(x2, y2), FREE);
  assert.equal(e.stats().done, 0);
  assert.equal(e.stats().moves, 1, '擦掉是反悔，不许再收一笔，也不许退账');
  // 点非邻格 = 换锚点
  const far = spec.dominoes[2];
  e.down(x1, y1, 0);
  assert.equal(e.down(far[0], far[1], 0), false);
  assert.deepEqual(e.selected(), [far[0], far[1]]);
  assert.equal(e.stats().moves, 1);
  // 越界与拖动
  assert.equal(e.down(-3, 5, 0), false);
  assert.equal(e.down(0, spec.h + 9, 1), false);
  const f = create(spec);
  f.down(x1, y1, 0);
  assert.equal(f.move(x2, y2), true, '从锚点拖到邻格没成交');
  assert.equal(f.stats().moves, 1);
  assert.equal(f.move(0, 0), false);
  assert.equal(f.up(), false);
});

test('副笔划线：不收账、可撤销，而且真的参与 P1 的候选排除', () => {
  const e = create(generate('ban:0', 4));
  const [x1, y1, x2, y2] = e.spec.dominoes[0];
  assert.equal(e.down(x1, y1, 0), false);
  assert.equal(e.down(x2, y2, 1), true, '副笔两步没划出线');
  assert.equal(e.isBanned(x1, y1, x2, y2), true);
  assert.equal(e.stats().moves, 0, '记事不是落子，不许收账');
  assert.equal(e.canUndo(), true);
  e.undo();
  assert.equal(e.isBanned(x1, y1, x2, y2), false, '撤销没把界线退掉');
  e.redo();
  assert.equal(e.isBanned(x1, y1, x2, y2), true, '重做没还原界线');
  assert.equal(e.stats().moves, 0, '重做另收了一次钱');
  // 界线与锚点无关：再点一次同一对相邻格 = 擦掉界线
  e.down(x1, y1, 0);
  e.down(x2, y2, 1);
  assert.equal(e.isBanned(x1, y1, x2, y2), false);
});

test('副笔的界线改的是候选集合：划掉 2-2 的备用落点后，P1 立刻逼出另一处', () => {
  const mk = () => create({ ...HAND_TWO, seed: 'hand-two' });
  const a = mk();
  assert.match(a.hint().note, /^P1/, '第一手该是 1-1 无处可去，只能落在 ab');
  const stuck = a.hint();
  assert.match(stuck.note, /^答案/, '没有界线时这里逻辑与反证都收不住，该老实交出答案');
  const b = mk();
  b.hint();
  b.down(0, 1, 0);                      // 锚点 c
  b.down(1, 1, 1);                       // 副笔划掉 c-d 这条 2-2 的备用落点
  assert.equal(b.isBanned(0, 1, 1, 1), true);
  const h = b.hint();
  assert.match(h.note, /^P1/, '划掉备用落点后 2-2 只剩一处，P1 必须认这条记事');
  assert.deepEqual(h.cells.map(([x, y]) => y * 2 + x).sort((p, q) => p - q), [3, 5]);
});

test('判胜即锁盘：改笔只能走撤销', () => {
  const spec = generate('lock:0', 4);
  const e = create(spec);
  for (const [x1, y1, x2, y2] of spec.dominoes) { e.down(x1, y1, 0); e.down(x2, y2, 0); }
  assert.equal(e.solved(), true);
  const s = e.stats();
  assert.equal(e.down(spec.dominoes[0][0], spec.dominoes[0][1], 0), false, '赢了还能落子');
  assert.equal(e.down(0, 0, 1), false, '赢了还能划线');
  assert.equal(e.move(1, 0), false);
  assert.equal(e.up(), false);
  assert.equal(e.hint(), null);
  assert.deepEqual(e.stats(), s, '锁盘期间账本动了');
  assert.equal(e.undo(), true);
  assert.equal(e.solved(), false);
  assert.equal(e.redo(), true);
  assert.equal(e.solved(), true, '重做没回到通关');
});

test('缺一块、多一块、把一对数字配重了都不算赢', () => {
  const spec = generate('win:0', 6);
  const e = create(spec);
  for (const [x1, y1, x2, y2] of spec.dominoes.slice(1)) { e.down(x1, y1, 0); e.down(x2, y2, 0); }
  assert.equal(e.solved(), false, '还差一块就判胜');
  // 同一块骨牌上的数对不许落两次：拿盘上真有的重复号造一个脏局
  const dup = findDuplicatePair(spec);
  assert.ok(dup, '4×5/6×7 的盘上找不到两组同号的相邻格，这条断言是空的');
  const f = create(spec);
  for (const [i, j] of dup) f.down(i % spec.w, (i - i % spec.w) / spec.w, 0) || 0;
  const [[a, b], [c, d]] = dup;
  const g = create(spec);
  g.down(a % spec.w, (a - a % spec.w) / spec.w, 0);
  g.down(b % spec.w, (b - b % spec.w) / spec.w, 0);
  g.down(c % spec.w, (c - c % spec.w) / spec.w, 0);
  g.down(d % spec.w, (d - d % spec.w) / spec.w, 0);
  assert.equal(g.stats().moves, 2, '同号的第二块被拒了：那 badCells 就没对象了');
  assert.equal(g.solved(), false, '数对重了两次还判赢');
  const bad = g.badCells().map(([x, y]) => y * spec.w + x).sort((p, q) => p - q);
  assert.deepEqual(bad, [c, d], '只有多出来的那一块该闪红');
  // 空盘与开局正解都不许闪红
  assert.deepEqual(create(spec).badCells(), [], '空盘不许报任何格子');
  const clean = create(spec);
  for (const [x1, y1, x2, y2] of spec.dominoes) { clean.down(x1, y1, 0); clean.down(x2, y2, 0); }
  assert.deepEqual(clean.badCells(), [], '照解铺满全盘却报矛盾');
  void f;
});

// 找两组互不相干、数对相同的相邻格（同一张合法盘上必然存在好几组）
function findDuplicatePair(spec) {
  const key = new Map();
  for (let i = 0; i < spec.nums.length; i++) {
    const x = i % spec.w;
    const y = (i - x) / spec.w;
    for (const j of [x + 1 < spec.w ? i + 1 : -1, y + 1 < spec.h ? i + spec.w : -1]) {
      if (j < 0) continue;
      const a = spec.nums[i];
      const b = spec.nums[j];
      const k = a <= b ? `${a}-${b}` : `${b}-${a}`;
      if (key.has(k)) {
        const prev = key.get(k);
        if (![prev[0], prev[1], spec.solution[prev[0]], spec.solution[prev[1]]].includes(i)
          && ![prev[0], prev[1], spec.solution[prev[0]], spec.solution[prev[1]]].includes(j)) return [prev, [i, j]];
      } else key.set(k, [i, j]);
    }
  }
  return null;
}

test('盘上落重号时，提示的第一手是擦掉它', () => {
  const spec = generate('erasehint:0', 6);
  const dup = findDuplicatePair(spec);
  assert.ok(dup);
  const [[a, b], [c, d]] = dup;
  const e = create(spec);
  e.down(a % spec.w, (a - a % spec.w) / spec.w, 0);
  e.down(b % spec.w, (b - b % spec.w) / spec.w, 0);
  e.down(c % spec.w, (c - c % spec.w) / spec.w, 0);
  e.down(d % spec.w, (d - d % spec.w) / spec.w, 0);
  const moves = e.stats().moves;
  const h = e.hint();
  assert.match(h.note, /^擦掉/, `有矛盾的盘上提示没先拆错子：${h.note}`);
  assert.deepEqual(h.cells.map(([x, y]) => y * spec.w + x).sort((p, q) => p - q), [c, d]);
  assert.equal(e.stats().moves, moves, '擦掉收了步数');
  assert.deepEqual(e.badCells(), [], '拆掉重号之后矛盾还在');
});

test('三条铅笔与一层反证都收不住时，提示如实交出题面带着的那一种切法', () => {
  // 前一手的 P1 是这么说的：「数对「2-2」在盘上只剩这一处落点」——可这张盘 2-2 有两处落点，
  // 所以 HAND_TWO 走不到答案级。收得住答案的是 HAND_STUCK（2-1 三处、2-2 与 1-1 各两处）。
  const e = create(HAND_STUCK);
  const first = e.hint();
  assert.match(first.note, /^答案/, `该直接交出答案，却给了：${first.note}`);
  assert.doesNotMatch(first.note, /唯一解/, '两种切法的盘不许自称唯一解');
  assert.match(first.note, /不止一种切法/, first.note);
  assert.deepEqual(first.cells.map(([x, y]) => y * HAND_STUCK.w + x).sort((p, q) => p - q), [0, 1]);
  const second = e.hint();
  assert.match(second.note, /^P1/, `交出第一块后 1-1 只剩一处，该轮到 P1：${second.note}`);
  assert.deepEqual(second.cells.map(([x, y]) => y * HAND_STUCK.w + x).sort((p, q) => p - q), [3, 5], second.note);
  const third = e.hint();
  assert.deepEqual(third.cells.map(([x, y]) => y * HAND_STUCK.w + x).sort((p, q) => p - q), [2, 4], third.note);
  assert.equal(e.solved(), true, '三块落满还判不胜');
  // 答案挑的那一组必须与题面自洽：铺出来的盘面照白话规则数一遍是合法的
  const cover = [];
  for (let i = 0; i < 6; i++) cover.push(e.cellState(i % 2, (i - i % 2) / 2));
  assert.equal(myCheck(HAND_STUCK, flatToBlocks({ ...HAND_STUCK, solution: cover })), true, '答案兜底铺出了一个假盘面');
  // 这句话术是照 count 字段选的（不是照 spec 上有没有 solution 糊的）：同一张盘标上 count=1
  // 就该改口"唯一解"。这里只验管道，不验盘 —— 三档各 40 颗 seed 的 fuzz 里答案级一次都没逼出来，
  // 所以"唯一解的盘真走到这一级"目前没有实测样本，这条如实记成覆盖缺口。
  const reworded = create({ ...HAND_STUCK, count: 1, capped: false }).hint();
  assert.match(reworded.note, /^答案 · 推不动了：唯一解里/, reworded.note);
});

// ---- 5. 兜底与渲染 ------------------------------------------------------------------------

test('兜底盘也是真题：唯一、数得完、照解走一遍 moves === par', () => {
  for (const key of TIERS) {
    const spec = frozenSpec(key, tierOf(key), 'frozen');
    assert.equal(spec.rescued, true, '兜底盘得如实标出来');
    assert.equal(spec.k, key);
    const c = countSolutions(spec, 2, null, 400000);
    assert.equal(c.capped, false, `${key} 的兜底盘数不完`);
    assert.equal(c.count, 1, `${key} 的兜底盘有 ${c.count} 个解`);
    assert.equal(spec.count, 1);
    assert.equal(validate(spec, spec.solution), true, `${key} 的兜底解是假的`);
    assert.equal(myCheck(spec, flatToBlocks(spec)), true);
    assert.ok(JSON.stringify(spec).length > 100);
    const e = create(spec);
    for (const [x1, y1, x2, y2] of spec.dominoes) { e.down(x1, y1, 0); e.down(x2, y2, 0); }
    assert.equal(e.solved(), true, `${key} 的兜底盘点不通`);
    assert.equal(e.stats().moves, e.stats().par);
  }
});

test('logicSolve 推满全盘就是证明：推出来的切法与出题那套一模一样', () => {
  let full = 0;
  for (const key of TIERS) {
    for (const seed of SEEDS(`logic:${key}`, 6)) {
      const spec = generate(seed, key);
      const res = logicSolve(spec);
      if (!res.solved) continue;
      full++;
      assert.deepEqual(res.cover, spec.solution.map((v) => v | 0), `${key}/${seed} 推出来的与种下的不是同一张`);
      assert.equal(res.steps.length, spec.par);
      assert.ok(res.steps.every((s) => ['P1', 'P2', 'P4'].includes(s.rule)), 'propagate 里冒出了没登记的规则');
    }
  }
  assert.ok(full >= 10, `六颗 seed × 三档里只有 ${full} 张推得满全盘：这一版传播规则太弱`);
  // 玩家的记事（界线）必须进候选集合：把 2×3 两解盘里 1-1 的唯一落点 ab 划掉，传播当场喊矛盾
  const blocked = logicSolve(HAND_TWO, { dead: handBan(HAND_TWO, 0, 1) });
  assert.equal(blocked.contradiction, true, '唯一的 1-1 落点被划掉，传播居然没喊矛盾');
  assert.equal(logicSolve(HAND_TWO, { dead: handBan(HAND_TWO, 1, 3) }).contradiction, false,
    '划掉一处非唯一落点就把盘判死，那铅笔规则就过头了');
  // seedState 的三种喂法都得认：null / 扁平 partner 数组 / {cover, dead}
  const half = [1, 0, FREE, FREE, FREE, FREE];                  // 只有 ab 落了子
  const seeded = logicSolve(HAND_TWO, half);
  assert.equal(seeded.steps.length, 0, '已经铺了 ab，P1 的 1-1 就没得逼了');
  assert.equal(seeded.open, 4, '喂进去的墨没被认下来');
  assert.deepEqual(logicSolve(HAND_TWO, { cover: half }).cover, seeded.cover);
  // 空盘那一路：P1 会先把 1-1 逼到 ab，然后就再没什么必然结论（两种切法都还剩着）
  const fromEmpty = logicSolve(HAND_TWO);
  assert.deepEqual(fromEmpty.steps.map((s) => [s.i, s.j, s.rule]), [[0, 1, 'P1']], '空盘的传播结果与手推不符');
  assert.deepEqual(fromEmpty.cover.slice(2), [-1, -1, -1, -1], '没推出来的格子不该提前有主');
  assert.equal(handBan(HAND_TWO, 0, 1).length, 7, '2×3 该有 7 条界线');
});

// 把 (i,j) 这条边置 1 的 dead 数组。编号口径自己按"逐格先横后竖、缺角不编号"数一遍（2×3 共 7 条边）
function handBan(spec, i, j) {
  const w = spec.w;
  const total = w * spec.h;
  const out = [];
  for (let a = 0; a < total; a++) {
    const x = a % w;
    const y = (a - x) / w;
    const hit = (u, v) => (u === i && v === j) || (u === j && v === i);
    if (x + 1 < w) out.push(hit(a, a + 1) ? 1 : 0);            // 横边
    if (y + 1 < spec.h) out.push(hit(a, a + w) ? 1 : 0);       // 竖边
  }
  return out;
}

test('引擎不碰时钟也不碰随机数：模块里不许出现 Math.random', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../js/puzzles/dominosa.js', import.meta.url), 'utf8'));
  assert.equal(/Math\.random/.test(src), false, '引擎里出现 Math.random：同一颗种子就不再是同一道题');
  assert.equal(/\bnew Date\b/.test(src), false, '引擎不许读当前时间');
  assert.equal(/document\.|localStorage|window\./.test(src), false, '引擎不许碰 DOM 与存档');
});

test('draw 只要一个空壳上下文就能画完一帧，通关动画也不炸', () => {
  for (const key of TIERS) {
    const spec = generate(`draw:${key}`, key);
    const e = create(spec);
    const { ctx, calls } = fakeCtx();
    const v = {
      cell: 34, ox: 12, oy: 12, cols: spec.w, rows: spec.h, w: 400, h: 400, dpr: 2,
      hover: null, bad: [], reduce: false,
    };
    e.draw(ctx, v, 1000);
    assert.ok(calls.length > 20, '空盘一帧什么都没画');
    e.down(spec.dominoes[0][0], spec.dominoes[0][1], 0);
    e.down(spec.dominoes[0][2], spec.dominoes[0][3], 0);
    e.down(spec.dominoes[1][0], spec.dominoes[1][1], 0);
    e.down(spec.dominoes[1][2], spec.dominoes[1][3], 1);          // 一道界线（副笔，不收账）
    e.down(spec.dominoes[1][0], spec.dominoes[1][1], 0);
    e.down(spec.dominoes[1][2], spec.dominoes[1][3], 0);          // 墨盖过记事：再点一次才真的落子
    assert.equal(e.stats().moves, 2);
    e.draw(ctx, { ...v, hover: { x: 1, y: 1 }, bad: e.badCells() }, 1100);
    for (const d of spec.dominoes.slice(2)) { e.down(d[0], d[1], 0); e.down(d[2], d[3], 0); }
    assert.equal(e.solved(), true);
    e.draw(ctx, v, 1200);
    e.celebrate(ctx, { ...v, reduce: true }, 1300, 0.5);
    assert.ok(calls.length > 60);
  }
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

test('出题在手机上不卡：每档十道题各有一条松到不能再松的保险丝', () => {
  // 绝对毫秒不是算法量：同一份代码在本机与 CI 那台 4 核（并发十几个测试文件）实测差到几十倍。
  // 这条只当"算法塌成指数"的保险丝，可证的手感上界在各档 budget/draws 里。
  const FUSE = { 4: 4000, 6: 8000, 8: 40000 };
  for (const key of TIERS) {
    const t0 = Date.now();
    for (const seed of SEEDS(`t:${key}`)) generate(seed, key);
    const ms = Date.now() - t0;
    assert.ok(ms < FUSE[key], `${key}×${key + 1} 十道题花了 ${ms}ms，超过 ${FUSE[key]}ms`);
  }
});
