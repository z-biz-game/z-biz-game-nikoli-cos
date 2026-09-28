// 无头复验：把真指针事件（CDP Input domain）打到画布上，走玩家那条路 —— 坐标换算、
// pointerdown/move/up、落子判定、HUD、结算、存档全都要 live。
// 页面里只提供"读状态 + 算该怎么点"的辅助，不提供任何绕过引擎判定的后门。
//
//   node tools/playtest.mjs                 # 全部玩法各跑一局
//   KINDS=pegsolitaire node tools/playtest.mjs
// 前置：Chrome 已带 --remote-debugging-port 起好（tools/verify.sh 负责这件事）。
//   CDP_PORT=9335 BASE_URL=http://127.0.0.1:5188/ node tools/playtest.mjs

const PORT = process.env.CDP_PORT || 9335;
// 附着到哪个页面就按 origin 认，别硬编码端口：写死 5173 会在别的端口上静默对一个
// about:blank 求值，测试结果假绿。
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5188/';
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.SHOT_DIR || null;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);

const PLAN = [
  { kind: 'nonogram', size: 5 },
  { kind: 'numberlink', size: 4 },
  { kind: 'lightsout', size: 4 },
  { kind: 'pegsolitaire', size: 25 },
  { kind: 'nurikabe', size: 7 },
  { kind: 'tents', size: 6 },
  { kind: 'akabane', size: 6 },
  { kind: 'hitori', size: 6 },
  { kind: 'slant', size: 6 },
  { kind: 'shikaku', size: 6 },
  { kind: 'dominosa', size: 4 },
].filter((p) => !process.env.KINDS || process.env.KINDS.split(',').includes(p.kind));

// ---- 页面侧：状态读取与"该怎么点" ------------------------------------------------

