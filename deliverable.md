# 交付说明 · 纸上逻辑 Nikoli（并线收口这一轮）

本轮做的事：**把这个仓从「整局不可玩」修回可玩，并把并线留下的缝合体拆成「两侧并集」**。

## 一、并线的两侧各管什么

分叉点 `2f096a3`。两侧各自往前走了：

| | 本地侧 `ce7d320` | 远端侧 `2f096a3`（= 合并基点） |
|---|---|---|
| app | 重写了整份实现与页面：`js/ui/app.js`、`js/ui/board_view.js`、`js/core/{art,audio,motion,paper,pwa,storage,theme}.js`、`assets/`（十三张图标 + 社交卡 + 织理 + 精灵图） | 只动了音频那一小块：`store.settings.sound` 那套开关与 `setMuted()` |
| 闸与工程 | — | 部署集闸（`deploy-set.mjs` / `selftest` / `assemble-site.sh`）、文档行号对账腿（`test/docs.test.mjs`，十五项判据）、CI、`.gitignore`、README 的重写 |

**并线工具把两边按块裁到了一起，裁出来的是缝合体**：`js/ui/app.js` 成了「本地侧的身 + 远端侧那套音频开关」，
`index.html` 成了「远端侧的头 + 本地侧的身」，`js/core/audio.js` 两边各留一半。

## 二、缝出来的断裂（逐条修掉）

| # | 断裂 | 症状 | 怎么修的 |
|---|---|---|---|
| 1 | `js/ui/app.js` 的 `debug` 对象里写着 `audioState,`（对象简写），而这一版的 import 把 `audioState` 裁掉了、另一侧又没有这个导出 | 模块求值即 `ReferenceError` ⇒ **整局不可玩** | 两个文件一起回到本地侧那一份（那一侧是一套的：`audioState()`（`js/core/audio.js:49`）、`isMuted` / `toggleMuted` 都在） |
| 2 | `js/core/audio.js` 两边各留一半：本地侧的 `toggleMuted` / `audioState` 被裁掉，远端侧的 `setMuted(on)` 留着 | 同上 | 同上（两份一起回，否则仍是一套半） |
| 3 | `index.html` 的 head 混搭：`og:title` / `og:description` / `og:image` / `twitter:card` / `twitter:image` 各出现两遍（远端侧一份、本地侧一份） | 抓取器读到的是**第一份**（远端侧那份 `og:image` 指着 `icons/icon-512.png`），本地侧新产的社交卡 `assets/brand/og-cover.png` 永远轮不到 | 页面回到本地侧那一份，head 只留一套；`og:image` / `twitter:image` 改成**绝对 URL**（部署集闸 R7 要求：抓取器不会替 Pages 补 `/<slug>/`） |
| 4 | `index.html` 的 HUD 混搭：顶栏是远端侧的 `#btn-fullscreen`，本地侧要的 `#fullscreen-btn` / `#pause-btn` / `#pause-veil` 只在 body 里 | 全屏键有两套 id，真接线的那套没有入口 | 页面整体回到本地侧那一份 |
| 5 | `manifest.webmanifest` 是远端侧那份精简的（`start_url: "."`、无 scope、三张图标、配色 `#0a0a12`），而页面这一版的底色是 `#f4efe3` | 装上桌面的壳与页面不是一套配色；`start_url` 不是 `./` | manifest 回到本地侧那一份（`id`/`start_url`/`scope` 都是 `./`、`display_override`、分类与语言、四张图标与 shortcut、配色 `#f4efe3`） |
| 6 | `js/main.js` 末尾接进了一整块全屏实现，绑的是页面里并不存在的 `#btn-fullscreen` | 点那个键什么也不会发生，量具却算它"已实现" | 删掉那一块（真接线是 `toggleFullscreen()`（`js/ui/app.js:291`），绑的是 `#fullscreen-btn`） |
| 7 | `js/sw-register.js`（远端侧那份普通脚本）与 `js/core/pwa.js`（本地侧的模块）**两处都注册 service worker** | 同一个 scope 注册两次，靠浏览器自己去重 | 删掉 `js/sw-register.js`：闸没点名它、无人引用、文档没印它的路径（三项都核过）；注册留在 `js/core/pwa.js` |

## 三、闸：一条断言没删，强度只升不降

- `tools/deploy-set.mjs`：**实数钉** `EXPECT_CHECKS 67 → 78`、`EXPECT_ROWS 86 → 100`
  （页面与 manifest 回到并线前的那一版，head 里那套多档图标与社交卡、manifest 的四张图标与
  shortcut ⇒ R 段多解析出十一条引用）。**钉的是实数，强度不变**：R12/R13 两条断言本身没动。
- `tools/deploy-set-selftest.mjs` 未改：十三刀照旧发力（X10 阴性对照照旧不发力），rc=0。
- `test/docs.test.mjs`（文档行号对账腿）：十五项判据全绿。**新建这份 `deliverable.md` 之后它
  仍然绿** —— 输入集从三份文档变成四份，而 D2 要求「每份文档都至少贡献一条引用」，所以本文里
  的代码出处都写成可定址的形状（名字 + `path:NN`），由那条腿逐条读回真文件对账。

## 四、实数读数（本机实跑）

```
npm run check          OK 42 files
npm test               tests 271 / pass 271 / fail 0
                       文档行号对账：4 份文档 · 23 条引用 · 12 条带指认 · 0 条续引 · 0 条跨仓 · 15 条判据
bash tools/verify.sh   单测 271 全过 + 无头真指针通关 11 种玩法 92 行 / 0 失败 + 截图 12 张
                       deploy-set 78 条路径引用（含 4 张位图尺寸核对）失败 0 项 / rows 100
                       deploy-set-selftest rc=0（十三刀全发力）
cos_load_sweep         LOADED（并线后是 LOAD-ERROR）
```

## 五、需人接手的两条

1. **静音开关的模型**：本地侧用 `store.settings.sound` + `isMuted()` / `toggleMuted()` /
   `audioState()`，远端侧用 `setMuted(on)` 加同一份存档偏好 —— 存档的键是同一个，**两份实现只留了
   本地侧那份**。若组织更想要远端侧那个函数式接口，改的是 `js/core/audio.js` 的导出面
   （`isMuted` / `toggleMuted` / `audioState` 三个都在 `js/ui/app.js` 里有调用点），不是改存档。
2. **`icons/` 目录（远端侧那六张图标）现在没人引用**：manifest 与页面都走本地侧的 `assets/icons/`。
   本轮没删（闸不点名它们，但删文件要人拍板）；留着只是产物里多六张没人要的 PNG。

## 六、改过的文件

```
index.html            回到本地侧那一份；og:image / twitter:image 改成绝对 URL（R7 要求）
js/ui/app.js          回到本地侧那一份（audioState 的 import 与 debug 对象归位；删掉末尾那块死全屏）
js/core/audio.js      回到本地侧那一份（isMuted / toggleMuted / audioState 归位）
css/game.css          回到本地侧那一份
manifest.webmanifest  回到本地侧那一份（id/start_url/scope 都是 ./、四张图标与 shortcut、配色对齐页面）
js/sw-register.js     删除（与 js/core/pwa.js 重复注册 service worker；三项都核过）
tools/deploy-set.mjs  实数钉 78 / 100
README.md             读数按实跑对齐（271 用例 / 42 文件 / storage 10 条 / 合计 270 / 文档 4 份）
deliverable.md        本文件（新建）
```
