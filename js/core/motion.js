// 系统的"减弱动效"偏好在 CSS 里管得到（@media 那段），管不到 canvas：引擎的动画全是
// JS 画的，只认 view.reduce。这一层把 OS 偏好接进设置里那一个布尔，让开关与系统同源。
//
// 口径：OS 偏好只当**默认值**，玩家亲手拨过开关之后就以玩家为准 —— 否则每次开机
// 都被抢回去，那个复选框等于没有。这个"拨过"的标记单独存 key，不塞进 settings：
// settings 是要跟着存档导出导入的进度，它不该带一台机器的偏好痕迹。

import { store } from './storage.js';

const FLAG = 'nikoli.motion.manual.v1';

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function manual() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}

function markManual() {
  try { localStorage.setItem(FLAG, '1'); } catch { /* 隐身模式：只是记不住"拨过" */ }
}

// 开机调一次：把系统偏好落成设置的初值。已存过进度（玩家拨过）就不动。
export function initReduceMotion() {
  if (mq && !manual()) store.set('reduceMotion', mq.matches);
  return !!store.settings.reduceMotion;
}

// 设置面板里改动这个开关时调用，之后不再跟随系统。
export function reduceMotionTouched(on) {
  if (on) markManual();
}

// 系统中途切换（比如辅助功能里刚打开"减弱动态效果"）：立刻生效并重排棋盘。
export function watchReduceMotion(onChange) {
  if (!mq) return () => {};
  const handle = (e) => {
    if (manual()) return;
    store.set('reduceMotion', !!e.matches);
    onChange?.();
  };
  if (mq.addEventListener) mq.addEventListener('change', handle);
  else if (mq.addListener) mq.addListener(handle);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handle);
    else if (mq.removeListener) mq.removeListener(handle);
  };
}