const PAGE = `
window.__t = {
  rows: [],
  ok(test, pass, detail) { this.rows.push({ test, pass: !!pass, detail: detail === undefined ? null : detail }); },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  frames: (n = 2) => new Promise((r) => { let k = n; const t = () => (--k <= 0 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
  state: () => window.nikoli.debug.state,
  view: () => window.nikoli.debug.view(),
  text: (sel) => (document.querySelector(sel) ? document.querySelector(sel).textContent.trim() : null),
  visible: (sel) => { const n = document.querySelector(sel); return !!n && !n.hidden; },

  async goto(hash) {
    location.hash = hash;
    for (let i = 0; i < 200; i++) {
      await this.wait(20);
      if (this.state().engine && this.state().kind && !document.querySelector('#play').hidden) break;
    }
    await this.frames();
    return !!this.state().engine;
  },

  // 题解按玩法从题面里读出来，转成"该点哪几格"。坐标一律是格坐标，像素换算留在 node 侧。
  // 这几个都得写成方法简写：对象字面量里的箭头函数抓的是 window，不是 __t。
  async steps(kind, size) {
    const S = this.state();
    const spec = S.engine.spec;
    if (kind === 'nonogram') {
      const pic = spec.picture.split('\\n').map((r) => [...r]);
      const out = [];
      for (let y = 0; y < pic.length; y++) {
        let run = null;
        for (let x = 0; x <= pic[y].length; x++) {
          if (x < pic[y].length && pic[y][x] === '#') { if (!run) run = { mode: 'drag', cells: [] }; run.cells.push([x, y]); }
          else if (run) { out.push(run); run = null; }
        }
      }
      return { steps: out, filled: pic.flat().filter((c) => c === '#').length };
    }
    if (kind === 'numberlink') {
      const n = spec.n;
      return { steps: spec.solution.map((p) => ({ mode: 'drag', cells: p.map((i) => [i % n, (i - (i % n)) / n]) })), total: n * n };
    }
    if (kind === 'lightsout') {
      const m = await import(new URL('js/puzzles/lightsout.js', location.href).href);
      const n = spec.n;
      return { steps: m.minSolution(Uint8Array.from(spec.board), n).map((i) => ({ mode: 'tap', cells: [[i % n, (i - (i % n)) / n]] })) };
    }
    if (kind === 'hitori') {
      return { steps: spec.blacks.map(([x, y]) => ({ mode: 'tap', cells: [[x, y]] })), total: spec.par };
    }
    if (kind === 'akabane') {
      // 空格点一下涂黑、再点涂白：按答案要的颜色决定点几下
      const steps = [];
      for (let i = 0; i < spec.n * spec.n; i++) {
        if (spec.clues[i]) continue;
        const cell = [i % spec.n, (i - i % spec.n) / spec.n];
        steps.push({ mode: 'tap', cells: [cell] });
        if (spec.solution[i] === 2) steps.push({ mode: 'tap', cells: [cell] });
      }
      return { steps, total: spec.par };
    }
    if (kind === 'slant') {
      // 两遍真指针轨迹刷完全盘：第一遍用拖动把每一行整排画成 "/"，第二遍再把该是 "\\" 的
      // 连续段拖成 "\\"（落单的格子就 tap）。这条路上 down/move/up 与像素换算全都要 live。
      const n = spec.n;
      const steps = [];
      for (let y = 0; y < n; y++) {
        steps.push({ mode: 'drag', cells: Array.from({ length: n }, (_, x) => [x, y]) });
        for (let x = 0; x < n; ) {
          const run = [];
          while (x + run.length < n && spec.solution[y * n + x + run.length] === 2) run.push([x + run.length, y]);
          if (!run.length) { x++; continue; }
          steps.push({ mode: run.length > 1 ? 'drag' : 'tap', cells: run });
          x += run.length;
        }
      }
      return { steps, total: spec.par };
    }
    if (kind === 'shikaku') {
      // 一间一笔：按题解把每一间的包围盒拖出来。一格宽的那间走"点两下"（按下即抬手，
      // 第一下钉角、第二下定对角）—— 这条路同时验掉键盘光标用的同一套手势。
      const n = spec.n;
      const boxes = new Map();
      for (let t = 0; t < n * n; t++) {
        const o = spec.solution[t];
        if (!boxes.has(o)) boxes.set(o, { x0: 1e9, y0: 1e9, x1: -1, y1: -1 });
        const b = boxes.get(o);
        const x = t % n, y = (t - x) / n;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
      const steps = [];
      for (const b of boxes.values()) {
        if (b.x0 === b.x1 && b.y0 === b.y1) steps.push({ mode: 'tap', cells: [[b.x0, b.y0]] }, { mode: 'tap', cells: [[b.x0, b.y0]] });
        else steps.push({ mode: 'drag', cells: [[b.x0, b.y0], [b.x1, b.y1]] });
      }
      return { steps, total: spec.par };
    }
    if (kind === 'dominosa') {
      // 一块骨牌两步成交：横着的走"按住拖过两格"（down→move→up），竖着的走"点两下"
      //（定锚点 → 点搭档），两条手势都真点到像素上，一个都不许调引擎方法。
      // 起手再拿副笔在一条**不在题解里**的横界线上划一道「不许配对」：副笔是记事、不收账，
      // 所以"没用提示该给三星"那条读到的 moves 仍恰好等于 par —— 划了线还三星才是它该有的样子。
      const w = spec.w;
      const xy = (i) => [i % w, (i - i % w) / w];
      const sol = spec.solution;
      const steps = [];
      for (let i = 0; i < sol.length; i++) {
        const j = i % w + 1 < w ? i + 1 : -1;
        if (j >= 0 && sol[i] !== j && sol[j] !== i) {
          steps.push({ mode: 'tap', cells: [xy(i)], pen: 1 }, { mode: 'tap', cells: [xy(j)], pen: 1 });
          break;
        }
      }
      for (const [x1, y1, x2, y2] of spec.dominoes) {
        if (y1 === y2) steps.push({ mode: 'drag', cells: [[x1, y1], [x2, y2]], pen: 0 });
        else steps.push({ mode: 'tap', cells: [[x1, y1]], pen: 0 }, { mode: 'tap', cells: [[x2, y2]], pen: 0 });
      }
      return { steps, total: spec.par };
    }
    if (kind === 'tents') {
      return { steps: spec.tents.map(([x, y]) => ({ mode: 'tap', cells: [[x, y]] })), total: spec.par };
    }
    if (kind === 'nurikabe') {
      const n = spec.n;
      const given = new Set(spec.clues.map((c) => c[0]));
      const steps = [];
      for (let i = 0; i < n * n; i++) {
        if (given.has(i)) continue;
        steps.push({ mode: 'tap', cells: [[i % n, (i - i % n) / n]], pen: spec.solution[i] === 2 ? 0 : 1 });
      }
      return { steps, total: spec.par };
    }
    const b = spec.holes;
    return { steps: spec.plan.flatMap(([a, , c]) => [
      { mode: 'tap', cells: [[b[a][0], b[a][1]]] },
      { mode: 'tap', cells: [[b[c][0], b[c][1]]] },
    ]), total: spec.par };
  },

  geom() {
    const v = this.view();
    const r = v.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, ox: v.view.ox, oy: v.view.oy, cell: v.view.cell, cols: v.view.cols, rows: v.view.rows };
  },

  // 等几何稳定再落子：HUD 文案一变长，控制行换行 → board-wrap 改尺寸 → ResizeObserver
  // 在下一帧才重排画布。ResizeObserver 的回调排在 rAF 之后，所以只等一帧不够。
  async settle() {
    if (!this.trace) this.trace = [];
    let prev = null;
    for (let i = 0; i < 8; i++) {
      await this.frames(1);
      const g = this.geom();
      const k = [g.left, g.top, g.cell].map((n) => Math.round(n * 4)).join('/');
      if (k === prev) return g;
      if (this.trace[this.trace.length - 1] !== k) this.trace.push(k);
      prev = k;
    }
    return this.geom();
  },

  // 落子探针：在引擎门口记一笔，指针事件到底变成了哪个格坐标，一目了然。
  spy() {
    const e = this.state().engine;
    if (e.__spied) return;
    e.__spied = 1;
    this.log = [];
    this.trace = [];
    for (const m of ['down', 'move', 'up']) {
      const raw = e[m].bind(e);
      e[m] = (...a) => { const r = raw(...a); this.log.push([m, a[0], a[1], a[2] || 0, r ? 1 : 0]); return r; };
    }
  },

  probe() {
    const v = this.view();
    return {
      cw: v.wrap.clientWidth, ch: v.wrap.clientHeight,
      pw: v.canvas.width, ph: v.canvas.height,
      cell: v.view && v.view.cell, running: v.running,
      alpha: Array.from(v.ctx.getImageData(0, 0, v.canvas.width, v.canvas.height).data.slice(0, 400)),
    };
  },

  ink() {
    const v = this.view();
    const d = v.ctx.getImageData(0, 0, v.canvas.width, v.canvas.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 8) lit++;
    return lit;
  },

  report(kind, size, extra) {
    const S = this.state();
    const e = S.engine;
    const st = e.stats();
    const rec = window.nikoli.debug.store.record(kind.id + ':' + size);
    return Object.assign({
      kind: kind.id,
      sizeLabel: this.text('#play-size'),
      status: this.text('#status-text'),
      solved: e.solved(),
      moves: st.moves,
      par: st.par,
      done: st.done,
      total: st.total,
      screen: ['home', 'play', 'result'].find((s) => !document.querySelector('#' + s).hidden),
      title: this.text('#result-title'),
      stars: document.querySelectorAll('#result-stars i.on').length,
      stored: rec ? rec.solves : 0,
      noHintStored: rec ? rec.noHintSolves : 0,
      hints: S.hints,
    }, extra || {});
  },
};
'installed';
`;

