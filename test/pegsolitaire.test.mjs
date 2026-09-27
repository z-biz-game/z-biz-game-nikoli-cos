import test from 'node:test';
import assert from 'node:assert/strict';
import peg, {
  BOARDS, makeBoard, boardFrom, popcount, holesToBits, bitsToHoles, has, holeAt,
  legalMoves, reverseMoves, applyMove, jumpIndex, solve, reversePlay, generate, create,
} from '../js/puzzles/pegsolitaire.js';
import { rngFrom } from '../js/core/rng.js';

// ==============================================================================
// 独立参照实现
//
// 引擎把一切都压在 (lo, hi) 位图和预计算掩码上 —— 快，但"解出来了"也可能只是掩码自洽，
// 而不是这局真能走完。所以这里用一套完全不相干的数据结构（Set + 现算几何）把规则重写
// 一遍：只认 holes 这张坐标表，不碰 ja/jb/jc/abLo/mLo。两边对拍才说明位图那侧没算歪。
// ==============================================================================

function refJumps(holes) {
  const at = new Map(holes.map(([x, y], i) => [`${x},${y}`, i]));
  const out = [];
  holes.forEach(([x, y], a) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = at.get(`${x + dx},${y + dy}`);
      const c = at.get(`${x + 2 * dx},${y + 2 * dy}`);
      if (b !== undefined && c !== undefined) out.push([a, b, c]);
    }
  });
  return out;
}

const refKey = (s) => [...s].sort((p, q) => p - q).join(',');

// 独立暴力求解：数组集合状态 + Set 记忆化，无位运算。
// 返回 {solvable: true|false|null, dead, capped} —— null 只可能来自 capped，
// 因为"预算烧完"和"穷尽证明无解"是两件事，混起来的求解器不配当参照。
function refSolve(holes, start, cap = 300000) {
  const jumps = refJumps(holes);
  const dead = new Set();
  const state = new Set(start);
  let nodes = 0;
  let capped = false;
  const go = (s) => {
    if (capped) return false;
    if (s.size === 1) return true;
    const k = refKey(s);
    if (dead.has(k)) return false;
    if (++nodes > cap) { capped = true; return false; }
    for (const [a, b, c] of jumps) {
      if (!s.has(a) || !s.has(b) || s.has(c)) continue;
      s.delete(a); s.delete(b); s.add(c);
      const win = go(s);
      s.add(a); s.add(b); s.delete(c);
      if (win || capped) return win;
    }
    if (!capped) dead.add(k);
    return false;
  };
  return { solvable: go(state), dead: dead.size, capped, nodes };
}

// 独立复放：把一串走法照规则念一遍，任何一步不合法就抛。返回终局集合。
function refReplay(holes, start, plan) {
  const legal = new Set(refJumps(holes).map(([a, b, c]) => `${a},${b},${c}`));
  const s = new Set(start);
  for (const [a, b, c] of plan) {
    assert.equal(legal.has(`${a},${b},${c}`), true, `(${a},${b},${c}) 根本不是一条跳线`);
    assert.equal(s.has(a), true, `第 ${a} 孔没有子，飞不起来`);
    assert.equal(s.has(b), true, `第 ${b} 孔没有子，没东西可吃`);
    assert.equal(s.has(c), false, `第 ${c} 孔占着，落不进去`);
    s.delete(a); s.delete(b); s.add(c);
  }
  return s;
}

// 位图 → 集合：自己逐位扫，不借引擎的 bitsToHoles
function bitsToSetRef(lo, hi) {
  const out = new Set();
  const l = lo >>> 0;
  const h = hi >>> 0;
  for (let i = 0; i < 32; i++) if (l & (1 << i)) out.add(i);
  for (let i = 0; i < 16; i++) if (h & (1 << i)) out.add(32 + i);
  return out;
}

const planOf = (path) => path.map((m) => [m.a, m.b, m.c]);
const allHoles = (b) => [...Array(b.count).keys()];
const classicStart = (b) => allHoles(b).filter((i) => i !== b.center);

// 自制小盘：makeBoard 只硬要求"中心是孔"
const ROW3 = { name: 'row3', side: 3, holes: [[0, 1], [1, 1], [2, 1]] };
const PLUS5 = { name: 'plus5', side: 3, holes: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] };
const plus5 = makeBoard(PLUS5.name, PLUS5.holes, PLUS5.side);

function tinySpec(shape, startHoles, extra = {}) {
  return {
    kind: 'pegsolitaire', board: shape.name, side: shape.side,
    holes: shape.holes.map(([x, y]) => [x, y]), start: holesToBits(startHoles), ...extra,
  };
}

// ==============================================================================
// 盘面表
// ==============================================================================

test('三张盘的孔数：25 孔小十字 / 33 孔英式 / 37 孔法式', () => {
  assert.deepEqual(Object.keys(BOARDS), ['cross', 'english', 'french']);
  assert.equal(BOARDS.cross.count, 25);
  assert.equal(BOARDS.english.count, 33);
  assert.equal(BOARDS.french.count, 37);
  for (const b of Object.values(BOARDS)) {
    assert.equal(b.side, 7);
    assert.equal(new Set(b.holes.map(([x, y]) => `${x},${y}`)).size, b.count, '孔位不重复');
    assert.equal(b.count, b.holes.length);
    assert.equal(holeAt(b, -1, 0), -1);
    assert.equal(holeAt(b, 7, 3), -1);
    assert.equal(holeAt(b, 3, 6), b.holes.findIndex(([x, y]) => x === 3 && y === 6));
    assert.equal(b.center, holeAt(b, 3, 3));
    assert.equal(b.holes[b.center][0], 3);
    assert.equal(b.holes[b.center][1], 3);
  }
});

