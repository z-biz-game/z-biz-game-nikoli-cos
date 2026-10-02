// 离线壳注册。三条硬边界：
// ① 只在 http(s) 下注册：file:// 打开这仓本来就跑不起来（裸 ESM 被 CORS 挡），
//    那种场合再抛一条 serviceWorker 红字只是噪音；
// ② 模块里相对 URL 是按**模块地址**解析的，sw.js 在仓库根，所以要拿 document.baseURI 算；
// ③ 注册失败（无痕、旧 Safari、跨域被拦）与玩家无关，catch 掉就好。

export function registerSW() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav || !('serviceWorker' in nav)) return false;
  const proto = (typeof location !== 'undefined' && location.protocol) || '';
  if (!/^https?:$/.test(proto)) return false;
  const base = (typeof document !== 'undefined' && document.baseURI) ||
    (typeof location !== 'undefined' && location.href) || '';
  if (!base) return false;
  let url;
  let scope;
  try {
    url = new URL('sw.js', base).href;
    scope = new URL('./', base).href;
  } catch {
    return false;
  }
  const go = () => nav.serviceWorker.register(url, { scope }).catch(() => false);
  if (typeof window !== 'undefined' && document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
  return true;
}
