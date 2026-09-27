// 数间 / Shikaku —— 把整张盘子切成长方形：每块里恰好一个数字，块的面积就是那个数字。
//
// 规则只有两句，约束却互相咬住：一个数字的候选矩形是"含住自己、面积等于自己"的全部摆法；
// 两块抢同一格就只能活一块；某个数字的候选被清空，就说明前面有一笔是错的。
// 于是"这一格归谁"是盘面上唯一值得记的事实 —— 状态就是一个 owner 数组，候选池随时从它重算，
// 擦掉一笔，池子就退回"剩下的笔迹恰好逼得出"的那个大小。
//
// 三条线分得很清，和数织/帐篷/五寸钉同一口径：
//   · propagate —— 只写"在任何解里都成立"的格，永不猜。能刷满盘就是唯一性证明本身。
//   · countSolutions —— 与传播层毫无瓜葛的另一套实现（直接枚举矩形），只当保险丝：
//     数到第二种就早停，预算烧完如实报 capped，生成器据此丢题。没数完不等于只有一种解。
//   · verify —— 只读 owner 判胜，不碰候选池。剪枝有 bug 也伪造不出一个"赢"。
//
// par = 块数：一笔只能围出一块（合法的框里恰好一个数字），而每一块都得有人围一次。

import { rngFrom } from '../core/rng.js';
import { T, hueOf } from '../core/theme.js';
import { paper, rules, label, clamp, easeOut, rgba } from '../core/paper.js';

export const OPEN = -1;
const STRIDE = 6;                        // 一种摆法记 6 个数：[region, r0, c0, r1, c1, area]
const MAX_REGIONS = 30;                  // 归属一位一域存进 Uint32；满编 36 间留 6 位余量，
                                         // 生成器测过最密的一档也只到 20 间

const pop32 = (m) => {
  m -= (m >>> 1) & 0x55555555;
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
const lowBit = (m) => Math.log2(m & -m) | 0;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

// ---- 盘面：数字、候选摆法、谁与谁打架 --------------------------------------------------

// given 是长度 n² 的数组：0 = 草地，>0 = 这一格印着数字 given[t]。
export function createBoard(n, given) {
  const total = n * n;
  if (!(n > 1)) throw new Error('盘子太小');
  if (given.length !== total) throw new Error('given 长度对不上');
  const clueOf = new Int16Array(total).fill(OPEN);
  const clueCell = [];
  const values = [];
  for (let t = 0; t < total; t++) {
    const v = given[t] | 0;
    if (v > 0) {
      clueOf[t] = clueCell.length;
      clueCell.push(t);
      values.push(v);
    }
  }
  const clues = clueCell.length;
  if (!clues) throw new Error('盘上没有数字');
  if (clues > MAX_REGIONS) throw new Error(`数字太多，位掩码放不下 (${clues})`);
  let sum = 0;
  for (const v of values) sum += v;
  // 块块铺满全盘、每块面积等于自己的数字 ⇒ 数字之和必须正好是格数。差一个就不用往下看了。
  if (sum !== total) throw new Error(`数字之和 ${sum} ≠ 格数 ${total}：这种盘天生无解`);

  const rectsOf = Array.from({ length: clues }, () => []);
  const flat = [];
  const cellsOf = [];
  const atCell = Array.from({ length: total }, () => []);
  for (let i = 0; i < clues; i++) {
    const area = values[i];
    const cr = (clueCell[i] / n) | 0;
    const cc = clueCell[i] % n;
    for (let rows = 1; rows <= Math.min(n, area); rows++) {
      if (area % rows) continue;
      const cols = area / rows;
      if (cols > n) continue;
      for (let r0 = Math.max(0, cr - rows + 1); r0 <= Math.min(cr, n - rows); r0++) {
        for (let c0 = Math.max(0, cc - cols + 1); c0 <= Math.min(cc, n - cols); c0++) {
          const cells = [];
          let clash = false;
          for (let r = r0; r < r0 + rows && !clash; r++) {
            for (let c = c0; c < c0 + cols; c++) {
              const t = r * n + c;
              if (clueOf[t] !== OPEN && clueOf[t] !== i) {
                clash = true;
                break;
              }
              cells.push(t);
            }
          }
          if (clash) continue;
          const id = flat.length / STRIDE;
          flat.push(i, r0, c0, r0 + rows - 1, c0 + cols - 1, area);
          cellsOf.push(Int32Array.from(cells));
          for (const t of cells) atCell[t].push(id);
          rectsOf[i].push(id);
        }
      }
    }
  }
  // 一个数字连一种摆法都没有，就不是"题"而是"错盘"。在这儿喊出来，别让它下游被读成"已推完"。
  for (let i = 0; i < clues; i++) {
    if (!rectsOf[i].length) throw new Error(`数字 ${values[i]} @${clueCell[i]} 没有任何可放的矩形`);
  }

  // 共格的两种摆法互斥。这件事记一次，"这一放会不会让别家绝粮"就成了一次计数而不是搜索。
  const conflictOf = Array.from({ length: flat.length / STRIDE }, () => []);
  for (let t = 0; t < total; t++) {
    const list = atCell[t];
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        conflictOf[list[a]].push(list[b]);
        conflictOf[list[b]].push(list[a]);
      }
    }
  }
  for (let r = 0; r < conflictOf.length; r++) conflictOf[r] = Int32Array.from(new Set(conflictOf[r]));

  return {
    n, total, clues, values, clueOf, clueCell,
    rects: Int32Array.from(flat),
    rectCount: flat.length / STRIDE,
    rectsOf, cellsOf, atCell, conflictOf,
    rectBox: (rid) => [flat[rid * STRIDE + 1], flat[rid * STRIDE + 2], flat[rid * STRIDE + 3], flat[rid * STRIDE + 4]],
    rectCells: (rid) => cellsOf[rid],
  };
}

