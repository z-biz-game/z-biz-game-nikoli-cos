// 注册表是"外壳 ↔ 引擎"的接缝，也是首页与每日挑战唯一的题源。它自己没有任何算法可测，
// 所以这里测的是三件接口上的事：
//   1) 每个玩法在注册表里都补齐了外壳要用的字段（少一个首页就画不出那张卡）；
//   2) 每个玩法声明的**每一个**档位都真能出题、开得起引擎（档位表不是装饰）；
//   3) dailySpec 只由日期决定，并且档位真的在轮转 —— 曾经按 i*3 切同一个哈希的高位，
//      实测 7 个玩法整月不换尺寸，"今天做哪档"其实从来没变过。
// 另有一条：index.html 里那个每日题数的静态占位，必须与 KINDS 同数，否则首屏会闪出错的分母。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KINDS, byId, dailySpec, dailySeed } from '../js/puzzles/registry.js';

const METHODS = ['down', 'move', 'up', 'undo', 'redo', 'canUndo', 'canRedo', 'hint', 'solved', 'stats', 'draw'];
// spec 与 board 是数据不是方法：契约里它们是"引擎交出来的东西"，外壳只读不调
const PROPS = ['spec', 'board'];

// 一个只会记账的空壳画布：draw 不许挑上下文，也不许在帧里读时钟以外的东西
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

test('注册表里每个玩法的外壳字段都齐：首页卡片与副笔文案都有着落', () => {
  assert.ok(KINDS.length >= 9, `只有 ${KINDS.length} 个玩法`);
  const ids = new Set();
  for (const k of KINDS) {
    assert.ok(!ids.has(k.id), `${k.id} 重复注册`);
    ids.add(k.id);
    assert.equal(byId(k.id), k, `${k.id} 查不回来`);
    assert.ok(k.title && k.latin && k.tagline, `${k.id} 的标题栏缺字`);
    assert.ok(Array.isArray(k.rules) && k.rules.length >= 3, `${k.id} 的"怎么玩"展不开`);
    assert.ok(k.unit, `${k.id} 没说进度按什么单位数`);
    assert.ok(Array.isArray(k.sizes) && k.sizes.length >= 3, `${k.id} 至少要有三档`);
    assert.ok(k.shell, `${k.id} 没在外壳表里登记：首页会拿到 undefined`);
    assert.ok(k.shell.glyph.length >= 1, `${k.id} 的图标是空的`);
    assert.ok(k.shell.tip && k.shell.primary, `${k.id} 少了主笔文案`);
    // 副笔要么有名字要么整个玩法就没有第二支笔 —— 半吊子会让工具条出现一个空按钮
    assert.equal(k.shell.dual, !!k.shell.secondary, `${k.id} 的 dual 与 secondary 对不上`);
    if (!k.shell.dual) assert.equal(k.shell.secondary, '');
  }
});

test('每个玩法声明的每一个档位都出得出题、开得起引擎', () => {
  for (const k of KINDS) {
    for (const size of k.sizes) {
      const spec = k.generate(`registry:${k.id}:${size.key}`, size.key);
      assert.equal(spec.kind, k.id, `${k.id} 的 ${size.key} 档交出来的不是自己的题`);
      assert.equal(typeof spec.seed, 'string');
      assert.ok(JSON.stringify(spec).length > 20, `${k.id}/${size.key} 题面是空的`);
      const e = k.create(JSON.parse(JSON.stringify(spec)));
      for (const m of METHODS) assert.equal(typeof e[m], 'function', `${k.id} 少了契约方法 ${m}`);
      for (const p of PROPS) assert.ok(e[p], `${k.id} 没交出契约字段 ${p}`);
      assert.equal(e.solved(), false, `${k.id}/${size.key} 一开局就算通关`);
      const st = e.stats();
      // par 是评星的唯一依据：可以不在题面里（数织从图形现算），但引擎必须报得出正数，
      // 且报了就必须与题面里那个一致 —— 两处各算一份就会有两个口径。
      assert.ok(st.par > 0 && Number.isFinite(st.par), `${k.id}/${size.key} 的 par=${st.par}：评星没有依据`);
      if (spec.par !== undefined) assert.equal(st.par, spec.par, `${k.id} 的 par 在引擎里换了个数`);
      assert.ok(st.total > 0 && st.moves === 0, `${k.id} 开局统计不对：${JSON.stringify(st)}`);
      assert.ok(e.board.cols > 0 && e.board.rows > 0);
      for (const side of ['l', 't', 'r', 'b']) {
        assert.ok(Number.isFinite(e.board.margin[side]), `${k.id} 的余量 ${side} 不是数`);
      }
      const { ctx, calls } = fakeCtx();
      const v = {
        cell: 30, ox: 20, oy: 20, cols: e.board.cols, rows: e.board.rows,
        w: 600, h: 600, dpr: 2, hover: { x: 0, y: 0 }, bad: [], reduce: false,
      };
      e.draw(ctx, v, 1000);
      assert.ok(calls.length > 10, `${k.id} 一帧什么都没画`);
      if (e.celebrate) e.celebrate(ctx, v, 1000, 0.5);
      // 提示必须真改状态：这是外壳唯一的"救急"入口，空转的提示比没有更坏
      const h = e.hint();
      assert.ok(h && Array.isArray(h.cells) && h.cells.length, `${k.id} 的提示没指出格子`);
      assert.equal(e.canUndo(), true, `${k.id} 的提示没进撤销栈`);
    }
  }
});

test('每日挑战只由日期决定，且同一套题在两条入口拿到的完全一致', () => {
  const a = dailySpec('2026-09-28');
  const b = dailySpec('2026-09-28');
  assert.deepEqual(a, b, '同一天两次算出来的题不一样');
  assert.equal(a.length, KINDS.length, '每日题数与玩法数脱钩：首页的分母会写错');
  assert.deepEqual(a.map((s) => s.kindId), KINDS.map((k) => k.id), '顺序与注册表不一致');
  for (const s of a) {
    assert.equal(s.seed, dailySeed('2026-09-28', s.kindId));
    assert.ok(byId(s.kindId).sizes.some((z) => z.key === s.sizeKey), `${s.kindId} 的每日档位 ${s.sizeKey} 不在档位表里`);
  }
  assert.notDeepEqual(dailySpec('2026-09-29'), a, '换了一天题面却一模一样');
});

test('档位真的在轮转：一个月里每个玩法的每一个档位都轮到过', () => {
  const days = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  for (const k of KINDS) {
    const hit = new Map(k.sizes.map((s) => [s.key, 0]));
    for (const day of days) {
      const s = dailySpec(day).find((x) => x.kindId === k.id);
      hit.set(s.sizeKey, hit.get(s.sizeKey) + 1);
    }
    const never = [...hit].filter(([, n]) => n === 0).map(([key]) => key);
    assert.deepEqual(never, [], `${k.id} 在 28 天里从没轮到过档位 ${never.join('/')}：轮转又退化成常数了`);
    const top = Math.max(...hit.values());
    assert.ok(top / days.length < 0.75, `${k.id} 的档位分布太偏（最热那档占 ${(top / days.length * 100) | 0}%`);
  }
});

test('index.html 里的静态占位与注册表同数：首屏不许闪出错误的分母', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/id="daily-total"[^>]*>([^<]*)</);
  assert.ok(m, 'index.html 里找不到每日题数的占位元素');
  assert.equal(m[1].trim(), `/${KINDS.length}`, `静态占位写着 ${m[1]}，注册表却有 ${KINDS.length} 个玩法`);
});
