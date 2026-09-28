// 玩法注册表：引擎模块只提供题与棋盘，这里补上"外壳需要知道、引擎不该关心"的那部分
// —— 首页图标、副笔在这玩法里是什么意思。加一个玩法在本文件里就三处：上面一条 import、
// SHELL 一条（glyph/dual/primary/secondary/tip）、KINDS 末尾一个；再往仓外还得跟上
// tools/playtest.mjs 的 PLAN 与那条"该怎么点"，否则新玩法进不了 CI 这道门。

import { hashSeed } from '../core/rng.js';
import nonogram from '../puzzles/nonogram.js';
import numberlink from '../puzzles/numberlink.js';
import lightsout from '../puzzles/lightsout.js';
import pegsolitaire from '../puzzles/pegsolitaire.js';
import nurikabe from '../puzzles/nurikabe.js';
import tents from '../puzzles/tents.js';
import akabane from '../puzzles/akabane.js';
import hitori from '../puzzles/hitori.js';
import slant from '../puzzles/slant.js';
import shikaku from '../puzzles/shikaku.js';
import dominosa from '../puzzles/dominosa.js';

const SHELL = {
  nonogram: { glyph: '▩', dual: true, primary: '涂黑', secondary: '画叉', tip: '按住拖动可以一次涂一排' },
  numberlink: { glyph: '⤳', dual: true, primary: '连线', secondary: '擦除', tip: '从圆点起手拖出路径，拖回自己即截断' },
  lightsout: { glyph: '◉', dual: false, primary: '按灯', secondary: '', tip: '按一格会连带翻转上下左右' },
  pegsolitaire: { glyph: '◐', dual: false, primary: '跳子', secondary: '', tip: '点一颗珠子，再点它跳过的位置' },
  nurikabe: { glyph: '▚', dual: true, primary: '落墨', secondary: '打点', tip: '墨滴连成岛，海要用点标出来' },
  tents: { glyph: '▲', dual: true, primary: '搭帐', secondary: '记不放', tip: '每棵树旁一顶帐，帐篷连斜角都不许挨着' },
  akabane: { glyph: '◧', dual: true, primary: '涂色', secondary: '打叉', tip: '空格点一下涂黑、再点涂白；2×2 不许四格同色' },
  hitori: { glyph: '◣', dual: true, primary: '划黑', secondary: '点小圆点', tip: '划掉的格子互不相接；留下的数字行与列里不许撞' },
  slant: { glyph: '╱', dual: true, primary: '画斜线', secondary: '记一笔', tip: '点一下是 "/"、再点换 "\\"；按住拖动可以把同方向一路画过去' },
  shikaku: { glyph: '▦', dual: true, primary: '围一间', secondary: '擦掉', tip: '拖出一个长方形把它围成一间，也可以点两下选两个对角；一间只能有一个数字' },
  dominosa: { glyph: '▬', dual: true, primary: '连一块', secondary: '划界线', tip: '点一格再点它的邻格落一块骨牌，按住拖过两格也算一手；点到已成的那块就整块擦掉；副笔两下是在两格之间划一条「不许配对」的界线（记事不收步，拖动不算副笔）' },
};

export const KINDS = [nonogram, numberlink, lightsout, pegsolitaire, nurikabe, tents, akabane, hitori, slant, shikaku, dominosa]
  .map((k) => ({ ...k, shell: SHELL[k.id] }));

export const byId = (id) => KINDS.find((k) => k.id === id) || null;

// 每日种子集中在这里算，首页和路由两条入口才能拿到同一道题。
export const dailySeed = (day, kindId) => `nikoli-daily|${day}|${kindId}`;

// 每日挑战的题面只由日期决定：同一天的那一套题在所有设备上是同一套。
// 尺寸也按日期轮转，这样"今天做哪档"不是玩家能挑的 —— 挑不了才叫挑战。
//
// 轮转必须吃整颗种子的哈希，不能像以前那样从同一个 h 上按 i*3 位去切：日期串只有末两位在变，
// 高位段几乎天天一样，实测有 7 个玩法在 28 天里一次都没换过尺寸（10×10 那档永远轮不到）。
// 现在每个玩法各自哈希一次，位段之间不再互相借位，玩法加到多少个都不会溢出。
export function dailySpec(day) {
  return KINDS.map((k) => {
    const seed = dailySeed(day, k.id);
    return { kindId: k.id, sizeKey: k.sizes[hashSeed(seed) % k.sizes.length].key, seed };
  });
}