// ---- 状态：owner 数组 + 由它现算出来的候选池 --------------------------------------------

export function createState(board, owner) {
  const st = {
    board,
    owner: Int16Array.from(owner),
    alive: new Uint8Array(board.rectCount).fill(1),
    cnts: new Int32Array(board.clues),
    cover: new Int32Array(board.clues * board.total),
    mask: new Uint32Array(board.total),
    dead: false,
  };
  for (let i = 0; i < board.clues; i++) st.cnts[i] = board.rectsOf[i].length;
  for (let i = 0; i < board.clues; i++) {
    const base = i * board.total;
    for (const rid of board.rectsOf[i]) {
      for (const t of board.cellsOf[rid]) if (!st.cover[base + t]++) st.mask[t] |= 1 << i;
    }
  }
  for (let t = 0; t < board.total; t++) if (st.owner[t] !== OPEN) claimCell(st, t, st.owner[t]);
  refreshDead(st);
  return st;
}

function refreshDead(st) {
  st.dead = false;
  for (let i = 0; i < st.board.clues; i++) if (!st.cnts[i]) st.dead = true;
  for (let t = 0; t < st.board.total; t++) if (!st.mask[t] && st.owner[t] === OPEN) st.dead = true;
  return st;
}

// 候选池整个从 owner 重算，绝不记旧账。
export const rebuild = (st) => createState(st.board, st.owner);

export function killRect(st, rid) {
  if (!st.alive[rid]) return false;
  const { board } = st;
  st.alive[rid] = 0;
  const i = board.rects[rid * STRIDE];
  const base = i * board.total;
  st.cnts[i]--;
  for (const t of board.cellsOf[rid]) if (--st.cover[base + t] === 0) st.mask[t] &= ~(1 << i);
  if (st.cnts[i] === 0) st.dead = true;
  return true;
}

// 一格改嫁的唯一入口：写下归属，同时把所有与它抵触的摆法清掉。
export function claimCell(st, t, i) {
  const { board } = st;
  if (st.owner[t] === i) return false;
  for (const rid of board.rectsOf[i]) if (st.alive[rid] && !board.cellsOf[rid].includes(t)) killRect(st, rid);
  for (const rid of board.atCell[t]) {
    if (board.rects[rid * STRIDE] === i) continue;
    killRect(st, rid);
  }
  st.owner[t] = i;
  return true;
}

export function cloneState(board, st) {
  return {
    board,
    owner: Int16Array.from(st.owner),
    alive: Uint8Array.from(st.alive),
    cnts: Int32Array.from(st.cnts),
    cover: Int32Array.from(st.cover),
    mask: Uint32Array.from(st.mask),
    dead: st.dead,
  };
}

// ---- 规则：每一条说的都是"在任何解里都真"的事 ------------------------------------------
// 所以按任意顺序、刷任意深，都不可能把真答案刷掉。

export const Rules = {
  onlyOwner: { name: '唯一归属', weight: 1 },       // 这格只有这一家住得下
  insideAll: { name: '全线穿透', weight: 2 },       // 这一家所有还能放的摆法都盖住这格
  regionPinned: { name: '区域锁定', weight: 1.5 },  // 这一家只剩一种摆法，整块形状已知
  noSupport: { name: '无处安放', weight: 3 },       // 这样放会让别家绝粮，所以不能这样放
  nishio: { name: '反证', weight: 6 },              // 假设它在这儿，推到底会矛盾
};

export function propagate(st) {
  const { board } = st;
  const found = [];
  // 1. 只有一个家还住得下的格子
  for (let t = 0; t < board.total; t++) {
    const m = st.mask[t];
    if (!m) {
      st.dead = true;
      return { status: 'dead', found };
    }
    if (st.owner[t] === OPEN && pop32(m) === 1) {
      const i = lowBit(m);
      claimCell(st, t, i);
      found.push({ kind: 'own', cell: t, region: i, rule: Rules.onlyOwner });
    }
  }
  // 2. 一家还能放的摆法要么收敛成一块，要么在所有摆法里都盖住某几格
  for (let i = 0; i < board.clues; i++) {
    if (st.cnts[i] === 0) {
      st.dead = true;
      return { status: 'dead', found };
    }
    let common = null;
    let pinned = OPEN;
    for (const rid of board.rectsOf[i]) {
      if (!st.alive[rid]) continue;
      pinned = rid;
      const cells = board.cellsOf[rid];
      if (common === null) common = new Set(cells);
      else for (const t of Array.from(common)) if (!cells.includes(t)) common.delete(t);
      if (!common.size) break;
    }
    if (!common || !common.size) continue;
    const fresh = [...common].filter((t) => st.owner[t] === OPEN);
    if (!fresh.length) continue;
    const rule = st.cnts[i] === 1 ? Rules.regionPinned : Rules.insideAll;
    for (const t of fresh) {
      claimCell(st, t, i);
      found.push({ kind: 'own', cell: t, region: i, rid: pinned, rule });
    }
    if (st.cnts[i] === 1) found.push({ kind: 'rect', region: i, rid: pinned, rule: Rules.regionPinned });
  }
  // 3. 会让别家绝粮的摆法，本身就不可能
  const starving = findUnsupported(st);
  for (const [rid, blocked] of starving) {
    killRect(st, rid);
    found.push({ kind: 'kill', region: board.rects[rid * STRIDE], rid, blocked, rule: Rules.noSupport });
  }
  return { status: starving.length || found.length ? 'progress' : 'idle', found };
}

