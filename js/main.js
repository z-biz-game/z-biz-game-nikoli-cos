// 入口：装好外壳，并给无头复验留一个只读句柄。

import { boot, debug } from './ui/app.js';
import { KINDS, byId } from './puzzles/registry.js';
import { loadArt } from './core/art.js';
import { registerSW } from './core/pwa.js';

boot();
// 位图（纸纹 / 玩法 sprite / 印章）异步进来，缺图照常玩；加载完成后首页与棋盘会自己补画。
loadArt();
registerSW();

window.nikoli = { KINDS, byId, debug, ready: () => debug.state.kind !== null };
