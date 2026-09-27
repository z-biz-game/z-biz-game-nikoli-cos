// 玩法注册表：引擎模块只提供题与棋盘，这里补上"外壳需要知道、引擎不该关心"的那部分
// —— 首页图标、副笔在这玩法里是什么意思。新增玩法只需要加一个文件加一行。

import nonogram from '../puzzles/nonogram.js';
import numberlink from '../puzzles/numberlink.js';
import lightsout from '../puzzles/lightsout.js';
import pegsolitaire from '../puzzles/pegsolitaire.js';
import nurikabe from '../puzzles/nurikabe.js';
import tents from '../puzzles/tents.js';
import akabane from '../puzzles/akabane.js';

const SHELL = {
  nonogram: { glyph: '▩', dual: true, primary: '涂黑', secondary: '画叉', tip: '按住拖动可以一次涂一排' },
  numberlink: { glyph: '⤳', dual: true, primary: '连线', secondary: '擦除', tip: '从圆点起手拖出路径，拖回自己即截断' },
  lightsout: { glyph: '◉', dual: false, primary: '按灯', secondary: '', tip: '按一格会连带翻转上下左右' },
  pegsolitaire: { glyph: '◐', dual: false, primary: '跳子', secondary: '', tip: '点一颗珠子，再点它跳过的位置' },
  nurikabe: { glyph: '▚', dual: true, primary: '落墨', secondary: '打点', tip: '墨滴连成岛，海要用点标出来' },
  tents: { glyph: '▲', dual: true, primary: '搭帐', secondary: '记不放', tip: '每棵树旁一顶帐，帐篷连斜角都不许挨着' },
  akabane: { glyph: '◧', dual: true, primary: '涂色', secondary: '打叉', tip: '空格点一下涂黑、再点涂白；2×2 不许四格同色' },
};

export const KINDS = [nonogram, numberlink, lightsout, pegsolitaire, nurikabe, tents, akabane].map((k) => ({ ...k, shell: SHELL[k.id] }));

export const byId = (id) => KINDS.find((k) => k.id === id) || null;

// 每日种子集中在这里算，首页和路由两条入口才能拿到同一道题。
export const dailySeed = (day, kindId) => `nikoli-daily|${day}|${kindId}`;

// 每日挑战的题面只由日期决定：同一天的四道题在所有设备上是同一套。
// 尺寸按日期轮转，这样"今天做哪档"也不是玩家能挑的 —— 挑不了才叫挑战。
export function dailySpec(day) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (Math.imul(h, 31) + day.charCodeAt(i)) >>> 0;
  return KINDS.map((k, i) => ({
    kindId: k.id,
    sizeKey: k.sizes[(h >> (i * 3)) % k.sizes.length].key,
    seed: dailySeed(day, k.id),
  }));
}
