// 暂停契约：一个纯模块，不碰 DOM / window —— node 里能直接 import，用假时钟驱动它。
//
// 一次暂停要同时立住三件事，少一件就不叫暂停：
//   1. 表停：暂停期间不再吃墙上时间（把已用时间结算进 elapsed，恢复时重开 startedAt）；
//   2. 闸门关：凡是会改盘面的动作都先问一句 lockedAt()，锁着就一个字节都不往引擎上送；
//   3. 恢复接着走：引擎状态一个字节都不动，已用时间不多算也不少算。
//
// 状态用外壳自己的那四个字段（elapsed / startedAt / paused / finished）—— 这一局的表只有一份，
// 模块不另藏一份。引擎那边什么也不碰：暂停是外壳的事，棋盘内部的一切属于引擎。

// 这一局已经用了多少毫秒。暂停中就是结算好的那一份，不再吃墙上时间。
export const elapsedOf = (st, now) => (st.paused ? st.elapsed : st.elapsed + (now - st.startedAt));

// 暂停：把已用时间结算进 elapsed，之后表不再走。
export const pauseAt = (st, now) => {
  if (st.paused) return false;
  st.elapsed = elapsedOf(st, now);
  st.paused = true;
  return true;
};

// 恢复：从这一刻接着走。暂停那段时间不进表 —— 不丢，也不重复算。
export const resumeAt = (st, now) => {
  if (!st.paused) return false;
  st.startedAt = now;
  st.paused = false;
  return true;
};

// 开新一局：表归零，闸门打开（换题不带上局的暂停态，否则新棋盘永远不吃输入）。
export const resetAt = (st, now) => {
  st.elapsed = 0;
  st.startedAt = now;
  st.paused = false;
  st.finished = false;
};

// 解开了：这一局打完，表停住（结算面板上那段时间已经记下来了，闸门重新打开）。
export const finishAt = (st) => {
  st.paused = true;
  st.finished = true;
};

// 输入闸门：暂停中 + 这一局还没打完 + 棋盘屏在场 —— 三件都成立才锁。
export const lockedAt = (st, visible = true) => !!(st.paused && !st.finished && visible);