// 把这块放下去，别家还剩活路吗？只要有一家的候选被清光，这一放就成立不了。
function findUnsupported(st) {
  const { board } = st;
  const out = [];
  const tally = new Int32Array(board.clues);
  for (let i = 0; i < board.clues; i++) {
    if (st.cnts[i] < 2) continue;
    for (const rid of board.rectsOf[i]) {
      if (!st.alive[rid]) continue;
      tally.fill(0);
      for (const other of board.conflictOf[rid]) {
        if (!st.alive[other]) continue;
        const j = board.rects[other * STRIDE];
        if (j !== i) tally[j]++;
      }
      for (let j = 0; j < board.clues; j++) {
        if (j === i || st.cnts[j] === 0) continue;
        if (tally[j] === st.cnts[j]) {
          out.push([rid, j]);
          break;
        }
      }
    }
  }
  return out;
}

// 只假设一层：把某块摆下去、拿人的规则刷到底，刷死了就说明它摆不得。
// 这是全盘唯一"猜"的地方，而它给出的仍然是证明。
export function findContradiction(st) {
  const { board } = st;
  for (let i = 0; i < board.clues; i++) {
    if (st.cnts[i] < 2) continue;
    for (const rid of board.rectsOf[i]) {
      if (!st.alive[rid]) continue;
      const probe = cloneState(board, st);
      for (const t of board.cellsOf[rid]) claimCell(probe, t, i);
      let dead = false;
      for (let guard = 0; guard < 64; guard++) {
        const r = propagate(probe);
        if (r.status === 'dead') {
          dead = true;
          break;
        }
        if (r.status === 'idle') break;
      }
      if (dead) return { kind: 'kill', region: i, rid, rule: Rules.nishio };
    }
  }
  return null;
}

// ---- 铅笔路径：只靠题面、不读玩家笔迹、不回溯 ------------------------------------------

// 难度读数 = 加权推导分 + 推导次数。反证用了几次单独记：它是"这题要不要试手"的分界，
// 出题那一趟只交零反证的盘（见 generate 的当场放行条件）。
export function solve(board) {
  const st = createState(board, new Int16Array(board.total).fill(OPEN));
  const used = new Map();
  let nishio = 0;
  let guard = 0;
  const bump = (rule) => {
    const cur = used.get(rule.name) || { n: 0, weight: rule.weight };
    cur.n++;
    used.set(rule.name, cur);
  };
  for (;;) {
    const sweep = propagate(st);
    for (const d of sweep.found) bump(d.rule);
    if (sweep.status === 'dead') break;
    if (sweep.status === 'progress') {
      if (++guard > 400) break;
      continue;
    }
    if (complete(board, st.owner)) break;
    // 传播刷不动了、盘又没满：只剩反证这一条路；连反证都找不出矛盾，这盘就是有多解
    const hard = findContradiction(st);
    if (!hard) break;
    killRect(st, hard.rid);
    bump(hard.rule);
    nishio++;
  }
  let steps = 0;
  let score = 0;
  for (const v of used.values()) {
    steps += v.n;
    score += v.n * v.weight;
  }
  return {
    ok: complete(board, st.owner),
    dead: st.dead,
    steps,
    score: Math.round(score * 10) / 10,
    nishio,
    owner: st.owner,
  };
}

// ---- 判胜：只读 owner，不读候选池 ------------------------------------------------------

export function verify(board, owner) {
  const bad = [];
  const { n, total, clues } = board;
  for (let t = 0; t < total; t++) if (owner[t] === OPEN) bad.push({ why: '空格', cell: t });
  for (let i = 0; i < clues; i++) {
    const cells = [];
    for (let t = 0; t < total; t++) if (owner[t] === i) cells.push(t);
    if (!cells.length) {
      bad.push({ why: '区域没有格子', region: i });
      continue;
    }
    let r0 = 1e9, c0 = 1e9, r1 = -1, c1 = -1;
    for (const t of cells) {
      const r = (t / n) | 0;
      const c = t % n;
      if (r < r0) r0 = r;
      if (c < c0) c0 = c;
      if (r > r1) r1 = r;
      if (c > c1) c1 = c;
    }
    if ((r1 - r0 + 1) * (c1 - c0 + 1) !== cells.length) bad.push({ why: '不是矩形', region: i });
    if (cells.length !== board.values[i]) bad.push({ why: '面积与数字不符', region: i });
    const own = board.clueCell[i];
    const or = (own / n) | 0;
    const oc = own % n;
    if (or < r0 || or > r1 || oc < c0 || oc > c1) bad.push({ why: '区域不含自己的数字', region: i });
    for (const t of cells) if (board.clueOf[t] !== OPEN && board.clueOf[t] !== i) bad.push({ why: '区域含了别人的数字', region: i, cell: t });
  }
  return bad;
}

