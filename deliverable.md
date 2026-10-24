# 交付说明 · 纸上逻辑 Nikoli（并线收口 + 真暂停两轮）

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
| 6 | `js/main.js` 末尾接进了一整块全屏实现，绑的是页面里并不存在的 `#btn-fullscreen` | 点那个键什么也不会发生，量具却算它"已实现" | 删掉那一块（真接线是 `toggleFullscreen()`（`js/ui/app.js:289`），绑的是 `#fullscreen-btn`） |
| 7 | `js/sw-register.js`（远端侧那份普通脚本）与 `js/core/pwa.js`（本地侧的模块）**两处都注册 service worker** | 同一个 scope 注册两次，靠浏览器自己去重 | 删掉 `js/sw-register.js`：闸没点名它、无人引用、文档没印它的路径（三项都核过）；注册留在 `js/core/pwa.js` |

## 三、闸：一条断言没删，强度只升不降

- `tools/deploy-set.mjs`：**实数钉** `EXPECT_CHECKS 67 → 78`、`EXPECT_ROWS 86 → 100`
  （页面与 manifest 回到并线前的那一版，head 里那套多档图标与社交卡、manifest 的四张图标与
  shortcut ⇒ R 段多解析出十一条引用）。**钉的是实数，强度不变**：R12/R13 两条断言本身没动。
- `tools/deploy-set-selftest.mjs` 未改：十三刀照旧发力（X10 阴性对照照旧不发力），rc=0。
- `test/docs.test.mjs`（文档行号对账腿）：十五项判据全绿。**新建这份 `deliverable.md` 之后它
  仍然绿** —— 输入集从三份文档变成四份，而 D2 要求「每份文档都至少贡献一条引用」，所以本文里
  的代码出处都写成可定址的形状（名字 + `path:NN`），由那条腿逐条读回真文件对账。

## 四、实数读数（本机实跑，2026-10-25）

```
npm run check          OK 44 files
npm test               tests 279 / pass 279 / fail 0
                       文档行号对账：4 份文档 · 44 条引用 · 23 条带指认 · 0 条续引 · 0 条跨仓 · 15 条判据
npm run deploy-set     79 条路径引用（含 4 张位图尺寸核对）失败 0 项 / rows 101
npm run deploy-set:selftest  rc=0（十三刀全发力）
```

无头 Chrome 那段（`tools/verify.sh` 里的 CDP 真指针通关 + 截图）本轮**没有**复跑 ——
本机不起浏览器。所以「92 行 / 0 失败 / 截图 12 张」仍是并线收口那一轮的读数；这一轮改的是
`js/ui/app.js` 与 `js/ui/board_view.js`（另加新增的 `js/core/pause.js`），浏览器层的行为由
`test/pause.test.mjs` 那一腿在 node 里顶着（假 DOM + 假 rAF 驱动真的外壳与真的棋盘视图）。

## 五、需人接手的两条

1. **静音开关的模型**：本地侧用 `store.settings.sound` + `isMuted()` / `toggleMuted()` /
   `audioState()`，远端侧用 `setMuted(on)` 加同一份存档偏好 —— 存档的键是同一个，**两份实现只留了
   本地侧那份**。若组织更想要远端侧那个函数式接口，改的是 `js/core/audio.js` 的导出面
   （`isMuted` / `toggleMuted` / `audioState` 三个都在 `js/ui/app.js` 里有调用点），不是改存档。
2. **`icons/` 目录（远端侧那六张图标）现在没人引用**：manifest 与页面都走本地侧的 `assets/icons/`。
   本轮没删（闸不点名它们，但删文件要人拍板）；留着只是产物里多六张没人要的 PNG。

## 六、改过的文件（并线收口那一轮）

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

## 七、真暂停这一轮（2026-10-25）

产品口径反转：回合制谜题必须有**真暂停**。这一轮把 `nikoli-cos` 的暂停从"有个按钮"变成
"表停、闸门关、恢复接着走"三件各自可验的事。

