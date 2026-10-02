// 位图资产的唯一入口：三张由 assets/gen/make_art.py 生成的 PNG 在这里加载、缓存、分发。
//
// 为什么全部走"加载失败就当没有"：纹理与 sprite 是装饰，不是玩法。404、断网、
// Pages 子路径算错，任何一种都不该把棋盘冻成白块 —— 缺图时 has() 恒为 false，
// 调用方各自的文字/纯色兜底就是它本来的样子。

const SRC = {
  paper: 'assets/textures/paper-512.png',
  glyphs: 'assets/sprites/glyphs.png',
  stamp: 'assets/sprites/stamp.png',
};

// 与 assets/sprites/glyphs.txt 同一份顺序：sprite 是横向 atlas，一格一种玩法。
export const GLYPH_ORDER = ['nonogram', 'numberlink', 'lightsout', 'pegsolitaire', 'nurikabe',
  'tents', 'akabane', 'hitori', 'slant', 'shikaku', 'dominosa'];
const GLYPH_CELL = 120;
// 结算印章 sprite 的三态：0 淡（用过提示）/ 1 实（干净解开）/ 2 褪（动画收尾）
export const STAMP_FAINT = 0;
export const STAMP_FULL = 1;
export const STAMP_PALE = 2;
const STAMP_CELL = 128;

const imgs = {};
const patterns = new Map();
const readyCallbacks = [];
let ready = false;

export function loadArt() {
  const jobs = Object.entries(SRC).map(([key, path]) => new Promise((done) => {
    const im = new Image();
    im.onload = () => { imgs[key] = im; done(); };
    im.onerror = () => done();          // 缺图照常玩：has() 会一直返回 false
    im.src = path;
  }));
  return Promise.all(jobs).then(() => {
    ready = true;
    for (const cb of readyCallbacks.splice(0)) cb();
    return imgs;
  });
}

export function onArtReady(cb) {
  if (ready) cb();
  else readyCallbacks.push(cb);
}

export const has = (key) => !!imgs[key];

// createPattern 每帧新建会把 GC 压满；按 ctx 缓存一份就够了。
export function paperPattern(ctx) {
  const im = imgs.paper;
  if (!im) return null;
  let pat = patterns.get(ctx);
  if (pat === undefined) {
    try { pat = ctx.createPattern(im, 'repeat'); } catch { pat = null; }
    patterns.set(ctx, pat);
  }
  return pat || null;
}

export function glyphCell(kindId) {
  return GLYPH_ORDER.indexOf(kindId);
}

// 玩法题头：把 atlas 里那一格画进一块小画布（首页卡片与每日格共用）。
// 图没到位就什么都不画，调用方保留原来的文字 glyph 兜底。
export function paintGlyph(canvas, kindId, cssSize) {
  const im = imgs.glyphs;
  const idx = glyphCell(kindId);
  if (!im || idx < 0 || !canvas) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.round(cssSize * dpr);
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, idx * GLYPH_CELL, 0, GLYPH_CELL, GLYPH_CELL, 0, 0, px, px);
  return true;
}

export function paintStamp(canvas, frame = STAMP_FULL, cssSize = 64) {
  const im = imgs.stamp;
  if (!im || !canvas) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.round(cssSize * dpr);
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const f = Math.max(0, Math.min(2, frame | 0));
  ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, f * STAMP_CELL, 0, STAMP_CELL, STAMP_CELL, 0, 0, px, px);
  return true;
}

// 棋盘上的印章：celebrate() 用它把"解开"盖在纸上，k 是 0→1 的进度。
export function drawStamp(ctx, cx, cy, size, frame = STAMP_FULL, alpha = 1) {
  const im = imgs.stamp;
  if (!im) return false;
  const f = Math.max(0, Math.min(2, frame | 0));
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(cx, cy);
  ctx.rotate(-0.06);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, f * STAMP_CELL, 0, STAMP_CELL, STAMP_CELL, -size / 2, -size / 2, size, size);
  ctx.restore();
  return true;
}
