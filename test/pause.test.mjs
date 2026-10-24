#!/usr/bin/env node
// 暂停这一腿：真暂停必须同时立住三件事 —— 表停、闸门关、恢复接着走。少一件就不叫暂停。
//
// 这里不打桩 app.js 的逻辑：装一套假 DOM（元素 / 画布 / 画笔 / 事件）与一只手摇时钟
// （假 performance.now + 假 rAF），然后驱动**真的**外壳（js/ui/app.js）与**真的**棋盘视图
// （js/ui/board_view.js）：真指针事件打到真引擎上，真按钮与真快捷键走真动作。
// 全程不等真实时间 —— 时钟只由用例往前拨，所以这条腿不会因为机器忙而变红。
//
// 四条断言（对应「暂停真停什么 / 恢复不丢什么」）：
//   1. 暂停期间表不前进：走 5 秒假时间，elapsedMs() 一格不动；
//   2. 暂停期间输入全被拒：落子 / 擦 / 提示 / 撤销 / 键盘都不改引擎状态（引擎一个调用都不许收到）；
//   3. 恢复后接着走：再走 500ms，已用时间恰好 +500（不丢也不多算）；
//   4. 反复暂停/恢复三次：表仍然自洽（三段暂停的时间都从表上摘掉）。
// 另加两腿：暂停期间一帧都不推进（rAF 停掉），以及拖到一半按下暂停时抬手那一笔的收尾不许落在暂停之后。
import test from 'node:test';
import assert from 'node:assert/strict';

// ---- 手摇时钟：假 performance.now + 假 rAF --------------------------------------------
// 起点不是 0：引擎自己也会读 performance.now（动画与预算保险丝都看它）。
const clock = { t: 1000 };
Object.defineProperty(globalThis.performance, 'now', {
  value: () => clock.t, configurable: true, writable: true,
});

const raf = {
  seq: 0,
  pending: new Map(),
  runs: 0,
  request(cb) { const id = ++this.seq; this.pending.set(id, cb); return id; },
  cancel(id) { this.pending.delete(id); },
  // 手动推进一帧：把此刻挂着的回调跑一遍（回调会再挂下一个，所以这是一次真实推进）。
  tick(t = clock.t) {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const cb of waiting) { this.runs += 1; cb(t); }
    return waiting.length;
  },
};
globalThis.requestAnimationFrame = (cb) => raf.request(cb);
globalThis.cancelAnimationFrame = (id) => raf.cancel(id);

// ---- 假 DOM：元素 / 画布 / 画笔 / 事件 ------------------------------------------------
const listeners = new WeakMap();
const addListener = (node, type, fn) => {
  let m = listeners.get(node);
  if (!m) { m = new Map(); listeners.set(node, m); }
  if (!m.has(type)) m.set(type, []);
  m.get(type).push(fn);
};
const fire = (node, type, ev) => {
  const m = listeners.get(node);
  if (!m || !m.has(type)) return false;
  for (const fn of m.get(type)) fn(ev);
  return true;
};

// 画笔：任何方法都是空操作，只有那几个"返回一个对象"的方法要给个像样的返回值。
const ctx2d = () => new Proxy({}, {
  get(t, prop) {
    if (prop === 'measureText') return () => ({ width: 8 });
    if (prop === 'createPattern') return () => null;
    if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
      return () => ({ addColorStop() {} });
    }
    if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (prop in t) return t[prop];
    return () => {};
  },
  set(t, prop, v) { t[prop] = v; return true; },
});

const makeEl = (tag = 'div') => {
  const node = {
    tagName: String(tag).toUpperCase(),
    hidden: false, textContent: '', value: '', open: false, title: '', type: '',
    style: {}, dataset: {}, width: 0, height: 0,
    clientWidth: 400, clientHeight: 400,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : !!force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
      contains(c) { return this._s.has(c); },
    },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {},
    addEventListener(t, fn) { addListener(node, t, fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    showModal() { node.open = true; }, close() { node.open = false; },
    focus() {}, blur() {}, click() {},
    getContext() { return ctx2d(); },
    getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }; },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  return node;
};