test('英式与法式的绝对角上没有孔：那里的子既跳不走也吃不掉', () => {
  for (const name of ['english', 'french']) {
    for (const [x, y] of [[0, 0], [6, 0], [0, 6], [6, 6]]) {
      assert.equal(holeAt(BOARDS[name], x, y), -1, `${name} 的角 ${x},${y} 不该是孔`);
    }
  }
  // 法式正是英式在四个"内角"上各加一孔
  const en = new Set(BOARDS.english.holes.map(([x, y]) => `${x},${y}`));
  assert.deepEqual(
    BOARDS.french.holes.map(([x, y]) => `${x},${y}`).filter((c) => !en.has(c)).sort(),
    ['1,1', '1,5', '5,1', '5,5'],
  );
});

test('每孔都住在至少一条跳线上，孔索引 = 行优先编号', () => {
  for (const b of Object.values(BOARDS)) {
    const rowFirst = [...b.holes].map(([x, y], i) => [i, y, x]).sort((p, q) => p[1] - q[1] || p[2] - q[2]);
    assert.deepEqual(rowFirst.map(([i]) => i), allHoles(b), '孔表必须行优先');
    for (let i = 0; i < b.count; i++) {
      assert.ok(b.degree[i] > 0, `${b.name} 第 ${i} 孔动不了，是颗死子`);
      assert.equal(holeAt(b, b.holes[i][0], b.holes[i][1]), i);
    }
  }
});

test('跳跃表双向对称，且与独立几何实现一字不差', () => {
  for (const b of Object.values(BOARDS)) {
    const mine = b.list.map((m) => `${m.a},${m.b},${m.c}`);
    assert.equal(new Set(mine).size, mine.length, '同一条跳法不出现两次');
    const byLine = new Map();
    for (const m of b.list) {
      const line = [m.a, m.b, m.c].sort((p, q) => p - q).join(',');
      byLine.set(line, (byLine.get(line) || 0) + 1);
      const [ax, ay] = b.holes[m.a];
      const [bx, by] = b.holes[m.b];
      const [cx, cy] = b.holes[m.c];
      assert.equal(Math.abs(ax - bx) + Math.abs(ay - by), 1, 'a→b 必须相邻一格');
      assert.deepEqual([cx, cy], [ax + 2 * (bx - ax), ay + 2 * (by - ay)], 'c 必须是 a 关于 b 的对称点');
    }
    for (const n of byLine.values()) assert.equal(n, 2, '每条三线恰好两个方向');
    const ref = refJumps(b.holes).map(([a, x, c]) => `${a},${x},${c}`).sort();
    assert.deepEqual([...mine].sort(), ref, `${b.name} 的跳表与独立实现不一致`);
    // 反查表与分类索引互证
    for (let k = 0; k < b.list.length; k++) {
      assert.equal(jumpIndex(b, b.ja[k], b.jb[k], b.jc[k]), k);
      assert.ok(b.byFrom[b.ja[k]].includes(k));
    }
  }
});

test('makeBoard 拒绝中心不是孔的形状；boardFrom 认孔表也认盘型名', () => {
  assert.throws(() => makeBoard('bad', [[0, 0], [1, 0], [2, 2]], 3), /中心/);
  assert.equal(boardFrom({ board: 'english' }), BOARDS.english);
  assert.equal(boardFrom({ board: 'english', holes: BOARDS.english.holes }), BOARDS.english);
  const custom = boardFrom({ holes: PLUS5.holes, side: PLUS5.side });
  assert.equal(custom.count, 5);
  assert.equal(custom, boardFrom({ holes: PLUS5.holes, side: PLUS5.side }), '同孔表共用缓存');
  assert.throws(() => boardFrom({ board: 'nope' }), /孔位表/);
});

// ==============================================================================
// 位图
// ==============================================================================

test('holesToBits / bitsToHoles 互逆，跨 32 位边界不丢子', () => {
  assert.deepEqual(bitsToHoles(...holesToBits(allHoles(BOARDS.french))), allHoles(BOARDS.french));
  assert.deepEqual(bitsToHoles(...holesToBits([])), []);
  for (const pick of [[31], [32], [31, 32], [0, 36], [4, 31, 32, 36], [36]]) {
    assert.deepEqual(bitsToHoles(...holesToBits(pick)), [...pick].sort((p, q) => p - q));
    assert.deepEqual([...bitsToSetRef(...holesToBits(pick))].sort((p, q) => p - q), [...pick].sort((p, q) => p - q));
    assert.equal(popcount(...holesToBits(pick)), pick.length);
  }
});

test('popcount 与独立集合计数在随机位图上始终一致', () => {
  for (let t = 0; t < 400; t++) {
    const picked = new Set();
    for (let i = 0; i < t % 38; i++) picked.add(Math.floor(Math.random() * 37));
    const bits = holesToBits([...picked]);
    assert.equal(popcount(...bits), picked.size);
    assert.deepEqual(new Set(bitsToHoles(...bits)), picked);
    for (const i of picked) assert.equal(has(BOARDS.french, ...bits, i), true);
  }
});

