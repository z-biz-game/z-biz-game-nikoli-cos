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
  assert.ok(KINDS.length >= 10, `只有 ${KINDS.length} 个玩法`);
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

// 接进来的第十一款玩法不许挤动别人的排期：dailySpec 是按 kind 各自哈希整颗种子的，
// 加一个 kind 既不该改变别人某一天的档位，也不该改变别人任何一天的题面。下面这十行是
// **接 dominosa 之前**（HEAD da0b4a0）用真实 dailySpec() 跑出来的 28 天读数，逐字节钉在这里 ——
// 谁把轮转公式改回"从同一个 h 上切位段"，这条就当众红。
// 取证脚本：工作区根 _tmp-dominosa-wire-rotation.mjs（接线前后各跑一遍再 diff）。
const ROTATION_BEFORE = {
  nonogram: '5,7,12,7,5,10,12,15,12,12,7,10,10,7,12,7,7,5,12,10,10,5,12,7,15,12,12,7',
  numberlink: '4,6,6,5,6,6,4,6,6,5,4,5,5,5,4,4,5,4,4,5,6,5,5,5,4,4,6,4',
  lightsout: '6,5,4,7,6,5,4,7,6,6,7,4,5,6,7,4,5,6,7,5,4,7,6,5,4,7,6,5',
  pegsolitaire: '25,25,37,37,25,33,25,25,25,25,37,25,33,37,37,37,25,37,25,33,33,37,33,37,25,25,33,25',
  nurikabe: '10,8,7,10,10,10,7,8,8,8,8,10,10,10,10,10,10,7,7,8,8,10,8,8,8,10,8,7',
  tents: '6,8,6,6,8,8,6,10,6,6,10,6,8,8,10,6,6,6,6,6,6,6,8,8,10,8,8,10',
  akabane: '10,10,6,6,8,10,8,8,10,6,8,8,10,8,6,10,8,8,10,10,6,10,6,6,10,6,8,6',
  hitori: '6,10,10,6,6,6,6,6,10,6,6,10,6,8,6,10,6,8,6,6,10,8,6,6,8,10,6,10',
  slant: '10,10,8,6,8,10,6,6,8,8,8,8,10,8,6,8,10,6,8,6,8,8,10,6,10,6,10,6',
  shikaku: '10,6,8,6,8,10,8,8,6,6,10,8,10,6,6,6,6,6,6,6,8,6,10,6,6,10,6,6',
};

test('加玩法不改别人的排期：其余十款的 28 天档位序列与接线前逐字节相同', () => {
  assert.deepEqual(KINDS.map((k) => k.id).filter((id) => id in ROTATION_BEFORE), Object.keys(ROTATION_BEFORE),
    '注册表里这批老玩法的顺序变了：每日题按 kind 各自哈希，首页与存档却按这个顺序排');
  const days = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  for (const [id, want] of Object.entries(ROTATION_BEFORE)) {
    const k = byId(id);
    assert.ok(k, `${id} 从注册表里消失了`);
    const got = days.map((d) => (dailySpec(d).find((x) => x.kindId === id) || {}).sizeKey);
    assert.equal(got.every((key) => k.sizes.some((s) => s.key === key)), true, `${id} 轮转出档位表外的尺寸`);
    assert.equal(got.join(','), want, `${id} 的 28 天排期被别的玩法带跑了：\n  接线前 ${want}\n  现  在 ${got.join(',')}`);
  }
});

// 玩法数量在三个门面上各说各话过整整一轮：package.json 与 index.html 停在"四"，README 已经写到"十"。
// 这种不一致靠人记是记不住的，所以钉成断言：三处凡是以「N种玩法 / N种纸笔推理谜题」的形式报数的地方，
// 那个汉字数字必须等于 KINDS.length。
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

test('玩法数量的口径一致：README / package.json / index.html 不许还写着上一次那个数', () => {
  const want = CN[KINDS.length];
  assert.ok(want, `KINDS.length=${KINDS.length} 超出汉字数词表，先扩 CN 表再跑`);
  const hits = [];
  for (const f of ['../README.md', '../package.json', '../index.html']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/[一二三四五六七八九十]+种(?:玩法|纸笔推理谜题)/g)) hits.push({ f, said: m[0] });
  }
  assert.ok(hits.length >= 3, `只找到 ${hits.length} 处报数的文案，注册表有 ${KINDS.length} 款：这条检查空转了`);
  for (const h of hits) {
    assert.ok(h.said.startsWith(want), `${h.f} 写的是「${h.said}」，注册表却是 ${KINDS.length} 款：应改成「${want}…」`);
  }
});