export function complete(board, owner) {
  for (let t = 0; t < board.total; t++) if (owner[t] === OPEN) return false;
  return verify(board, owner).length === 0;
}

// ---- 保险丝：一套与上面毫无瓜葛的枚举 ---------------------------------------------------
// 不共用候选池、不共用位掩码、不引用任何规则：只从"盘有多大、数字是几"出发，
// 像人拿答案纸核对那样一块一块试。生成器只有在两边都点头时才交题。

export function countSolutions(board, { cap = 2, budget = 120000 } = {}) {
  const { n, total } = board;
  const taken = new Uint8Array(total);
  const maxArea = Math.max(...board.values);
  let solutions = 0;
  let nodes = 0;
  let exhausted = true;

  const firstFree = () => {
    for (let t = 0; t < total; t++) if (!taken[t]) return t;
    return -1;
  };
  const mark = (r0, c0, r1, c1, on) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) taken[r * n + c] = on;
  };

  const walk = () => {
    if (++nodes > budget) {
      exhausted = false;
      return;
    }
    const t = firstFree();
    if (t === -1) {
      solutions++;
      return;
    }
    const r = (t / n) | 0;
    const c = t % n;
    for (let r0 = r; r0 >= 0; r0--) {
      for (let r1 = r; r1 < n; r1++) {
        const rows = r1 - r0 + 1;
        for (let c0 = c; c0 >= 0; c0--) {
          for (let c1 = c; c1 < n; c1++) {
            const cols = c1 - c0 + 1;
            const area = rows * cols;
            if (area > maxArea) continue;
            let clue = OPEN;
            let ok = true;
            for (let rr = r0; rr <= r1 && ok; rr++) {
              for (let cc = c0; cc <= c1; cc++) {
                const u = rr * n + cc;
                if (taken[u]) {
                  ok = false;
                  break;
                }
                const k = board.clueOf[u];
                if (k !== OPEN) {
                  if (clue !== OPEN) {
                    ok = false;
                    break;
                  }
                  clue = k;
                }
              }
            }
            // 一块一个数字，而面积要答得上那个数字
            if (!ok || clue === OPEN || board.values[clue] !== area) continue;
            mark(r0, c0, r1, c1, 1);
            walk();
            mark(r0, c0, r1, c1, 0);
            if (solutions >= cap || !exhausted) return;
          }
        }
      }
    }
  };

  walk();
  return { count: solutions, capped: !exhausted, nodes };
}

// ---- 出题：先随机切盘，再让两条线各自核一遍 --------------------------------------------
// 切的办法是"永远先填最靠左上那个空格"，于是每块的新矩形左上角天然落定，不用重试。
// 光切出来的盘太老实（一眼就是一块矩形），所以再把能拼回矩形的邻块合并 —— 数字落点也随机，
// 落点不同，可放的矩形就不同，这本身就是题面的一部分。

function randomRects(n, rng, { minArea, maxArea }) {
  const total = n * n;
  const taken = new Uint8Array(total);
  const rects = [];
  let used = 0;
  for (let t = 0; t < total; t++) {
    if (taken[t]) continue;
    const r0 = (t / n) | 0;
    const c0 = t % n;
    const options = [];
    for (let rows = 1; r0 + rows <= n; rows++) {
      for (let cols = 1; c0 + cols <= n; cols++) {
        const area = rows * cols;
        if (area > maxArea) break;
        let free = true;
        for (let r = r0; r < r0 + rows && free; r++) for (let c = c0; c < c0 + cols; c++) if (taken[r * n + c]) free = false;
        if (!free) break;
        const leftover = total - used - area;
        if (leftover > 0 && leftover < minArea) continue;
        if (area >= minArea || leftover === 0) options.push({ r0, c0, r1: r0 + rows - 1, c1: c0 + cols - 1, area });
      }
    }
    if (!options.length) {
      rects.push({ r0, c0, r1: r0, c1: c0, area: 1 });
      taken[t] = 1;
      used += 1;
      continue;
    }
    // 选项给得越宽，切出来的盘越歪；歪盘才有意思
    const pick = options[rng.int(options.length)];
    for (let r = pick.r0; r <= pick.r1; r++) for (let c = pick.c0; c <= pick.c1; c++) taken[r * n + c] = 1;
    used += pick.area;
    rects.push(pick);
  }
  return rects;
}

function mergeRects(rects, rng, chance, maxArea) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < rects.length && !merged; a++) {
      for (let b = a + 1; b < rects.length && !merged; b++) {
        const x = rects[a];
        const y = rects[b];
        const box = {
          r0: Math.min(x.r0, y.r0), c0: Math.min(x.c0, y.c0),
          r1: Math.max(x.r1, y.r1), c1: Math.max(x.c1, y.c1),
        };
        // 只有并起来仍然是一块矩形，才谈得上"一块一个数字"。合并的上限就是这一档的块大小
        // 上限：不封顶的话 10×10 会一路并到九块大饼，数字太少，盘也就不像题了。
        if ((box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1) !== x.area + y.area) continue;
        if (x.area + y.area > maxArea || !(rng() < chance)) continue;
        box.area = x.area + y.area;
        rects.splice(b, 1);
        rects.splice(a, 1, box);
        merged = true;
      }
    }
  }
  return rects;
}