// ==============================================================================
// 求解器：与独立暴力实现对拍
// ==============================================================================

test('solve 与独立暴力求解器对拍：能说的都说能，不能的都说不能', () => {
  const boards = [BOARDS.cross, BOARDS.english, plus5];
  // 纯随机子集里可解局面极稀（实测 <6%），"能解"这一类得自己造：
  //   · 倒放出来的局面天然可解（构造即证明，且 refReplay 会独立复核一遍）
  //   · 英式经典开局的解走到中途的局面同样可解
  const yesShaped = [];
  for (const b of [BOARDS.cross, BOARDS.english]) {
    for (let t = 0; t < 10; t++) {
      const depth = 5 + (t % 6);
      const got = reversePlay(b, depth, rngFrom(`pair|${b.name}|${t}`), { cap: 200000 });
      if (got) yesShaped.push([b, ...got.start]);
    }
    const path = solve(b, ...holesToBits(classicStart(b)), 200000);
    if (path) {
      for (const cut of [path.length - 4, path.length - 7, path.length - 9]) {
        let [lo, hi] = holesToBits(classicStart(b));
        for (let i = 0; i < cut; i++) [lo, hi] = applyMove(b, path[i].k, lo, hi);
        if (popcount(lo, hi) <= 12) yesShaped.push([b, lo, hi]);
      }
    }
  }
  let yes = 0;
  let no = 0;
  const run = (b, lo, hi) => {
    const start = [...bitsToSetRef(lo, hi)];
    const ref = refSolve(b.holes, start, 400000);
    if (ref.capped) return;                       // 参照侧超预算：这一局不进入对拍
    const got = solve(b, lo, hi, 400000);
    assert.equal(!!got, ref.solvable, `${b.name} {${start}}：引擎 ${got ? '能' : '不能'}，参照 ${ref.solvable}`);
    if (got) {
      yes++;
      assert.equal(got.length, start.length - 1, '每步吃一子，解的长度只能是 子数−1');
      assert.equal(refReplay(b.holes, start, planOf(got)).size, 1);
    } else no++;
  };
  for (const [b, lo, hi] of yesShaped) run(b, lo, hi);
  for (const b of boards) {
    for (let t = 0; t < 90; t++) {
      const k = Math.min(b.count, 3 + (t % 8));
      const pool = rngFrom(`fuzz|${b.name}|${t}`).shuffle(allHoles(b));
      const [lo, hi] = holesToBits(pool.slice(0, k));
      run(b, lo, hi);
    }
  }
  assert.ok(yes >= 25, `对拍里"可解"样本 ${yes} 个，太少`);
  assert.ok(no >= 100, `对拍里"无解"样本 ${no} 个，太少`);
});

test('25 孔小十字的满盘缺中心可证无解，33 孔英式同一条开局可解', () => {
  // 这是本文件最硬的外部事实：两边都跑到**穷尽**（capped=false），不是"搜不动了"。
  const cross = BOARDS.cross;
  const stats = {};
  // 214749 是这条开局的全部可达局面数：nodes 与 dead 相等就是"每一个都查过、每一个都是死局"，
  // 也就是证明本身。墙钟测不出这件事 —— 本机 149ms、把 node 压到能效核要 3.1s、CI 满载更慢，
  // 差 20 倍而节点数一个没多，所以这里只钉工作量。（预算 40 万封顶，跑飞了会先撞上 capped。）
  assert.equal(solve(cross, ...holesToBits(classicStart(cross)), 400000, stats), null);
  assert.equal(stats.capped, false, '没超预算的 null 才是证明');
  const ref = refSolve(cross.holes, classicStart(cross), 3000000);
  assert.equal(ref.capped, false);
  assert.equal(ref.solvable, false);
  // 两套实现判过"无解"的局面数一致：连证明集合都对得上
  assert.ok(stats.dead > 100000, `引擎只看了 ${stats.dead} 个局面`);
  assert.equal(stats.dead, ref.dead, `引擎 ${stats.dead} vs 参照 ${ref.dead}`);
  assert.equal(stats.nodes, 214749);
  assert.equal(stats.nodes, stats.dead, '走过的每个局面都被证明是死局，一个不漏');

  const en = BOARDS.english;
  const got = solve(en, ...holesToBits(classicStart(en)), 400000, stats);
  assert.ok(got);
  assert.equal(stats.capped, false);
  assert.equal(got.length, en.count - 2, '32 子要吃 31 步');
  assert.equal(refReplay(en.holes, classicStart(en), planOf(got)).size, 1);
});

test('预算用尽时报告"不知道"，而不是谎称无解', () => {
  const b = BOARDS.french;
  const stats = {};
  // 法式满盘缺中心是出了名的难搜：给 80 万节点也烧不完，此时只能报 capped
  assert.equal(solve(b, ...holesToBits(classicStart(b)), 800000, stats), null);
  assert.equal(stats.capped, true, '换候选顺序不能把没搜完说成搜完了');
  assert.ok(stats.nodes >= 800000);
  // 预算给少一点也必须同样诚实
  assert.equal(solve(b, ...holesToBits(classicStart(b)), 500, stats), null);
  assert.equal(stats.capped, true);
  // 而英式同一句开局，给够预算就出解
  assert.equal(solve(BOARDS.english, ...holesToBits(classicStart(BOARDS.english)), 200000, stats).length, 31);
  assert.equal(stats.capped, false);
});