// ---- CDP ----------------------------------------------------------------------

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails;
        this.errors.push(`[EXCEPTION] ${e.exception?.description || e.text} @ ${e.url}:${e.lineNumber}`);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push(`[log] ${m.params.entry.text} ${m.params.entry.url || ''}`);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const mk = (cdp, sessionId) => async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, sessionId }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

async function main() {
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const existing = list.find((t) => t.type === 'page' && isOurs(t.url));
  const { targetId } = existing
    ? { targetId: existing.id || existing.targetId }
    : await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);

  const js = mk(cdp, sessionId);
  const snap = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/${name}`, Buffer.from(data, 'base64'));
  };
  const rows = [];
  const ok = (test, pass, detail) => rows.push({ test, pass: !!pass, detail: detail ?? null });

  await cdp.send('Page.navigate', { url: BASE }, sessionId);
  // 等的是"模块图跑完"这个事实，不是某个拍脑袋的 sleep：本地静态服 200ms 就够，
  // 线上 Pages 首次加载要过 TLS + 十几个模块，固定等 1.5s 会误判成"页面没起来"。
  let booted = false;
  for (let i = 0; i < 80 && !booted; i++) {
    await new Promise((r) => setTimeout(r, 250));
    booted = await js('!!window.nikoli && !!window.nikoli.debug');
  }
  ok('页面加载：window.nikoli 挂上', booted);
  if (!booted) {
    // 起不来就别往下演了：后面的探针会对着 undefined 一路抛，把真正的原因（模块 404、
    // 语法错、MIME 不对）埋在一堆噪音底下。
    console.log(JSON.stringify({ rows, fail: ['页面没起来'], errors: cdp.errors.slice(0, 8) }, null, 2));
    ws.close();
    process.exit(1);
  }
  await js(PAGE);

  // ---- 首页：每款玩法一张卡 + 每日每款一格，档位名必须来自玩法自己 ------------
  const home = await js(`(() => {
    window.nikoli.debug.home();
    const dailyTotal = document.querySelector('#daily-total').textContent.trim();
    const cards = [...document.querySelectorAll('#kinds .kind')].map((n) => ({
      name: n.querySelector('.kind-name').textContent,
      sizes: [...n.querySelectorAll('.size-chip')].map((b) => b.textContent),
    }));
    const daily = [...document.querySelectorAll('#daily-row .daily-cell')].map((n) =>
      n.querySelector('.n').textContent + ' ' + n.querySelector('.s').textContent);
    return { cards, daily, dailyTotal, glyph: document.querySelectorAll('#kinds .kind-glyph').length };
  })()`);
  // 条数与注册表对齐，而不是钉一个上次数过的 4：加玩法的人不该被首页的旧账绊住
  const nKinds = await js('window.nikoli.KINDS.length');
  ok('首页：每款玩法都上卡片', home.cards.length === nKinds && nKinds >= 4, { cards: home.cards.map((c) => c.name), nKinds });
  ok('首页：每日挑战每款一格', home.daily.length === nKinds, { daily: home.daily, nKinds });
  ok('首页：每日计数器的分母就是格数', home.dailyTotal === '/' + nKinds, home.dailyTotal);
  ok('首页：孔明棋档位写"孔"不写"×"',
    home.cards.find((c) => c.name === '孔明棋').sizes.every((s) => s.includes('孔')) &&
      home.daily.some((d) => d.includes('孔')),
    { sizes: home.cards.find((c) => c.name === '孔明棋').sizes, daily: home.daily });

  if (SHOTS) await snap('home.png');
  // 怎么玩弹窗：规则条数来自引擎，缺一个就是注册表和引擎脱节
  await js(`document.querySelector('#kinds .kind .kind-help').click()`);
  const howto = await js(`(() => ({ open: document.querySelector('#howto').open,
    li: document.querySelectorAll('#howto-body li').length,
    title: window.__t.text('#howto-title') }))()`);
  ok('怎么玩：弹窗列出规则', howto.open && howto.li >= 3, howto);
  await js(`document.querySelector('#howto').close()`);

  // ---- 每种玩法：真指针事件一路点到通关 ------------------------------------
  for (const p of PLAN) {
    const booted = await js(`window.__t.goto('#/p/${p.kind}/${p.size}/${1234 + p.size}')`);
    ok(`${p.kind}：路由进局`, booted);

    // 换局时 layout() 会重设 canvas.width —— 那一步就把画布清空了，必须等几何稳定后
    // 再给渲染循环留一两帧，否则采到的是一张刚擦干净的空白画布。
    await js(`window.__t.settle().then(() => window.__t.frames(2))`);
    const before = await js(`window.__t.ink()`);
    ok(`${p.kind}：棋盘已画出像素`, before > 400, before > 400 ? { inkSamples: before } : await js(`window.__t.probe()`));
    if (SHOTS) await snap(`${p.kind}-board.png`);
    await js(`window.__t.spy()`);

    const plan = await js(`window.__t.steps('${p.kind}', ${p.size})`);
    const miss = [];
    // 每个格子都重新量一次几何：HUD 文案一变长，控制行就换行，board-wrap 随之改尺寸，
    // BoardView 的 ResizeObserver 会重排画布。缓存一份坐标，后半程就点到隔壁格去了。
    const pt = async (cell) => {
      const g = await js(`window.__t.settle()`);
      const x = Math.round(g.left + g.ox + (cell[0] + 0.5) * g.cell);
      const y = Math.round(g.top + g.oy + (cell[1] + 0.5) * g.cell);
      if (x < g.left || y < g.top) miss.push({ cell, x, y, left: g.left, top: g.top });
      return { x, y };
    };

    let pen = 0;
    const setPen = async (want) => {
      if (want === undefined || want === pen) return;
      const sel = '#tool-toggle button[data-tool="' + want + '"]';
      const r = await js('(() => { const b = document.querySelector(' + JSON.stringify(sel) + ');'
        + ' if (!b) return null; const q = b.getBoundingClientRect();'
        + ' return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; })()');
      if (!r) throw new Error(`没有 tool-toggle 按钮 data-tool=${want}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...r, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...r, button: 'left', buttons: 0 }, sessionId);
      pen = want;
    };

    for (const s of plan.steps) {
      await setPen(s.pen);
      const a = await pt(s.cells[0]);
      if (s.mode === 'drag') {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
        for (const c of s.cells.slice(1)) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await pt(c)), button: 'left', buttons: 1 }, sessionId);
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(await pt(s.cells[s.cells.length - 1])), button: 'left', buttons: 0 }, sessionId);
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...a, button: 'left', buttons: 0 }, sessionId);
      }
    }

    await new Promise((r) => setTimeout(r, 1200));   // 结算动画 950ms 后才换屏
    if (SHOTS) await snap(`${p.kind}.png`);
    const rep = await js(`window.__t.report(window.nikoli.byId('${p.kind}'), ${p.size})`);
    ok(`${p.kind}：一路点到通关并进结算屏`, rep.solved && rep.screen === 'result', rep);
    if (p.kind === 'dominosa') {
      // 副笔那道界线也得是真指针打出来的：引擎门口那支探针记到一次 btn=1 且返回 true，
      // 才说明"切到副笔 → 点两下"这条手势真的划出了记事，而不是我在页面里替它调的方法。
      const bans = await js(`(window.__t.log || []).filter((r) => r[0] === 'down' && r[3] === 1 && r[4] === 1).length`);
      const marked = await js(`(() => { const e = window.__t.state().engine; let n = 0;`
        + ' for (let y = 0; y < e.board.rows; y++) for (let x = 0; x < e.board.cols; x++) {'
        + ' if (x + 1 < e.board.cols && e.isBanned(x, y, x + 1, y)) n++;'
        + ' if (y + 1 < e.board.rows && e.isBanned(x, y, x, y + 1)) n++; } return n; })()');
      ok('dominosa：副笔的界线是 pointerdown 打出来的，且真的落在盘上', bans >= 1 && marked >= 1, { bans, marked });
    }
    // 布局漂移：一局之中画布只该在进局时定一次尺寸。落子过程中还变，就是
    // "内容撑容器 → 容器量内容"的反馈环又接上了（宽屏 flex 版踩过）。
    const trace = await js(`window.__t.trace || []`);
    ok(`${p.kind}：全程画布尺寸不漂移`, trace.length <= 2, { geometrySteps: trace.length, trace: trace.slice(0, 6) });
    if (!rep.solved) {
      ok(`${p.kind}：落子探针（该点的格 vs 引擎收到的调用）`, false, {
        want: plan.steps.map((s) => [s.mode, ...s.cells.map((c) => c.join(','))]),
        got: await js(`window.__t.log`),
        miss,
        trace: await js(`window.__t.trace || []`),
      });
    }
    ok(`${p.kind}：HUD 与档位名如实`, rep.done === rep.total && !!rep.sizeLabel, { status: rep.status, sizeLabel: rep.sizeLabel });
    ok(`${p.kind}：存档落了盘`, rep.stored >= 1, { solves: rep.stored, noHint: rep.noHintStored });
    // 星级要读自己这一局的结算屏：上一玩法留下的三星还挂在那儿，不看 screen 就会假绿。
    ok(`${p.kind}：没用提示该给三星`, rep.screen === 'result' && rep.stars === 3, { stars: rep.stars, hints: rep.hints, title: rep.title });
  }

  // ---- 输入设备无关性：键盘光标落子、真点击撤销、声音开关 ------------------
  await js(`window.__t.goto('#/p/lightsout/4/${9999}')`);
  const kb0 = await js(`window.__t.state().engine.cellState(1,1)`);
  const KEYS = [{ key: 'ArrowRight', code: 'ArrowRight', vk: 39 }, { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, { key: ' ', code: 'Space', vk: 32 }];
  for (const k of KEYS) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }, sessionId);
  }
  await js(`window.__t.frames(1)`);
  const kb = await js(`({ cell: window.__t.state().engine.cellState(1,1),
    hover: window.__t.view().hover, moves: window.__t.state().engine.stats().moves })`);
  ok('键盘：方向键移光标 + 空格落子', kb.hover.x === 1 && kb.hover.y === 1 && kb.moves === 1 && kb.cell !== kb0, { kb0, kb });

  const undoBtn = await js(`(() => { const b = document.querySelector('[data-action=undo]');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: b.disabled }; })()`);
  ok('落一步之后撤销按钮就该可用', undoBtn.disabled === false, undoBtn);
  const at = { x: undoBtn.x, y: undoBtn.y };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0 }, sessionId);
  await js(`window.__t.frames(1)`);
  const afterUndo = await js(`({ cell: window.__t.state().engine.cellState(1,1), moves: window.__t.state().engine.stats().moves })`);
  ok('撤销：盘面回到按前，moves 不退款', afterUndo.cell === kb0 && afterUndo.moves === 1, { kb0, afterUndo });

  const soundBtn = await js(`(() => { const r = document.querySelector('#sound-btn').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...soundBtn, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...soundBtn, button: 'left', buttons: 0 }, sessionId);
  const sound = await js(`({ off: document.querySelector('#sound-btn').classList.contains('off'),
    stored: window.nikoli.debug.store.settings.sound })`);
  ok('顶栏声音按钮改的是存档不是局部变量', sound.off === true && sound.stored === false, sound);

  // 换局不甩帧：view.stop/start 只在 attach 里做一次，回首页必须停表
  await js(`window.__t.goto('#/p/nonogram/15/${4242}')`);
  const big = await js(`(async () => { await window.__t.frames(30);
    const S = window.__t.state(); return { cols: S.engine.board.cols, ink: window.__t.ink(), size: window.__t.text('#play-size') }; })()`);
  ok('15×15 大片：布局没被 MIN_CELL 挤爆', big.ink > 3000 && big.size === '15×15', big);
  if (SHOTS) await snap('nonogram-15.png');

  const daily = await js(`(async () => {
    window.nikoli.debug.home(); await new Promise(r => setTimeout(r, 80));
    const cell = document.querySelector('#daily-row .daily-cell');
    cell.click();
    await new Promise(r => setTimeout(r, 600));
    return { hash: location.hash, daily: window.__t.state().daily, seed: window.__t.state().seed }; })()`);
  ok('每日格点进去带的是今日种子', daily.daily === true && daily.seed.includes('nikoli-daily|'), daily);

  // ---- 手机视口：窄屏是另一套 flex 布局，反馈环不能只修宽屏 ----------------
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 720, deviceScaleFactor: 2, mobile: true }, sessionId);
  await new Promise((r) => setTimeout(r, 400));
  await js(`window.__t.goto('#/p/lightsout/4/${777}')`);
  await js(`window.__t.spy()`);
  const mPlan = await js(`window.__t.steps('lightsout', 4)`);
  for (const s of mPlan.steps) {
    const g = await js(`window.__t.settle()`);
    const p = s.cells[0];
    const x = Math.round(g.left + g.ox + (p[0] + 0.5) * g.cell);
    const y = Math.round(g.top + g.oy + (p[1] + 0.5) * g.cell);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0 }, sessionId);
  }
  await new Promise((r) => setTimeout(r, 1200));
  const mob = await js(`window.__t.report(window.nikoli.byId('lightsout'), 4)`);
  const mTrace = await js(`window.__t.trace || []`);
  ok('390×720 手机视口：同样一路点到底', mob.solved && mob.screen === 'result', { ...mob, trace: mTrace.slice(0, 5) });
  if (SHOTS) await snap('mobile-lightsout.png');

  ok('全程零控制台错误', cdp.errors.length === 0, cdp.errors.slice(0, 6));

  const fail = rows.filter((r) => !r.pass);
  console.log(JSON.stringify({ rows, fail: fail.map((f) => f.test), errors: cdp.errors.slice(0, 4) }, null, 2));
  ws.close();
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR: ' + e.message); process.exit(2); });