// 返回 { given, owner }；缝不出合法盘（块数超上限、某块没地方放数字）就返回 null。
function layout(n, rng, cfg) {
  const rects = mergeRects(randomRects(n, rng, cfg), rng, cfg.merge, cfg.maxArea);
  if (rects.length > MAX_REGIONS) return null;
  const given = new Int16Array(n * n);
  for (const r of rects) {
    const cells = [];
    for (let rr = r.r0; rr <= r.r1; rr++) for (let cc = r.c0; cc <= r.c1; cc++) cells.push(rr * n + cc);
    given[cells[rng.int(cells.length)]] = r.area;
  }
  const owner = new Int16Array(n * n);
  for (const r of rects) {
    let at = -1;
    for (let rr = r.r0; rr <= r.r1 && at < 0; rr++) {
      for (let cc = r.c0; cc <= r.c1; cc++) {
        if (given[rr * n + cc] > 0) {
          at = rr * n + cc;
          break;
        }
      }
    }
    if (at < 0) return null;
    let region = 0;
    for (let t = 0; t < at; t++) if (given[t] > 0) region++;   // 区域序号 = 数字从左到右的排序号
    for (let rr = r.r0; rr <= r.r1; rr++) for (let cc = r.c0; cc <= r.c1; cc++) owner[rr * n + cc] = region;
  }
  return { given, owner };
}

const TIERS = [
  { key: 6, label: '6×6', tier: '入门', band: [30, 52], merge: 0.15, minArea: 2, maxArea: 6, tries: 120, audit: 60000 },
  { key: 8, label: '8×8', tier: '进阶', band: [64, 96], merge: 0.35, minArea: 2, maxArea: 9, tries: 90, audit: 120000 },
  { key: 10, label: '10×10', tier: '大师', band: [112, 160], merge: 0.45, minArea: 2, maxArea: 12, tries: 60, audit: 200000 },
];

export function tierOf(sizeKey) {
  return TIERS.find((t) => String(t.key) === String(sizeKey)) || TIERS[1];
}

function specOf(n, cfg, given, owner, seed, rank, count, capped, degraded) {
  let clues = 0;
  for (let t = 0; t < n * n; t++) if (given[t] > 0) clues++;
  return {
    kind: 'shikaku',
    n,
    given: Array.from(given),
    solution: Array.from(owner),
    par: clues,
    score: rank.score,
    steps: rank.steps,
    nishio: rank.nishio,
    solutions: count,
    capped,
    ...(degraded ? { degraded: true } : {}),
    seed: String(seed),
    tier: cfg.tier,
  };
}

export function generate(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const rng = rngFrom(seed);
  const good = [];
  for (let attempt = 0; attempt < cfg.tries; attempt++) {
    const sub = rng.fork(`k${attempt}`);
    const cut = layout(n, sub, cfg);
    if (!cut) continue;
    let board;
    try {
      board = createBoard(n, cut.given);
    } catch {
      continue;                                   // 数字放不下之类的错盘：换一刀，别交出去
    }
    const p = solve(board);
    if (!p.ok) continue;                          // 人的规则推不到底，或者干脆无解
    // 铅笔路径推出来的那张盘，必须就是切这一刀时的那张 —— 两条独立的线对上才叫题。
    let agrees = true;
    for (let t = 0; t < n * n; t++) if (p.owner[t] !== cut.owner[t]) agrees = false;
    if (!agrees) continue;
    const { count, capped } = countSolutions(board, { cap: 2, budget: cfg.audit });
    if (!capped && count !== 1) continue;         // 数出第二个解：这种题面绝不交
    const spec = specOf(n, cfg, cut.given, cut.owner, seed, p, count, capped, false);
    good.push(spec);
    // 落在难度带里、而且一步反证都不用的，当场就交。挑题不看时钟 ——
    // 存档只存种子，负载不同的两台机器必须还原出同一道题。
    if (p.nishio === 0 && p.score >= cfg.band[0] && p.score <= cfg.band[1]) return spec;
  }
  if (good.length) {
    // 一趟下来没碰上"带内且零反证"的，就从合格品里挑分数最贴近带心的那个。
    const mid = (cfg.band[0] + cfg.band[1]) / 2;
    good.sort((a, b) => Math.abs(a.score - mid) - Math.abs(b.score - mid));
    return good[0];
  }
  // 兜底：实测过"纯逻辑推得完 + 独立枚举只数出一个解"的真题。宁可交无聊，不交错题。
  return fallbackSpec(seed, sizeKey);
}

// 三张冻住的真题，每格一个字符（given 用 '.' 表示草地，owner 是区域序号，都按 36 进制读）。
// 有了它们，generate 就不必留"这道题可能出不来"那条分支 —— 兜底交出去的也是一道真题。
const FROZEN = {
  6: {
    given: '..33...64...........4..4....3.6....3',
    owner: '000111223333224455224455777666777888',
  },
  8: {
    given: '..5...8..........6..............35.....8........2.576.8.....1...',
    owner: '0000011522289115222891153478911534789aa534789aa564789aa56478baa5',
  },
  10: {
    given: '....7..........c..........9.c..c............8..........................23.....c....7...22.4....6..2.',
    owner: '00000003331111112333111111233344495523334449552888444955288844495528886679dd2888cc79dd2abbcc79dd2aee',
  },
};