test('死局判据：legalMoves 为空 ⇔ solve 报无解；但"有得跳"不等于"解得开"', () => {
  const full = holesToBits(allHoles(plus5));
  assert.deepEqual(legalMoves(plus5, ...full), [], '满盘小十字一格都跳不动');
  assert.deepEqual(reverseMoves(plus5, ...full), []);
  assert.equal(solve(plus5, ...full, 1000), null);
  // 空出一臂：竖着 (1,0)→(1,1)→(1,2) 跳得动，可跳完剩三子且再也动不了 —— 有解≠能通关
  const arm = holesToBits([0, 1, 2, 3]);
  assert.deepEqual(legalMoves(plus5, ...arm).map((m) => `${m.a},${m.b},${m.c}`), ['0,2,4']);
  assert.deepEqual(refReplay(PLUS5.holes, [0, 1, 2, 3], [[0, 2, 4]]), new Set([1, 3, 4]));
  assert.equal(solve(plus5, ...arm, 1000), null);
  // 两子一线才真解得开：跳一步就剩一子
  const pair = holesToBits([0, 2]);
  assert.equal(solve(plus5, ...pair, 1000).length, 1);
  assert.equal(refReplay(PLUS5.holes, [0, 2], [[0, 2, 4]]).size, 1);
  // 倒放视角：c 空、b 也空才补得进去
  const rvs = reverseMoves(plus5, ...holesToBits([4]));
  assert.deepEqual(rvs.map((m) => `${m.a},${m.b},${m.c}`), ['4,2,0']);
  for (const m of rvs) {
    const [l, h] = applyMove(plus5, m.k, ...holesToBits([4]));
    assert.equal(popcount(l, h), 2, '倒放一步净加一子：拿走 a、补上 b 与 c');
    assert.equal(has(plus5, l, h, m.c), true, '倒放是把子补回 c、拿走 a');
    assert.equal(has(plus5, l, h, m.a), false);
  }
});

test('applyMove 就是三格异或：正放一步、反查一条都不含糊', () => {
  const b = BOARDS.french;
  for (let k = 0; k < b.list.length; k++) {
    const [x, y, z] = [b.ja[k], b.jb[k], b.jc[k]];
    const [l2, h2] = applyMove(b, k, ...holesToBits([x, y]));
    assert.deepEqual([...bitsToSetRef(l2, h2)], [z], '掩码必须正好完成 a→c 并吃掉 b');
    assert.equal(jumpIndex(b, x, y, z), k);
    assert.equal(jumpIndex(b, x, z, y), -1, '乱序三元组不该查到东西');
    const back = jumpIndex(b, z, y, x);
    assert.ok(back >= 0);
    assert.deepEqual([...applyMove(b, back, ...applyMove(b, k, ...holesToBits([x, y])))], holesToBits([x, y]), '逆跳法把局面还原');
  }
});

test('reversePlay 倒放出来的开局，正放着法就是它的解', () => {
  const b = BOARDS.english;
  for (const depth of [3, 7, 12]) {
    for (const seed of ['a', 'b', 'c']) {
      const got = reversePlay(b, depth, rngFrom(`reverse|${seed}`), { cap: 200000 });
      assert.ok(got, `depth ${depth} 倒放不该失败`);
      assert.equal(popcount(...got.start), depth + 1);
      assert.equal(got.plan.length, depth);
      assert.equal(refReplay(b.holes, bitsToSetRef(...got.start), got.plan).size, 1, '倒放序列整体取反必须是合法正解');
      // plan 里的每一步都得是引擎自己认的跳法
      let [lo, hi] = got.start;
      for (const [a, bb, c] of got.plan) {
        const k = jumpIndex(b, a, bb, c);
        assert.ok(k >= 0);
        assert.equal(legalMoves(b, lo, hi).some((m) => m.k === k), true, '正放时这一步必须合法');
        [lo, hi] = applyMove(b, k, lo, hi);
      }
      assert.equal(popcount(lo, hi), 1);
    }
  }
});

// ==============================================================================
// 生成器
// ==============================================================================

const SEEDS = Array.from({ length: 40 }, (_, i) => `nikoli|peg|${i}`);
const TIER_BY_KEY = Object.fromEntries(peg.sizes.map((s) => [s.key, s]));
const BOARD_OF = { 25: 'cross', 33: 'english', 37: 'french' };

function checkSpec(spec, sizeKey) {
  const tier = TIER_BY_KEY[sizeKey];
  const b = BOARDS[BOARD_OF[sizeKey]];
  assert.ok(spec, `${tier.label}：generate 不能返回 null`);
  assert.equal(spec.kind, 'pegsolitaire');
  assert.equal(spec.tier, tier.tier);
  assert.equal(spec.board, b.name);
  assert.equal(spec.label, tier.label);
  assert.equal(spec.side, 7);
  assert.deepEqual(spec.holes, b.holes.map(([x, y]) => [x, y]));
  const [lo, hi] = spec.start;
  assert.deepEqual(new Set(bitsToHoles(lo, hi)), bitsToSetRef(lo, hi), '两种换算一致');
  assert.equal(popcount(lo, hi), spec.pegs);
  assert.equal(spec.par, spec.pegs - 1);
  assert.equal(spec.plan.length, spec.par, 'par 是可证明下界，plan 恰好走满它');
  assert.equal(has(b, lo, hi, b.center), false, '开局约定：中心空着');
  assert.equal(refReplay(b.holes, bitsToSetRef(lo, hi), spec.plan).size, 1, '照 plan 走完只剩一子');
  assert.deepEqual(new Set(spec.empty), new Set(allHoles(b).filter((i) => !has(b, lo, hi, i))), 'empty 是没子的孔');
  assert.ok(spec.nodes > 0 && spec.nodes <= 60000, `现搜节点 ${spec.nodes} 要在提示预算内`);
  assert.equal(JSON.parse(JSON.stringify(spec)).pegs, spec.pegs, 'spec 必须能进存档');
}