### 7.1 先量的三问（结论 + 行号）

| 问 | 结论 | 依据 |
| --- | --- | --- |
| 暂停期间**计时**真的不前进吗？ | 是 | `elapsedOf()`（`js/core/pause.js:12`）在 `paused` 时直接给结算好的 `elapsed`；`pauseAt()`（`js/core/pause.js:15`）在暂停那一刻把已用时间结算进去 |
| 暂停期间**输入**真的被拒吗？ | **原来不是** —— 有一个漏网的入口 | 闸门原本散在两处：外壳的动作问 `inputLocked()`（`js/ui/app.js:240`），画布的按下/拖动/键盘落子问 `this.gate()`（`js/ui/board_view.js:95`）。**漏网的是抬手**：`up()`（`js/ui/board_view.js:123`）原先不问闸门 —— 拖到一半按下暂停，抬手那一笔的收尾（数链的连线、数间的矩形）会落在暂停期间 |
| 恢复后**接着走**吗？ | 是 | `resumeAt()`（`js/core/pause.js:23`）把 `startedAt` 重开在恢复那一刻；引擎状态一个字节都不动 |

### 7.2 只补缺口（没有重写实现）

| # | 改动 | 为什么 |
| --- | --- | --- |
| 1 | 新增 `js/core/pause.js`（纯模块，不碰 DOM / window） | 暂停契约只有一份定义，且能在 node 里 import —— 行为级测试才排得出来 |
| 2 | `js/ui/app.js` 的计时与闸门改走这个模块 | `elapsedOf` / `pauseAt` / `resumeAt` / `resetAt` / `finishAt` / `lockedAt` 六处口径统一，外壳的字段没有第二份 |
| 3 | `js/ui/board_view.js`：抬手（`up()`）也问闸门；`pause()` 先把在飞的那一笔收掉（`endStroke()`，`js/ui/board_view.js:135`） | **本轮补的洞**：暂停期间改盘面。暂停那一刻先把在飞的那一笔收掉（相当于抬手），闸门随后才关 —— 收尾落在暂停之前，暂停之后任何输入都不再落到引擎上 |
| 4 | 新增 `test/pause.test.mjs`（8 条用例） | 手摇假时钟（假 `performance.now`）+ 假 rAF + 假 DOM，驱动**真的**外壳与**真的**棋盘视图 |
| 5 | `tools/deploy-set.mjs` 的实数钉 78 → 79 / 100 → 101 | 外壳多 import 一个模块，那条 import 本身就是一条相对路径引用 ⇒ R 段多解析出一条引用、多一条 R10 断言 |

### 7.3 破坏试验（四刀，跑在仓外副本上，真仓一个字没改）

| 破坏 | 红的用例 |
| --- | --- |
| 暂停时不结算已用时间（`pauseAt()` 里那行删掉） | 3 条红：表停 / 恢复接着走 / 反复三次 |
| `inputLocked()` 恒为 false | 1 条红：输入全被拒 |
| 暂停时不收掉在飞的那一笔 | 1 条红：拖到一半按下暂停 |
| 画布的抬手不再问闸门 | 1 条红：闸门关着时抬手 |

### 7.4 改过的文件（这一轮）

```
js/core/pause.js       新增：暂停契约的纯模块（表停 / 闸门 / 恢复）
js/ui/app.js           计时与闸门改走 js/core/pause.js；BoardView 接上同一把闸门
js/ui/board_view.js    抬手也问闸门；暂停那一刻先收掉在飞的那一笔
tools/deploy-set.mjs    实数钉 78 → 79 / 100 → 101（多一条 import 引用）
test/pause.test.mjs    新增：8 条行为级用例（手摇假时钟 + 假 rAF + 假 DOM）
README.md              加「暂停」一节与承诺表一行；读数按本轮实跑重贴
docs/DESIGN.md         加「暂停是外壳的事，引擎不许知道」一节
deliverable.md         本文件：这一轮的读数与三问的答案
```