const els = new Map();
const doc = {
  body: makeEl('body'),
  documentElement: makeEl('html'),
  hidden: false,
  fullscreenElement: null,
  webkitFullscreenElement: null,
  baseURI: 'http://127.0.0.1/',
  querySelector(sel) {
    if (!els.has(sel)) els.set(sel, makeEl());
    return els.get(sel);
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); },
  addEventListener(t, fn) { addListener(doc, t, fn); },
  removeEventListener() {},
};

const win = {
  devicePixelRatio: 1,
  addEventListener(t, fn) { addListener(win, t, fn); },
  removeEventListener() {},
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
  AudioContext: undefined,   // 没有音频设备：音效这一路自然空转，不影响棋盘
};

globalThis.window = win;
globalThis.document = doc;
globalThis.location = { hash: '' };
globalThis.history = { replaceState() {} };
globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() {} unobserve() {} disconnect() {} };
globalThis.Image = class { set src(v) { this._src = v; } };

// ---- 真的外壳与真的棋盘视图（假 DOM 装好之后才 import）--------------------------------
const app = await import('../js/ui/app.js');
const { byId } = await import('../js/puzzles/registry.js');
app.boot();

const debug = app.debug;

// 开一局真的游戏（真引擎、真题面），返回这一局的手柄。
const startGame = (id, sizeKey) => {
  const kind = byId(id);
  debug.start(kind, sizeKey, 0, false);
  return { kind, view: debug.view(), engine: debug.state.engine };
};

// 真指针事件：按格坐标算出画布上的位置，打到真的 canvas 上。
const cellEvent = (col, row, button = 0) => {
  const v = debug.view().view;
  return {
    clientX: v.ox + col * v.cell + 1,
    clientY: v.oy + row * v.cell + 1,
    button,
    altKey: false,
    pointerId: 1,
    preventDefault() {},
  };
};

// 走页面自己的按钮：真 click 事件派发到 body 上那个真监听器。
const clickAction = (action) => fire(doc.body, 'click', {
  target: { closest: (sel) => (sel === '[data-action]' ? { dataset: { action } } : null) },
});
// 走页面自己的快捷键。
const pressKey = (key) => fire(win, 'keydown', {
  key, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {},
});

// 引擎状态的快照：盘面 + 账（moves / done）。两个引擎各给一个读法，谁都不 import。
const snap = (engine) => {
  const { cols, rows } = engine.board;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cells.push(engine.cellState ? engine.cellState(x, y) : engine.ownerAt(x, y));
    }
  }
  return JSON.stringify({ cells, stats: engine.stats() });
};

// 给引擎装一个探针：暂停期间它一个调用都不该收到（比"盘面没变"更严 —
// 引擎被叫到却碰巧没改盘面，也算漏网）。
const spyOn = (engine) => {
  const calls = [];
  for (const k of ['down', 'move', 'up', 'undo', 'redo', 'hint']) {
    const orig = engine[k];
    engine[k] = (...args) => { calls.push(k); return orig(...args); };
  }
  return calls;
};

test('暂停期间表不前进：走 5 秒假时间，elapsedMs() 一格不动', () => {
  startGame('lightsout', 4);
  clock.t += 5000;
  assert.equal(debug.elapsed(), 5000, '没暂停时表在走');
  debug.setPaused(true);
  assert.equal(debug.elapsed(), 5000, '暂停那一刻把已用时间结算进去，一秒都不许丢');
  const paused = debug.elapsed();
  clock.t += 5000;
  assert.equal(debug.elapsed(), paused, '暂停期间表一格不动');
  debug.setPaused(false);
});