test('generate：三档 × 40 seed 全部交出可独立复放的题，且没有一题走宽松退路', () => {
  for (const sizeKey of [25, 33, 37]) {
    for (const seed of SEEDS) {
      const spec = generate(seed, sizeKey);
      assert.equal(spec.degraded, undefined, `${TIER_BY_KEY[sizeKey].label} / ${seed} 掉进了退路`);
      checkSpec(spec, sizeKey);
    }
  }
});

test('generate 的工作量预算：按搜索节点数计，墙钟只当防死循环的保险丝', () => {
  // 这条曾经写成绝对毫秒（"法式最坏 260ms，留 40% 余量"），于是一道测算法的断言变成了
  // 掷硬币：本机满载时 490ms、把 node 用 taskpolicy 关到能效核再跑，25 孔那种小题能涨到
  // 1.2 秒 —— 差 30 倍，而这 30 倍里没有任何一点属于算法。CI runner 上它到底红过多少次，
  // 没人知道，因为单测那一段的退出码当时被管道的 tail 吞掉了（见 tools/verify.sh 的 pipefail）。
  //
  // 现在钉的是节点数：同一颗种子在任何机器、任何负载上都是同一个数，指数级膨胀（换候选
  // 顺序、死局集失效）照样当场爆表，而玩家点开一局的手感本来就取决于这份工作。
  // 上限给到实测最坏值的两倍上下：40 seed 实测 25 孔 3.7 万 / 33 孔 5.4 万 / 37 孔 5.3 万节点。
  const NODE_CAP = { 25: 80_000, 33: 120_000, 37: 120_000 };
  const NODE_TOTAL_CAP = { 25: 2_000_000, 33: 2_000_000, 37: 2_500_000 };
  for (const sizeKey of [25, 33, 37]) {
    let worst = 0;
    let total = 0;
    const t0 = Date.now();
    for (const seed of SEEDS) {
      const spec = generate(seed, sizeKey);
      const work = (spec.nodes || 0) + (spec.reverseNodes || 0);
      assert.ok(work > 0, `${TIER_BY_KEY[sizeKey].label} / ${seed} 没报工作量`);
      worst = Math.max(worst, work);
      total += work;
    }
    assert.ok(worst <= NODE_CAP[sizeKey],
      `${TIER_BY_KEY[sizeKey].label} 单题最坏 ${worst} 节点 > ${NODE_CAP[sizeKey]}`);
    assert.ok(total <= NODE_TOTAL_CAP[sizeKey],
      `${TIER_BY_KEY[sizeKey].label} 40 题共 ${total} 节点 > ${NODE_TOTAL_CAP[sizeKey]}`);
    // 松到只防一件事：算法塌成指数或者死循环。它不承担"压机器性能"的职责。
    assert.ok(Date.now() - t0 < 60_000, `${TIER_BY_KEY[sizeKey].label} 四十题跑了超过一分钟`);
  }
});

test('generate 确定性：同 seed 同档出同一道题，换 seed 才换题', () => {
  for (const sizeKey of [25, 33, 37]) {
    const a = JSON.stringify(generate('fixed-seed', sizeKey));
    assert.equal(JSON.stringify(generate('fixed-seed', sizeKey)), a);
    assert.notEqual(JSON.stringify(generate('other-seed', sizeKey)), a, `${sizeKey}：seed 不影响题面`);
  }
  assert.deepEqual(generate('x', 33).start, generate('x').start, 'sizeKey 缺省即英式');
  assert.deepEqual(generate('x', 'english').start, generate('x', 33).start, '档位也可以写盘型名');
});

test('退路：严格门槛全放开那一趟仍然交出可证的题，并如实标注 degraded', () => {
  for (const sizeKey of [25, 33, 37]) {
    const spec = generate('loose-run', sizeKey, { strict: false });
    assert.equal(spec.degraded, true);
    assert.equal(spec.seed, 'loose-run|loose', '退路要留下"这是换了种子找来的"痕迹');
    // 放开的只有开局约定与节点门槛，正确性一条不少
    const b = BOARDS[BOARD_OF[sizeKey]];
    assert.equal(popcount(...spec.start), spec.pegs);
    assert.equal(spec.par, spec.pegs - 1);
    assert.equal(spec.plan.length, spec.par);
    assert.equal(refReplay(b.holes, bitsToSetRef(...spec.start), spec.plan).size, 1);
  }
});

// ==============================================================================
// 引擎契约
// ==============================================================================

const ENG_FNS = ['stats', 'canUndo', 'canRedo', 'undo', 'redo', 'hint',
  'solved', 'badCells', 'cellState', 'down', 'move', 'up', 'draw', 'celebrate'];

