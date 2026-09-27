// 棋盘视图：把引擎的"格"世界映射到一块 device-pixel 对齐的画布上，并把指针事件还原成
// 整数格坐标。引擎永远只吃格坐标，所以同一套输入代码在手机上（拖拽）和桌面上
// （鼠标 + 键盘光标）行为一致。

import { store } from '../core/storage.js';

const PAD = 10;
const MIN_CELL = 16;

export class BoardView {
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.engine = null;
    this.view = null;
    this.hover = null;
    this.running = false;
    this.frame = null;
    this.dragging = false;
    this.lastCell = null;
    this.winAt = 0;
    this.tool = 0;
    this.onInput = null;
    this.onFrame = null;
    this.onWin = null;

    const opt = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), opt);
    canvas.addEventListener('pointermove', (e) => this.move(e), opt);
    canvas.addEventListener('pointerup', (e) => this.up(e), opt);
    canvas.addEventListener('pointercancel', (e) => this.up(e), opt);
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.layout()).observe(wrap);
  }

  attach(engine) {
    this.engine = engine;
    this.hover = null;
    this.lastCell = null;
    this.dragging = false;
    this.resetWin();
    this.layout();
    this.start();
  }

  layout() {
    const e = this.engine;
    if (!e) return;
    const b = e.board;
    const availW = Math.max(120, this.wrap.clientWidth - 2);
    const availH = Math.max(120, this.wrap.clientHeight - 2);
    const totalW = b.cols + b.margin.l + b.margin.r;
    const totalH = b.rows + b.margin.t + b.margin.b;
    const cell = Math.max(MIN_CELL, Math.min(availW / totalW, availH / totalH));
    const w = Math.round(cell * totalW + PAD * 2);
    const h = Math.round(cell * totalH + PAD * 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.view = {
      cell,
      ox: Math.round(PAD + b.margin.l * cell),
      oy: Math.round(PAD + b.margin.t * cell),
      cols: b.cols,
      rows: b.rows,
      w, h, dpr,
      hover: null,
      reduce: !!store.settings.reduceMotion,
    };
  }

  cellAt(ev) {
    const v = this.view;
    if (!v) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left - v.ox) / v.cell);
    const y = Math.floor((ev.clientY - r.top - v.oy) / v.cell);
    return { x, y };
  }

  down(ev) {
    const e = this.engine;
    if (!e || !this.view) return;
    const c = this.cellAt(ev);
    if (!c) return;
    ev.preventDefault();
    try { this.canvas.setPointerCapture(ev.pointerId); } catch { /* already captured */ }
    this.hover = c;
    this.view.hover = c;
    const btn = ev.button === 2 || ev.altKey ? 1 : (this.tool || 0);
    this.dragging = true;
    this.lastCell = c;
    const changed = e.down(c.x, c.y, btn);
    this.afterInput(changed);
  }

  move(ev) {
    const e = this.engine;
    if (!e || !this.view) return;
    const c = this.cellAt(ev);
    this.hover = c;
    this.view.hover = c;
    if (!this.dragging) return;
    if (this.lastCell && this.lastCell.x === c.x && this.lastCell.y === c.y) return;
    ev.preventDefault();
    this.lastCell = c;
    const changed = e.move(c.x, c.y);
    this.afterInput(changed);
  }

  up() {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastCell = null;
    const changed = this.engine && this.engine.up();
    this.afterInput(!!changed);
  }

  afterInput(changed) {
    // strokeEnd: 抬手才算一次完整输入 —— 求解器级的检查不该跟着 pointermove 每帧跑
    if (changed && this.onInput) this.onInput(!this.dragging);
    if (this.engine && this.engine.solved()) {
      this.dragging = false;
      if (this.onWin) this.onWin();
    }
  }

  // 键盘光标：桌面无鼠标悬停时也能精确落子
  nudge(dx, dy) {
    const v = this.view;
    if (!v) return;
    const cur = this.hover && this.hover.x >= 0 ? this.hover : { x: 0, y: 0 };
    this.hover = {
      x: Math.max(0, Math.min(v.cols - 1, cur.x + dx)),
      y: Math.max(0, Math.min(v.rows - 1, cur.y + dy)),
    };
    v.hover = this.hover;
  }

  press(cursor = false) {
    if (!this.engine || !this.view) return;
    const c = cursor ? (this.hover || { x: 0, y: 0 }) : this.hover;
    if (!c) return;
    this.view.hover = c;
    const changed = this.engine.down(c.x, c.y, this.tool || 0);
    this.engine.up();
    this.afterInput(changed);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (t) => {
      if (!this.running) return;
      this.render(t);
      if (this.onFrame) this.onFrame(t);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  render(t) {
    const e = this.engine;
    const v = this.view;
    if (!e || !v) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(v.dpr, v.dpr);
    ctx.clearRect(0, 0, v.w, v.h);
    if (this.winAt && !v.reduce) {
      const k = Math.min(1, (t - this.winAt) / 1100);
      if (e.celebrate) e.celebrate(ctx, v, t, k);
      else e.draw(ctx, v, t);
    } else {
      e.draw(ctx, v, t);
    }
    ctx.restore();
  }

  win() {
    this.winAt = performance.now();
  }

  resetWin() {
    this.winAt = 0;
  }
}