export function fallbackSpec(seed, sizeKey = 8) {
  const cfg = tierOf(sizeKey);
  const n = cfg.key;
  const f = FROZEN[n];
  const given = Int16Array.from(f.given, (ch) => (ch === '.' ? 0 : parseInt(ch, 36)));
  const owner = Int16Array.from(f.owner, (ch) => parseInt(ch, 36));
  const board = createBoard(n, given);
  const { count, capped } = countSolutions(board, { cap: 2, budget: cfg.audit });
  return specOf(n, cfg, given, owner, seed, solve(board), count, capped, true);
}

// ---- 引擎 -----------------------------------------------------------------------------

export function create(spec) {
  const n = spec.n;
  const total = n * n;
  const board = createBoard(n, Int16Array.from(spec.given));
  let owner = new Int16Array(total).fill(OPEN);
  let st = createState(board, owner);
  const cellsOf = Array.from({ length: board.clues }, () => []);   // 每块现在有哪些格，随 owner 维护
  const undoStack = [];
  const redoStack = [];
  const anim = new Map();
  let moves = 0;
  let doneAt = 0;
  let anchor = null;        // 拖动中的起点
  let corner = null;        // 拖动中的终点（也是"点两下"时用来判断有没有挪动）
  let pick = null;          // 第一下钉住的那个角，等第二下定对角
  let erasing = false;
  let strokeChanged = false;

  const solved = () => complete(board, owner);
  const syncCells = () => {
    for (const list of cellsOf) list.length = 0;
    for (let t = 0; t < total; t++) if (owner[t] !== OPEN) cellsOf[owner[t]].push(t);
  };
  const commit = (next) => {
    owner = next;
    st = createState(board, owner);
    syncCells();
    doneAt = 0;
  };
  syncCells();

  // 这一家现在的墨，还塞得进某一种还能放的摆法吗？塞不进就是画错了，不是"还没画完"。
  function fitsAlive(i) {
    const cells = cellsOf[i];
    if (!cells.length) return true;
    if (cells.length > board.values[i]) return false;
    for (const rid of board.rectsOf[i]) {
      if (!st.alive[rid]) continue;
      const rect = board.cellsOf[rid];
      if (rect.length < cells.length) continue;
      let holds = true;
      for (const t of cells) if (!rect.includes(t)) { holds = false; break; }
      if (holds) return true;
    }
    return false;
  }
  const regionDone = (i) => cellsOf[i].length === board.values[i] && fitsAlive(i);
  const filledRegions = () => {
    let c = 0;
    for (let i = 0; i < board.clues; i++) if (regionDone(i)) c++;
    return c;
  };

  function snapshot() {
    undoStack.push(Int16Array.from(owner));
    if (undoStack.length > 400) undoStack.shift();
    redoStack.length = 0;
  }

  const corners = (a, b) => ({
    r0: Math.min(a.y, b.y), c0: Math.min(a.x, b.x),
    r1: Math.max(a.y, b.y), c1: Math.max(a.x, b.x),
  });
  const boxCells = (b) => {
    const cells = [];
    for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) cells.push(r * n + c);
    return cells;
  };
  const boxRegions = (b) => {
    const out = [];
    for (const t of boxCells(b)) if (board.clueOf[t] !== OPEN) out.push(board.clueOf[t]);
    return out;
  };

  // 一笔画一块：框里恰好一个数字、面积等于它，才算一间。
  function commitBox(a, b) {
    const bx = corners(a, b);
    const clues = boxRegions(bx);
    if (!clues.length) return { ok: false, reason: '这块里没有数字：每一间都得围住一个数字' };
    if (clues.length > 1) return { ok: false, reason: `这块圈住了 ${clues.length} 个数字：一间只能有一个` };
    const i = clues[0];
    const area = (bx.r1 - bx.r0 + 1) * (bx.c1 - bx.c0 + 1);
    if (area !== board.values[i]) return { ok: false, reason: `这块是 ${area} 格，可这里的数字是 ${board.values[i]}` };
    const cells = boxCells(bx);
    if (cells.every((t) => owner[t] === i)) return { ok: false, reason: '这块已经围好了' };
    snapshot();
    for (const t of cells) claimCell(st, t, i);
    owner = st.owner;
    syncCells();
    moves++;
    const now = nowMs();
    for (const t of cells) anim.set(t, now);
    if (solved()) doneAt = now;
    return { ok: true, region: i, cells };
  }

  function eraseAt(x, y) {
    const t = y * n + x;
    if (owner[t] === OPEN) return;
    if (!strokeChanged) snapshot();
    const next = Int16Array.from(owner);
    next[t] = OPEN;
    commit(next);
    strokeChanged = true;
  }

  // 与题面矛盾的格子：某一家的墨已经塞不进它任何一种还能放的摆法。
  function badCells() {
    const bad = new Set();
    for (let i = 0; i < board.clues; i++) {
      if (fitsAlive(i)) continue;
      for (const t of cellsOf[i]) bad.add(t);
    }
    return [...bad].sort((p, q) => p - q).map((t) => [t % n, (t / n) | 0]);
  }

  // 下一手"人该自己看出"的推理。传播只写逻辑上被逼定的格，所以这类提示落下去不欠一次猜。
  function nextDeduction() {
    const probe = cloneState(board, st);
    const sweep = propagate(probe);
    if (sweep.status === 'dead') return null;
    const fresh = sweep.found.filter((d) => d.kind === 'own' && owner[d.cell] === OPEN);
    const pinned = fresh.find((d) => d.rule === Rules.regionPinned);
    if (pinned) {
      const rid = board.rectsOf[pinned.region].find((r) => probe.alive[r]);
      return { kind: 'rect', region: pinned.region, rid, rule: Rules.regionPinned };
    }
    if (fresh.length) return { kind: 'own', ...fresh[0] };
    // 光是"某块摆不得"填不出一格，那就顺着它把唯一剩下的那块钉死
    for (const d of sweep.found.filter((x) => x.kind === 'kill')) {
      killRect(probe, d.rid);
      const again = propagate(probe);
      const o = again.found.filter((x) => x.kind === 'own' && owner[x.cell] === OPEN);
      if (o.length) return o[0].rule === Rules.regionPinned
        ? { kind: 'rect', region: o[0].region, rid: board.rectsOf[o[0].region].find((r) => probe.alive[r]), rule: Rules.regionPinned }
        : { kind: 'own', ...o[0] };
    }
    return null;
  }

  const engine = {
    id: 'shikaku',
    spec,
    board: { cols: n, rows: n, margin: { l: 0.26, t: 0.26, r: 0.26, b: 0.26 } },
    stats: () => ({ moves, par: spec.par || board.clues, done: filledRegions(), total: board.clues }),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    solved,
    ownerAt: (x, y) => owner[y * n + x],
    regionCount: () => board.clues,

    // 主笔：按下是起点，拖动改对角，抬手成交。原地抬手算"点一下"：
    // 第一下钉住一个角，第二下定对角 —— 键盘只有"按下立刻抬手"，两下才围得出一块。
    down(x, y, btn = 0) {
      if (x < 0 || y < 0 || x >= n || y >= n || solved()) return false;
      if (btn === 1) {
        erasing = true;
        strokeChanged = false;
        eraseAt(x, y);
        return strokeChanged;
      }
      anchor = { x, y };
      corner = { x, y };
      return false;
    },

    move(x, y) {
      if (erasing) {
        if (x >= 0 && y >= 0 && x < n && y < n) eraseAt(x, y);
        return strokeChanged;
      }
      if (anchor && x >= 0 && y >= 0 && x < n && y < n) corner = { x, y };
      return false;
    },

    up() {
      if (erasing) {
        erasing = false;
        return strokeChanged;
      }
      if (!anchor) return false;
      const a = anchor;
      const b = corner || a;
      anchor = null;
      corner = null;
      if (a.x !== b.x || a.y !== b.y) {
        pick = null;
        return commitBox(a, b).ok;
      }
      if (!pick) {
        pick = { x: a.x, y: a.y };
        return false;
      }
      const from = pick;
      pick = null;
      return commitBox(from, a).ok;
    },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(Int16Array.from(owner));
      commit(undoStack.pop());
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(Int16Array.from(owner));
      commit(redoStack.pop());
      if (solved()) doneAt = nowMs();
      return true;
    },

    hint() {
      if (solved()) return null;
      // 先擦掉那些"塞不进任何一种还能放的摆法"的墨：它还在盘上，后面任何推理都是空中楼阁。
      const wrong = badCells();
      if (wrong.length) {
        const [x, y] = wrong[0];
        const t = y * n + x;
        const i = owner[t];
        const next = Int16Array.from(owner);
        next[t] = OPEN;
        snapshot();
        commit(next);
        return { cells: [[x, y]], note: `第${y + 1}行第${x + 1}列塞不进 ${board.values[i]} 格这一间的任何一种摆法，先擦掉它` };
      }
      const d = nextDeduction();
      if (d && d.kind === 'rect') {
        const cells = [...board.rectCells(d.rid)];
        paint(cells, d.region);
        const note = `${d.rule.name}：${board.values[d.region]} 格这一间只剩这一种摆法`;
        return { cells: cells.map((t) => [t % n, (t / n) | 0]), note };
      }
      if (d && d.kind === 'own') {
        paint([d.cell], d.region);
        const x = d.cell % n;
        const y = (d.cell / n) | 0;
        return { cells: [[x, y]], note: `${d.rule.name}：第${y + 1}行第${x + 1}列只有 ${board.values[d.region]} 格这一家住得下` };
      }
      // 传播给不出下一步：这题到这儿需要试手了。交出一整间，不倒整份答案。
      for (let i = 0; i < board.clues; i++) {
        if (regionDone(i)) continue;
        const cells = [];
        for (let t = 0; t < total; t++) if (spec.solution[t] === i) cells.push(t);
        paint(cells, i);
        return {
          cells: cells.map((t) => [t % n, (t / n) | 0]),
          note: `唯一解里 ${board.values[i]} 格这一间的位置 —— 这一步规则推不出来，得靠试`,
        };
      }
      return null;
    },

    badCells,

    draw(ctx, v, t) {
      render(ctx, v, { board, owner, anim, t, reveal: 0, preview: currentPreview(v), pick });
    },
    celebrate(ctx, v, t, k) {
      render(ctx, v, { board, owner, anim, t, reveal: k, preview: null, pick: null });
    },
  };

  function paint(cells, region) {
    snapshot();
    for (const t of cells) claimCell(st, t, region);
    owner = st.owner;
    syncCells();
    moves++;
    const now = nowMs();
    for (const t of cells) anim.set(t, now);
    if (solved()) doneAt = now;
  }

  function currentPreview(v) {
    if (erasing) return null;
    if (anchor && corner && (anchor.x !== corner.x || anchor.y !== corner.y)) return corners(anchor, corner);
    if (pick && v.hover && v.hover.x >= 0) return corners(pick, { x: v.hover.x, y: v.hover.y });
    return null;
  }

  return engine;
}