function viewFor(e, over = {}) {
  const cols = e.board.cols;
  return {
    cell: 40, ox: 20, oy: 20, cols, rows: e.board.rows, w: cols * 40, h: cols * 40,
    dpr: 2, hover: null, bad: [], reduce: false, ...over,
  };
}

function fresh(sizeKey = 33, seed = 'engine') {
  return create(generate(seed, sizeKey));
}

const cellOf = (e, i) => e.spec.holes[i];

test('契约形状齐备（三档），盘面尺寸即孔表边长', () => {
  for (const sizeKey of [25, 33, 37]) {
    const e = fresh(sizeKey, `shape|${sizeKey}`);
    for (const k of ENG_FNS) assert.equal(typeof e[k], 'function', `缺 ${k}`);
    assert.equal(e.spec.kind, 'pegsolitaire');
    assert.equal(e.id, 'pegsolitaire');
    assert.equal(e.board.cols, 7);
    assert.equal(e.board.rows, 7);
    assert.deepEqual(e.board.margin, { l: 0.52, t: 0.52, r: 0.52, b: 0.52 });
    assert.deepEqual(e.stats(), { moves: 0, par: e.spec.par, done: 0, total: e.spec.par });
    assert.equal(e.solved(), false);
    assert.equal(e.canUndo(), false);
    assert.equal(e.canRedo(), false);
    assert.deepEqual(e.badCells(), []);
    assert.equal(e.undo(), false, '一步没走就没有可撤销');
    assert.equal(e.redo(), false);
    assert.equal(e.cellState(0, 0), -1, '英式的角不是孔');
    assert.equal(e.cellState(9, 9), -1);
    assert.equal(e.cellState(...cellOf(e, BOARDS[BOARD_OF[sizeKey]].center)), 0, '开局中心空着');
    assert.equal(e.selected(), -1);
  }
});

test('spec 过 JSON 存档：位图、plan、par 一字不差地活着', () => {
  const spec = generate('roundtrip', 37);
  const a = create(spec);
  const b = create(JSON.parse(JSON.stringify(spec)));
  assert.deepEqual(b.bitmap(), a.bitmap());
  assert.equal(b.stats().par, a.stats().par);
  assert.equal(b.pegCount(), spec.pegs);
});

test('照 plan 一路点两下跳到收官：moves、done、solved 全程对账', () => {
  const e = fresh(25, 'play-plan');
  assert.equal(e.spec.plan.length, e.stats().par);
  for (let step = 0; step < e.spec.plan.length; step++) {
    const [a, , c] = e.spec.plan[step];
    assert.equal(e.down(...cellOf(e, a)), false, '第一点只是选中，不算落子');
    assert.equal(e.selected(), a);
    assert.equal(e.up(), false, '抬手不清选中：键盘光标靠这个活着');
    assert.equal(e.move(...cellOf(e, c)), false, '本玩法没有连笔');
    assert.equal(e.down(...cellOf(e, c)), true, '第二点成跳');
    assert.equal(e.selected(), -1, '跳完清空选中');
    const st = e.stats();
    assert.deepEqual([st.moves, st.done], [step + 1, step + 1]);
    assert.equal(st.total, st.par);
    assert.equal(e.pegCount(), e.spec.pegs - step - 1);
    assert.equal(e.solved(), step + 1 === e.spec.plan.length);
  }
  assert.equal(e.pegCount(), 1);
  assert.equal(e.stats().moves, e.stats().par, '零浪费通关');
});

test('副笔取消选中；非法落点转移选中，空孔清空选中', () => {
  const e = fresh(33, 'select');
  const b = e.boardTable;
  const [a, , c] = e.spec.plan[0];
  assert.equal(e.down(...cellOf(e, a)), false);
  assert.equal(e.selected(), a);
  assert.equal(e.down(...cellOf(e, a)), false, '再点同一颗是取消');
  assert.equal(e.selected(), -1);
  e.down(...cellOf(e, a));
  assert.equal(e.down(...cellOf(e, c), 1), false, '副笔只取消，不跳');
  assert.equal(e.selected(), -1);
  assert.equal(e.stats().moves, 0);
  // 越界格坐标当没看见，选中不受影响
  e.down(...cellOf(e, a));
  assert.equal(e.down(9, 9), false);
  assert.equal(e.selected(), a);
  // 选中后点一个"既没子也跳不进去"的孔 → 清空
  const landings = new Set(e.legalTargets(...cellOf(e, a)).map(([x, y]) => `${x},${y}`));
  const deadHole = b.holes.findIndex(([x, y]) => !landings.has(`${x},${y}`) && e.cellState(x, y) === 0);
  assert.ok(deadHole >= 0);
  assert.equal(e.down(...cellOf(e, deadHole)), false);
  assert.equal(e.selected(), -1);
  // 另一颗有子的珠子 → 选中转移，"那换这颗跳"
  const other = bitsToHoles(...e.bitmap()).find((i) => i !== a);
  e.down(...cellOf(e, a));
  e.down(...cellOf(e, other));
  assert.equal(e.selected(), other);
  assert.equal(e.stats().moves, 0, '换选中不算一步');
});

