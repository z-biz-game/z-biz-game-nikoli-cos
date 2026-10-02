/* 纸上逻辑 Nikoli —— 离线壳。
 *
 * 策略只有一个：**网络优先，失败退缓存**。cache-first 会把 js/css 永久钉死在
 * 打版本那一刻，出新 HTML 配旧 JS 是这种站最容易自杀的鬼状态（同组踩过）。
 * 断网时玩家还能打开上一局，靠的是"命中过网络就顺手回填"这条。
 *
 * CACHE 名带版本号：改了资源清单就 bump VERSION，activate 里把旧版本整族删掉。
 */
const VERSION = 'v2';
const CACHE = `nikoli-${VERSION}`;

// 装 shell 时就预取这几样：够离线打开首页与任一玩法的棋盘（题库是本地生成的）。
const SHELL = [
  './',
  './index.html',
  './css/game.css',
  './js/main.js',
  './manifest.webmanifest',
  './assets/textures/paper-512.png',
  './assets/sprites/glyphs.png',
  './assets/sprites/stamp.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nikoli-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isSameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!isSameOrigin(url)) return;           // 字体、CDN 一概不管，别替别人缓存
  if (url.pathname.endsWith('/sw.js')) return; // 自己必须回源，否则新版本永远上不来

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        // 导航请求断网时退到缓存里的首页：让离线打开不白屏
        return req.mode === 'navigate' ? caches.match('./index.html') || Response.error() : Response.error();
      }))
  );
});

// 页面发消息过来（新版本装好）就转交给所有客户端
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