// ---- 渲染 -----------------------------------------------------------------------------

function render(ctx, v, s) {
  const { cell, ox, oy, cols, rows } = v;
  const { board, owner } = s;
  const n = board.n;
  paper(ctx, ox - 2, oy - 2, cols * cell + 4, rows * cell + 4, 4);

  // 1) 一间一色：底色先铺，格子线压在色上，才像打在方格纸上的铅笔
  const mid = (n - 1) / 2;
  const span = Math.hypot(mid, mid) || 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = y * n + x;
      const i = owner[t];
      if (i === OPEN) continue;
      const t0 = s.anim.get(t);
      const p = !t0 || v.reduce ? 1 : clamp((s.t - t0) / 190, 0, 1);
      const wave = s.reveal ? 0.5 + 0.5 * easeOut(clamp(s.reveal * 2 - Math.hypot(x - mid, y - mid) / span, 0, 1)) : 1;
      ctx.fillStyle = rgba(hueOf(i * 5), (0.12 + 0.1 * p) * wave);
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }

  rules(ctx, v, T.rule);

  // 2) 间的边界：与邻格不是一家就描一道墨线，一眼看得清哪几格是一块
  ctx.save();
  ctx.strokeStyle = rgba(T.ink, 0.82);
  ctx.lineCap = 'square';
  ctx.lineWidth = Math.max(2, cell * 0.1);
  ctx.beginPath();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = y * n + x;
      const i = owner[t];
      if (i === OPEN) continue;
      const px = ox + x * cell;
      const py = oy + y * cell;
      if (x + 1 >= n || owner[t + 1] !== i) {
        ctx.moveTo(px + cell, py);
        ctx.lineTo(px + cell, py + cell);
      }
      if (y + 1 >= n || owner[t + n] !== i) {
        ctx.moveTo(px, py + cell);
        ctx.lineTo(px + cell, py + cell);
      }
    }
  }
  ctx.stroke();
  ctx.restore();

  // 3) 正在圈的框：虚线 + 一层薄底，落笔前就该看清它盖住了谁、合不合法
  if (s.pick && !s.preview) {
    ctx.save();
    ctx.strokeStyle = rgba(T.accent, 0.95);
    ctx.lineWidth = Math.max(1.6, cell * 0.08);
    ctx.strokeRect(ox + s.pick.x * cell + 2, oy + s.pick.y * cell + 2, cell - 4, cell - 4);
    ctx.restore();
  }
  if (s.preview) {
    const { r0, c0, r1, c1 } = s.preview;
    const x = ox + c0 * cell;
    const y = oy + r0 * cell;
    const w = (c1 - c0 + 1) * cell;
    const h = (r1 - r0 + 1) * cell;
    const clues = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (board.clueOf[r * n + c] !== OPEN) clues.push(board.clueOf[r * n + c]);
    const area = (r1 - r0 + 1) * (c1 - c0 + 1);
    const legal = clues.length === 1 && area === board.values[clues[0]];
    ctx.save();
    ctx.fillStyle = rgba(legal ? T.accent : T.warn, 0.14);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(legal ? T.accent : T.warn, 0.9);
    ctx.lineWidth = Math.max(1.6, cell * 0.07);
    if (!v.reduce) ctx.setLineDash([cell * 0.22, cell * 0.16]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
  }

  // 4) 数字压在色上：它是这一间的门牌，永远要看得清
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = board.clueOf[y * n + x];
      if (i === OPEN) continue;
      label(ctx, String(board.values[i]), ox + x * cell + cell / 2, oy + y * cell + cell / 2 + cell * 0.02, {
        size: cell * 0.44,
        color: rgba(T.ink, 0.92),
        bold: true,
      });
    }
  }

  if (v.bad && v.bad.length) {
    ctx.save();
    ctx.strokeStyle = rgba(T.warn, 0.9);
    ctx.lineWidth = Math.max(1.6, cell * 0.07);
    for (const [x, y] of v.bad) ctx.strokeRect(ox + x * cell + 2, oy + y * cell + 2, cell - 4, cell - 4);
    ctx.restore();
  }
}

// ---- 描述符 ---------------------------------------------------------------------------

export default {
  id: 'shikaku',
  title: '数间',
  latin: 'SHIKAKU',
  tagline: '把盘子切成长方形，每间住一个数字',
  unit: '间',
  sizes: TIERS.map((t) => ({ key: t.key, label: t.label, tier: t.tier })),
  rules: [
    '把整张盘子切成长方形：每一块里恰好有一个数字。',
    '块的面积（占几格）就等于它里面那个数字：3 是三格的一长条，4 可以是 1×4 也可以是 2×2。',
    '一块里不许有两个数字，两块也不许共用一格；所有块要铺满全盘，不留空地。',
    '主笔拖出一个矩形，或者点两下选两个对角；点同一格两下就是一格的方块（数字 1）。',
    '副笔擦格子。擦除不退已经付的那一步，所以围错一块的代价留得住。',
  ],
  generate,
  create,
};