test('legalTargets 与独立几何枚举完全一致', () => {
  const e = fresh(37, 'targets');
  const b = e.boardTable;
  const jumps = refJumps(b.holes);
  for (let round = 0; round < 4; round++) {
    const occupied = bitsToSetRef(...e.bitmap());
    for (let i = 0; i < b.count; i++) {
      const mine = e.legalTargets(...cellOf(e, i))
        .map(([x, y]) => b.holes.findIndex((h) => h[0] === x && h[1] === y))
        .sort((p, q) => p - q);
      const ref = jumps.filter(([a, bb, c]) => a === i && occupied.has(a) && occupied.has(bb) && !occupied.has(c))
        .map(([, , c]) => c).sort((p, q) => p - q);
      assert.deepEqual(mine, ref, `第 ${round} 轮 ${b.name} 第 ${i} 孔`);
      if (!occupied.has(i)) assert.deepEqual(mine, [], '没子的孔不给落点');
    }
    const h = e.hint();
    if (!h) break;
  }
});

test('撤销不回退 moves，重做也不另收一次：一步落子只记一次账', () => {
  const e = fresh(25, 'undo');
  const [a, , c] = e.spec.plan[0];
  const before = e.bitmap();
  const pegs0 = e.pegCount();
  e.down(...cellOf(e, a));
  e.down(...cellOf(e, c));
  assert.equal(e.stats().moves, 1);
  assert.equal(e.canUndo(), true);
  assert.equal(e.undo(), true);
  assert.deepEqual(e.bitmap(), before, '局面回到落子前');
  assert.equal(e.pegCount(), pegs0);
  assert.equal(e.stats().moves, 1, '撤销不许把浪费的步数洗掉');
  assert.equal(e.stats().done, 0);
  assert.equal(e.selected(), -1);
  assert.equal(e.canRedo(), true);
  assert.equal(e.undo(), false, '栈空了就说空');
  assert.equal(e.redo(), true);
  // 重做只是把已经付过账的那步放回盘上：再收一次就成了双重计费
  assert.equal(e.stats().moves, 1);
  assert.equal(e.pegCount(), pegs0 - 1);
  assert.equal(e.stats().done, 1);
  assert.equal(e.canRedo(), false);
  assert.equal(e.redo(), false);
});

test('判胜即锁输入，撤销才解锁；重做能回到胜局', () => {
  const e = fresh(25, 'lock');
  for (const [a, , c] of e.spec.plan) {
    e.down(...cellOf(e, a));
    e.down(...cellOf(e, c));
  }
  assert.equal(e.solved(), true);
  const frozen = e.bitmap();
  for (let i = 0; i < e.boardTable.count; i++) {
    assert.equal(e.down(...cellOf(e, i)), false, '胜局之后任何点选都不该改动盘面');
  }
  assert.deepEqual(e.bitmap(), frozen);
  assert.equal(e.hint(), null, '已经赢了，没什么可提示的');
  assert.equal(e.undo(), true);
  assert.equal(e.solved(), false);
  const [a, , c] = e.spec.plan[e.spec.plan.length - 1];
  e.down(...cellOf(e, a));
  assert.equal(e.down(...cellOf(e, c)), true, '解锁后能重跳最后一步');
  assert.equal(e.solved(), true);
  const movesAtWin = e.stats().moves;
  assert.equal(e.undo(), true);
  assert.equal(e.solved(), false);
  assert.equal(e.redo(), true);
  assert.equal(e.solved(), true, '重做回到只剩一子要重新记胜');
  assert.equal(e.stats().moves, movesAtWin, '撤销 + 重做这一趟来回不该多收步数');
});

test('hint：在原路线上照本宣科，一路点下去能收官', () => {
  const e = fresh(33, 'hint-plan');
  const first = e.hint();
  assert.ok(first);
  assert.deepEqual(first.cells, e.spec.plan[0].map((i) => cellOf(e, i)), '没走偏就该照着题面路线给');
  assert.match(first.note, /开局算好的路线第 1 步/);
  assert.match(first.note, /吃掉/);
  // 契约：hint 必须真的改动状态 —— 给完提示就顺手把这一步落了
  assert.equal(e.stats().moves, 1);
  assert.equal(e.pegCount(), e.spec.pegs - 1);
  let hints = 1;
  while (!e.solved()) {
    assert.ok(hints < e.spec.par, '提示循环没收住，说明有提示没落子');
    const h = e.hint();
    assert.ok(h, `第 ${hints + 1} 次提示说走投无路，可盘面还没死`);
    assert.equal(h.cells.length, 3);
    hints++;
    assert.equal(e.stats().moves, hints, '每次提示恰好落一步');
    assert.equal(e.pegCount(), e.spec.pegs - hints);
  }
  assert.equal(e.pegCount(), 1);
  assert.equal(hints, e.spec.par);
  assert.equal(e.stats().moves, e.spec.par, '照提示走恰好卡在 par 上，三星线不破');
});