test('暂停期间输入全被拒：落子 / 擦 / 提示 / 撤销 / 键盘都不改引擎状态', () => {
  const { view, engine } = startGame('lightsout', 4);
  view.down(cellEvent(0, 0));     // 先落一子，盘面才有东西可比
  view.up();
  const before = snap(engine);
  const moves = engine.stats().moves;
  const calls = spyOn(engine);

  debug.setPaused(true);
  calls.length = 0;               // 暂停的那一刻允许收掉在飞的那一笔（等于抬手），之后一个都不许有

  view.down(cellEvent(1, 1));     // 落子
  view.down(cellEvent(1, 1, 1));  // 擦（副笔）
  view.move(cellEvent(2, 2));     // 拖
  view.up();                      // 抬手
  view.press(true);               // 键盘落子
  clickAction('hint');            // 提示按钮
  clickAction('undo');            // 撤销按钮
  clickAction('redo');            // 重做按钮
  pressKey('h');                  // 提示快捷键
  pressKey('z');                  // 撤销快捷键
  pressKey('Z');                  // 重做快捷键
  pressKey(' ');                  // 键盘落子

  assert.deepEqual(calls, [], '暂停期间引擎一个调用都不许收到');
  assert.equal(snap(engine), before, '引擎状态一个字节都不许动');
  assert.equal(engine.stats().moves, moves, '步数也不许动');
  assert.equal(debug.state.hints, 0, '提示次数也不许涨');
});

test('恢复后接着走：再走 500ms，已用时间恰好 +500（不丢也不多算）', () => {
  startGame('lightsout', 4);
  clock.t += 1000;
  debug.setPaused(true);
  assert.equal(debug.elapsed(), 1000, '暂停那一刻的已用时间不许丢');
  clock.t += 5000;                // 暂停那 5 秒不进表
  const paused = debug.elapsed();
  debug.setPaused(false);
  clock.t += 500;
  assert.equal(debug.elapsed(), paused + 500, '从暂停那一刻接着走，一格不多一格不少');
});

test('反复暂停/恢复三次：表仍然自洽（三段暂停的时间都从表上摘掉）', () => {
  startGame('lightsout', 4);
  const base = debug.elapsed();
  for (let i = 0; i < 3; i++) {
    clock.t += 1000;              // 跑 1 秒
    debug.setPaused(true);
    clock.t += 7000;              // 暂停 7 秒
    debug.setPaused(false);
  }
  assert.equal(debug.elapsed(), base + 3000, '三段暂停（各 7 秒）都不进表');
});

test('暂停期间一帧都不推进：rAF 停掉，恢复后重新走', () => {
  startGame('lightsout', 4);
  raf.tick();
  const runs = raf.runs;
  debug.setPaused(true);
  raf.tick();
  assert.equal(raf.runs, runs, '暂停期间渲染一帧都不许进');
  debug.setPaused(false);
  raf.tick();
  assert.ok(raf.runs > runs, '恢复后帧循环重新走');
});

test('拖到一半按下暂停：在飞的那一笔在暂停那一刻收掉，之后抬手不落到引擎上', () => {
  const { view, engine } = startGame('shikaku', 6);
  const calls = spyOn(engine);
  view.down(cellEvent(0, 0));     // 按下（引擎收到 down）
  view.move(cellEvent(1, 1));     // 拖（引擎收到 move）
  debug.setPaused(true);          // 暂停：在飞的那一笔在闸门关之前收掉（相当于抬手）
  assert.ok(calls.includes('up'), '在飞的那一笔在暂停那一刻收掉（引擎收到 up）');
  calls.length = 0;               // 只看暂停之后
  view.up();                      // 抬手：闸门关着，不许再落到引擎上
  assert.deepEqual(calls, [], '暂停期间引擎一个调用都不许收到');
});

test('闸门关着时抬手不落到引擎上（画布那一层的守卫）', () => {
  const { view, engine } = startGame('shikaku', 6);
  const calls = spyOn(engine);
  view.down(cellEvent(0, 0));     // 按下，在飞的一笔
  debug.state.paused = true;      // 直接把闸门关上：这一条测画布那一层的守卫本身
  calls.length = 0;
  view.up();                      // 抬手：闸门关着，不许落到引擎上
  assert.deepEqual(calls, [], '闸门关着时抬手不许落到引擎上');
  debug.state.paused = false;
});

test('恢复之后输入重新有效：落子照旧落到引擎上', () => {
  const { view, engine } = startGame('lightsout', 4);
  debug.setPaused(true);
  view.down(cellEvent(1, 1));     // 暂停中：落子被拒
  const paused = snap(engine);
  debug.setPaused(false);
  view.down(cellEvent(1, 1));     // 恢复后：落子照旧
  assert.notEqual(snap(engine), paused, '恢复后输入重新有效');
});
