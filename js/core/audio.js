// Synthesised sound only — no audio files in the repo. The context is created lazily
// on the first gesture because browsers refuse to start audio before one.
//
// 静音是**停掉整条音频链路**：ctx.suspend() + 一个振荡器节点都不许再建。
// 只把 master gain 设 0 是假静音 —— 上下文还在跑，解锁与延迟队列照旧出声。

import { store } from './storage.js';

let ctx = null;
let master = null;

export const isMuted = () => !store.settings.sound;

function ensure() {
  if (isMuted()) return null;
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* 手势之前起不来，正常 */ });
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

// 切换静音态要把已经活着的上下文真的停/续；没建过上下文就什么都不用做。
function applyMute() {
  if (!ctx) return;
  try {
    if (isMuted()) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
    else if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* 旧 Safari 上 suspend 可能是同步抛错，忽略 */ }
}

export function setMuted(next) {
  store.set('sound', !next);
  applyMute();
  return next;
}

export function toggleMuted() {
  return setMuted(!isMuted());
}

// 供探针与设置面板读：上下文到底停没停
export function audioState() {
  return ctx ? ctx.state : isMuted() ? 'muted-idle' : 'idle';
}

function tone({ f = 440, to = f, dur = 0.09, type = 'sine', gain = 0.15, delay = 0 }) {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (to !== f) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.06, gain = 0.08, filter = 1200 }) {
  const c = ensure();
  if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.frequency.value = filter;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bq).connect(g).connect(master);
  src.start();
}

export const sfx = {
  tap: () => { tone({ f: 620, to: 520, dur: 0.05, type: 'triangle', gain: 0.09 }); noise({ dur: 0.03, gain: 0.05, filter: 2600 }); },
  mark: () => tone({ f: 300, to: 240, dur: 0.05, type: 'square', gain: 0.05 }),
  erase: () => { noise({ dur: 0.06, gain: 0.07, filter: 900 }); },
  line: () => tone({ f: 480, to: 640, dur: 0.06, type: 'sine', gain: 0.07 }),
  click: () => tone({ f: 380, to: 300, dur: 0.045, type: 'triangle', gain: 0.07 }),
  bad: () => tone({ f: 190, to: 120, dur: 0.14, type: 'sawtooth', gain: 0.06 }),
  hint: () => { tone({ f: 880, dur: 0.07, gain: 0.09 }); tone({ f: 1170, dur: 0.09, gain: 0.07, delay: 0.06 }); },
  undo: () => tone({ f: 320, to: 220, dur: 0.07, type: 'triangle', gain: 0.06 }),
  complete: () => { noise({ dur: 0.09, gain: 0.1, filter: 700 }); tone({ f: 200, to: 90, dur: 0.18, type: 'square', gain: 0.07 }); },
  win: () => [0, 0.1, 0.2, 0.34].forEach((d, i) => tone({ f: [523, 659, 784, 1047][i], dur: 0.3, gain: 0.11, delay: d, type: 'triangle' })),
  unlock: () => ensure(),
};

export function haptic(ms = 8) {
  if (navigator.vibrate && store.settings.sound) navigator.vibrate(ms);
}