test('hint：走偏之后现搜救场，救不回来就照实说', () => {
  // 在残局里走偏（子少到独立求解器能穷尽），才把"提示有没有骗人"逐局核对得动。
  let rescued = 0;
  for (let t = 0; t < 14; t++) {
    const e = fresh(25, `deviate|${t}`);
    const stop = e.spec.plan.length - 8;         // 走到只剩 9 子附近再偏
    for (let i = 0; i < stop; i++) assert.ok(e.hint());
    const [pa, , pc] = e.spec.plan[stop];
    const alt = legalMoves(e.boardTable, ...e.bitmap()).find((m) => !(m.a === pa && m.c === pc));
    if (!alt) continue;
    e.down(...cellOf(e, alt.a));
    e.down(...cellOf(e, alt.c));
    const left = e.pegCount();
    const ref = refSolve(e.boardTable.holes, [...bitsToSetRef(...e.bitmap())], 400000);
    if (ref.capped) continue;                    // 参照侧都算不完，这一局不作数
    const h = e.hint();
    assert.equal(!!h, ref.solvable, `${left} 子时引擎说 ${h ? '有救' : '没救'}，参照说 ${ref.solvable}`);
    if (h) {
      rescued++;
      assert.match(h.note, /现搜/, '偏离路线之后不该再假装照着题面走');
      assert.equal(e.pegCount(), left - 1, '提示落子一步');
      assert.equal(e.stats().moves, stop + 2, '提示与玩家落的步数一并记账');
    }
  }
  assert.ok(rescued > 0, '十四局里一次都没走偏出"还能救"，取样偏了');
  // 把整条 plan 走完（胜局）后再按提示：没有可提示的
  const e2 = fresh(33, 'hint-done');
  for (let i = 0; i < e2.spec.plan.length; i++) assert.ok(e2.hint());
  assert.equal(e2.solved(), true);
  assert.equal(e2.hint(), null);
  assert.equal(e2.stats().moves, e2.spec.par);
});

test('走投无路：盘面已死时 hint 返回 null，由外壳说"这条路堵住了"', () => {
  const e = create(tinySpec(PLUS5, [0, 1, 2, 3, 4]));   // 满盘小十字：一步都跳不出
  assert.equal(e.hint(), null);
  assert.equal(e.solved(), false);
  assert.equal(e.stats().par, 4);
  assert.deepEqual(e.badCells(), []);
  const frozen = e.bitmap();
  for (let i = 0; i < 5; i++) e.down(...cellOf(e, i));
  assert.deepEqual(e.bitmap(), frozen, '满盘上点点只挪选中，落不下一子');
  assert.equal(e.stats().moves, 0, '一步都落不下，moves 也不该动');
});

test('题面路线与位图对不上时，丢掉路线改走现搜而不是崩', () => {
  const spec = generate('badplan', 25);
  const b = BOARDS.cross;
  const bogus = b.list.find((m) => !(has(b, ...spec.start, m.a) && has(b, ...spec.start, m.b) && !has(b, ...spec.start, m.c)));
  spec.plan = [[bogus.a, bogus.b, bogus.c]];
  const e = create(spec);
  assert.equal(e.stats().par, spec.pegs - 1, 'par 只跟起始子数走，与题面路线无关');
  const idx = ([x, y]) => holeAt(b, x, y);
  const h = e.hint();
  assert.ok(h, '现搜照样给得出提示');
  assert.match(h.note, /现搜/, '路线被丢了，提示不该再自称"照题面路线"');
  assert.equal(e.stats().moves, 1, '提示自己就把这一步落了');
  assert.equal(e.pegCount(), spec.pegs - 1);
  assert.equal(has(b, ...e.bitmap(), idx(h.cells[0])), false, '起飞的孔空了');
  assert.equal(has(b, ...e.bitmap(), idx(h.cells[1])), false, '被吃的子拿走了');
  assert.equal(has(b, ...e.bitmap(), idx(h.cells[2])), true, '落点的珠子出现了');
});

test('渲染：选中、飞行、通关波、减弱动效全走一遍不炸', () => {
  const ctx = fakeCtx();
  for (const sizeKey of [25, 33, 37]) {
    const e = fresh(sizeKey, `render|${sizeKey}`);
    for (const reduce of [false, true]) {
      const v = viewFor(e, { reduce, hover: { x: 3, y: 3 } });
      e.draw(ctx, v, 0);
      const [a, , c] = e.spec.plan[0];
      e.down(...cellOf(e, a));
      e.draw(ctx, v, 120);                       // 选中态 + 落点空心圈
      e.down(...cellOf(e, c));
      e.draw(ctx, v, 60);                        // 飞行中 + 被吃珠淡出
      e.draw(ctx, v, 100000);                    // 动画早就结束了
      e.undo();
      e.draw(ctx, { ...v, hover: null, bad: [[0, 0]] }, 0);
    }
    while (!e.solved()) assert.ok(e.hint(), '通关动画需要一个胜局');
    for (const k of [0, 0.25, 0.5, 1]) e.celebrate(ctx, viewFor(e), 1000, k);
    e.draw(ctx, viewFor(e, { hover: { x: 0, y: 0 } }), 1);
  }
});

// 覆盖 peg 渲染用到的全部 2D 接口（ellipse 画落影、arcTo 走 paper.roundRect）
function fakeCtx() {
  const grad = { addColorStop() {} };
  return {
    fillStyle: null, strokeStyle: null, lineWidth: 0, globalAlpha: 1, font: '',
    textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    shadowColor: null, shadowBlur: 0, shadowOffsetY: 0,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, ellipse() {}, rect() {}, roundRect() {}, fill() {}, stroke() {},
    fillText() {}, clearRect() {}, fillRect() {}, setTransform() {}, translate() {}, scale() {},
    rotate() {}, setLineDash() {}, clip() {}, drawImage() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, arcTo2() {},
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
  };
}
