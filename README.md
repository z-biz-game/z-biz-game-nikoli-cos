# 纸上逻辑 Nikoli

浏览器原生的纸笔推理谜题合集：**数织 / 数链 / 点灯 / 孔明棋 / 数墙 / 帐篷 / 黑白 /
隔离 / 五寸钉 / 数间 / 数邻**。十一种玩法各带一个唯一解生成器和一个真求解器 —— 提示不是写死的剧本，
而是当场推出来的那一步。

零构建、零运行时依赖、零美术与音频文件：打开 `index.html` 需要的那点东西全在
`js/` 里，Canvas 2D 画棋盘，WebAudio 合成音效，localStorage 存进度。

```bash
node tools/serve.mjs        # → http://127.0.0.1:5173/，然后点开任一档位
node --test test/*.test.mjs # 269 项引擎单测（不开浏览器）
bash tools/verify.sh        # 单测 + 无头 Chrome 真指针通关，一把梭
```

> 直接双击 `index.html` 不行：裸 ES Module 在 `file://` 下会被 CORS 挡掉，必须有 http://。

本文的写法是**每条承诺都点名一道真会红的命令**，并在最后列出「不承诺」的那一部分。
所有整数都是本轮（2026-09-30，本机 node v26.8.1）复跑出来的读数，不是估计；
能被破坏试验推翻的，都记在〈上面那些"会红"是怎么验出来的〉那张表里。

## 十一种玩法

| 玩法 | 档位 | 生成器保证 | 提示怎么来的 |
| --- | --- | --- | --- |
| 数织 Nonogram | 5×5 / 7×7 / 10×10 / 12×12 / 15×15 | 只靠线推理就能推到底，不需要猜 | 逐行逐列做交集推理，卡住时才做反证 |
| 数链 Number Link | 4×4 / 5×5 / 6×6 | 哈密顿路径切段，且枚举确认过唯一解 | 交出唯一解里的一格，而不是整条答案 |
| 点灯 Lights Out | 4×4 / 5×5 / 6×6 / 7×7 | 由按压集合倒推盘面，一定可解；按压数落在该档区间内 | GF(2) 上解出全部解，取最短的那一步 |
| 孔明棋 Peg Solitaire | 25 孔小十字 / 33 孔英式 / 37 孔法式 | 从"只剩一子"的终局倒放生成，天然有解；中心空、且现搜够快 | 在原路线上照本宣科；走偏了现搜 DFS + 死局记忆 |
| 数墙 Nurikabe | 7×7 / 8×8 / 10×10 | 带计数的求解器数过解数（数到第二种就早停；预算烧完报 `capped` 并丢题） | 拿"全盘还要几滴墨"算账，交出逻辑上被逼定的那一格 |
| 帐篷 Tents | 6×6 / 8×8 / 10×10 | 按"每棵树恰配一顶"生长，六条规则推到不动点后再枚举复核 | 六条规则的下一手：该搭的搭、该封的整行封 |
| 黑白 AKBANE | 6×6 / 8×8 / 10×10 | 从满标数盘一条条擦数，每擦一个都穷尽数过解数才放行 | 先擦掉与唯一解冲突的那格，再给被逼定的那格 |
| 隔离 Hitori | 6×6 / 8×8 / 10×10 | 先摆合法黑盘、再用二分图匹配反推数字盘；缝不出题面就换盘 | 交出"哪一个解里它都必是黑格"的那一枚 |
| 五寸钉 Slant | 6×6 / 8×8 / 10×10 | 先画满斜线再数交点，数字天生来自某个真解；删数后每一刀都用铅笔路径重证唯一 | 先擦掉与推导冲突的斜线，再交逼定的那一笔 |
| 数间 Shikaku | 6×6 / 8×8 / 10×10 | 随机切盘再合并邻块；交出的盘既要纯规则推到底（零反证），又要独立枚举数到恰好一种分法 | 先擦掉塞不进任何一种摆法的墨，再交"唯一归属/全线穿透/区域锁定"的下一手 |
| 数邻 Dominosa | 4×5 / 6×7 / 8×9 | 种一套铺满全盘的骨牌、把每个无序数对（含双数）一一分配过去，再对调数字，每调一次都用带计数的求解器数过解数 —— 数到第二种就丢题，预算烧完（`capped`）也丢题 | 铅笔三条（P1 数对只剩一处落点、P2 格子只剩一个搭档、P4 落点共格锁定）刷到不动点，卡住才一层反证，**再卡住就交出唯一解里的一块** |

每道的规则文案就在 `js/puzzles/<玩法>.js` 的 `rules` 里，首页 `?` 按钮弹的就是它
（`test/<玩法>.test.mjs` 第一条用例就查"标题、规则文案、档位表"这三件齐不齐）。

> **数邻的口径要说死，不许糊**：这一款**不承诺纯逻辑可解**。本轮在仓内那条 fuzz 用例
> （`test/dominosa.test.mjs`，seed 串 `fuzz:<档>|<i>`，每档 40 张）里只用铅笔三条就推满全盘的比例是
> **36/40 · 19/40 · 14/40**（4×5 / 6×7 / 8×9）—— 也就是 8×9 那档**十张里有六张多推不完**，
> 必须靠一层反证；反证也收不住的剩下的块就交给"答案"那一级。
> 仓外探针（工作区根的 `_tmp-dominosa-readings.mjs`，不在仓里、没有闸守着，seed 串 `probe|<档>|<i>`，
> 各 40 张）本轮给 **38/40 · 24/40 · 16/40 = 95% / 60% / 40%**。两个口径都摆在这儿，取低的看也不好看。
> 再记一条覆盖缺口：提示阶梯最后那一级"交出唯一解的一块"在这两套各 120 张（合计 240 张）盘里
> **命中 0 次** —— 反证那一级都收住了。它现在只由 `test/dominosa.test.mjs` 里一张**手摆的 2×3 盘**
> （三条铅笔与一层反证都判不出哪种切法活）单独覆盖，生成器路径上目前**没有实测样本**。
> 出题这一侧本轮实测：三档 120 张盘的数解预算一次都没烧穿（`cappedTries` 合计 0，两条量法都是 0）。

## 承诺表：每条承诺都有一道真会红的命令守着

左列是屏上或本文说出口的话，中列是**本轮真跑过**的命令，右列是它到底在比什么。
用例数由 `node --test --test-reporter=spec` 打印（`ℹ tests / pass / fail`），
无头那条由 `tools/verify.sh:118` 打印 `rows: N fail: … errors: …`。

| 承诺 | 哪条命令会红 | 它判什么 | 本轮读数 |
| --- | --- | --- | --- |
| 每道玩法的规则不是文案，是两层实现 | `node --test test/<玩法>.test.mjs` | 引擎判定与测试文件里那份"谁都不 import"的独立实现（`bruteOk` / `myCheck` / 位图参照）逐张盘面比"合法/不合法"，谁多说一句都当场露馅 | 黑白 `agree == 300`、隔离 `300 + TIERS.length`、数墙 **420**（4/5/6 各 140 张随机盘）、帐篷 `12 × 档位数`、数邻 `fuzz` 每档 40 张 + 一张挖格反例 |
| 唯一解不是生成器自己说的 | `node --test test/{nurikabe,tents,akabane,hitori,slant,shikaku,dominosa,numberlink}.test.mjs` | 每题都交给"带节点预算、数到第二种就早停"的计数器重数一遍；`capped` 的盘必须**丢掉**，不许当成唯一 | 每档 40 颗 seed 的 fuzz 用例全绿；数邻 `丢题 0`、`cappedTries 合计 0` |
| 预算烧完要说"不知道"，不能说"无解"或"唯一" | `node --test test/pegsolitaire.test.mjs`、`…/shikaku.test.mjs`、`…/nurikabe.test.mjs`、`…/akabane.test.mjs` | 37 孔法式满盘缺中心给 80 万节点也烧不完 → `capped === true`；数间计数器不许把半截计数洗成证明；数墙/黑白"没数完"与"只有一种解"分开 | 破坏试验刀 5 实测：把 `capped: !exhausted` 改成 `capped: false`，`预算烧完要如实报 capped` 立刻红 |
| 25 孔小十字"满盘缺中心"是**可证**无解 | `node --test test/pegsolitaire.test.mjs` | 两套实现都跑到穷尽（`capped === false`），且 `nodes === dead`：走过的每个局面都被证明是死局 | 手写常量 `assert.equal(stats.nodes, 214749)`（`test/pegsolitaire.test.mjs:274`）本轮复现 |
| 同一颗 seed 在任何设备上是同一道题 | `node --test test/*.test.mjs`（11 个套件各有一条） | 同 seed 两次 `generate` 逐字节相等、spec 过 `JSON` 往返不变味；换 seed 才换题（40 颗 seed 要交出 40 张不同的脸） | 全部 13 个套件 `fail: 0`；`faces.size == 40` 这类"不许重复"的等式在黑白/隔离/数墙/帐篷里各钉一份 |
| 引擎不知道有屏幕，也不读时钟 | `node --test test/{akabane,dominosa,hitori,nurikabe,slant,tents}.test.mjs` | 源码级扫描：模块文本里出现 `Math.random` / `new Date` / `document.` / `localStorage` / `window.` 就红 | 本轮**只覆盖 6/11 款**（见「不承诺」）；破坏试验刀 1 实测：往 `tents.js` 塞一句没人调用的 `Math.random()`，纯度用例单独红 |
| 难度是量出来的，不是形容词 | `node --test test/slant.test.mjs`、`…/shikaku.test.mjs` | 五寸钉按"推导收敛遍数"排档：越大的盘遍数越多，档位带互不重叠；数间三档的分数带也互不重叠，且与档位表说的是同一件事 | `档位要分得开` / `难度是量出来的` 两条用例绿；尺子的来历见 `docs/DESIGN.md`「难度锚点要先量它会不会动」 |
| 提示真的落子，而且一次只走一小步 | `node --test test/*.test.mjs`、`@无头` | 一路 `hint()` 必须能点到通关；不许一次涂满全盘；不许倒退款；给的那一步必须落在真解上（数墙/隔离/数邻各有"越轨必须为 0"的等式） | 数邻 fuzz 打印 `越轨 0`（本轮三档各 40 张）；无头 92 行里 11 条"一路点到通关"全绿 |
| 每一关都能用真手势下完 | `bash tools/verify.sh` | CDP `Input` 域发**真** `mousePressed/Moved/Released`（不是页面里 `dispatchEvent`），从第一格点到结算屏；另验键盘光标、真点撤销、390×720 手机视口、15×15 大片布局、全程零控制台错误 | `rows: 92  fail: []  errors: []` → `=== ALL GREEN ===` |
| 每日挑战不需要服务器 | `node --test test/registry.test.mjs` | `dailySpec(day)` 只由日期决定、两条入口拿到同一套题；28 天里**每个档位都轮到过**且没有一档吃掉 75% 以上；其余十款的 28 天序列逐字节钉死（黄金值是接线前跑出来的读数） | 本轮 `tests 7 / pass 7 / fail 0`；破坏试验刀 3 把轮转换回"从同一颗哈希切位段"，`加玩法不改别人的排期` 当场红 |
| 撤销不退款，评星测得出试错 | `node --test test/*.test.mjs`（各家一条）+ `@无头` | 快照只搬盘面不搬账；照唯一解干净地走一遍，`moves` 必须恰好等于 `par`；`par` 是可证下界（`docs/DESIGN.md` 逐款给了推导） | 破坏试验刀 4（隔离 `undo()` 退款）、刀 6（数织 `par+1`）、刀 7（数邻副笔开始收账）三刀各点名咬住自己那条用例 |
| 存档能导出再导回来，坏盘不崩 | `node --test test/storage.test.mjs` | 假 localStorage 接上：盘上形状 == 内存形状、`best` 只会变小 / `solves` 只会变大、连续天数按日历日（跨月末）、export→import 在"另一台机器"上逐字节还原、垃圾文本当场拒、`reset` 真清盘、`setItem` 抛错只降级 | 本轮新增这一套（9 条用例）。它当场揭出一条真会崩的路：`{"records":7}` 能过旧的导入校验，然后在**通关那一刻**抛 `Cannot create property … on number '7'`，而且盘已经写坏、刷新就再崩一次 —— `js/core/storage.js` 的 `isObj/objOr` 就是这一轮的修复 |
| 门面报的玩法数不许还写着上一次那个数 | `node --test test/registry.test.mjs` | `README.md` / `package.json` / `index.html` 里凡「N种玩法 / N种纸笔推理谜题」的汉字数必须等于 `KINDS.length`，且 `index.html` 的 `#/…>` 静态占位必须等于 `/11` | 破坏试验刀 8（把占位改回 `/10`）、刀 9（把本文标题里那个数词抹掉一个字，让 README 报旧数）各红一次；这条还带防空转：找到的报数点少于 3 处就红 |
| 一个语法错的引擎文件不许上线 | CI 的「语法自检」步（`.github/workflows/ci.yml:19-22`），本地 `npm run check` | `git ls-files '*.js' '*.mjs'` 逐个 `node --check` | 本轮 `npm run check` → `OK`（**37 个文件**，含新增的 `test/storage.test.mjs`） |
| 加一道玩法有清单可抄 | `node --test test/registry.test.mjs` + `js/puzzles/CONTRACT.md` | 契约字段齐备（`generate/create/down/move/up/undo/redo/canUndo/canRedo/hint/solved/stats/draw` + 可选 `celebrate`）、`par` 在引擎与题面两处必须是同一个数 | 同上 `tests 7 / fail 0` |

13 道 node 套件合起来本轮是 **269 条用例、0 失败**；浏览器层 **92 行、0 失败**，
加在一起是 `bash tools/verify.sh` 交回的 `=== ALL GREEN ===`（退出码 0）。
`tools/verify.sh:120` 还有一条防空跑：无头行数少于 20 就判失败 —— "跑完了但一条都没记上"不算过。

### 上面那些"会红"是怎么验出来的

把整仓拷到仓库外的临时目录（`_tmp-nikoli-copy/repo`，副本用完即删，真仓一行没改），
每次只破坏一个字段，然后跑点名的套件。本轮十四枪（脚本：工作区根 `_tmp-nikoli-sab.py`，
日志 `_tmp-nikoli-sab.log`，末行 `=== 判定 14 枪 / 与预期不符 0 ===`）：

| 破坏 | 红的用例（套件） |
| --- | --- |
| `tents.js` 里凭空多一句无人调用的 `Math.random()` | `引擎不碰时钟也不碰随机数…`（tents）；`registry` 不红 —— 它本来就不查纯度 |
| 帐篷"贴身"从八邻域缩成正邻四格（斜角挨着放行了） | `斜角相贴要能单独被判死…`（tents，本轮新增） |
| 每日档位轮转退回"从同一颗哈希上切位段" | `加玩法不改别人的排期…`（registry） |
| 隔离的 `undo()` 给落子退款 | `只有落黑格收账…撤销与重做都不退款`（hitori） |
| 数间计数器把"没数完"说成数完了 | `预算烧完要如实报 capped…`（shikaku） |
| 数织把 `par` 报多一格 | `engine: moves counts effort…`（nonogram）；`registry` 不红 —— 数织的 `par` 不在 spec 里，两处等式对它空转 |
| 数邻副笔那道界线开始收账 | `副笔划线：不收账、可撤销…`（dominosa） |
| `index.html` 的每日分母写回 `/10` | `index.html 里的静态占位与注册表同数…`（registry） |
| 本文的「## 十一种玩法」改成「十种」 | `玩法数量的口径一致…`（registry） |
| 存档导入退回"只要 `records` 有值就收下" | `导入框里的垃圾必须当场拒绝…`（storage） |
| 存档读盘退回"`records` 有值就信" | `盘上是坏的或半截的也要能玩…`（storage） |
| 存档把"最佳用时"改成留最差那条 | `best 只会变小、solves 只会变大…`（storage） |
| （**不该红**）副笔文案换一个 `tip` 字 | 无 —— 用例只查 `tip` 非空，文案不是承诺 |
| （**不该红**）`exportText()` 换了 JSON 键序 | 无 —— 承诺是形状与数值，不是键序 |

第二枪值得单独说一句：改之前它**不红**。原来那条"斜角相贴"的负例把帐篷同时放进了
行线索为 0 的行，于是行列账先把它判死，八邻域那条规则删掉也没人说话 —— 本轮补了一张
与真题只差"帐篷滑一格"的盘（其余四条规则全满足），才有这一枪的红。这也是本文为什么
只把"会红"当成证据，而不把"用例名字里写了什么"当成证据。

## 怎么跑：`package.json` 的四条 scripts 逐条核对

本轮（2026-09-30）每条都真跑过，右列是它这次的实际行为。

| script | 命令 | 本轮状态 |
| --- | --- | --- |
| `start` | `node tools/serve.mjs` | 可跑；默认 `:5173`（`tools/serve.mjs:9`），只绑 `127.0.0.1`，路径带 `..` 逃逸一律 403 |
| `test` | `node --test test/` | 本机 node v26.8.1 → `tests 259`（改前）/ 现在 269 全绿。**但这是最不该用的一条**：node 22（CI 那台）拿到目录参数时一个文件都找不到，只报一条名为 `test` 的失败，看起来像"测试跑了没通过"，其实一道都没跑（`docs/DESIGN.md` 记了这个坑）。写文档、发命令请一律用 `test/*.test.mjs` 展开形式 |
| `check` | `for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f"; done` | `OK`；本轮展开成 **37 个文件**（依赖 `git ls-files`，在没有 `.git` 的副本里会静默扫到 0 个文件 —— 所以它测的是"这个 checkout 里的源码"） |
| `verify` | `bash tools/verify.sh` | `=== ALL GREEN ===`，退出码 0（本文所有读数都来自这条） |
| `deploy-set` | `node tools/deploy-set.mjs` | 绿：对拷出来的产物提要求（见「上线的到底是哪一批文件」一节） |
| `deploy-set:selftest` | `node tools/deploy-set-selftest.mjs` | 绿：9 刀逐类打红且点名 + 1 条阴性对照 |
| `deploy-set` | `node tools/deploy-set.mjs` | 绿：对拷出来的产物提要求（见「上线的到底是哪一批文件」一节） |
| `deploy-set:selftest` | `node tools/deploy-set-selftest.mjs` | 绿：9 刀逐类打红且点名 + 1 条阴性对照 |

另有两条不在 `package.json` 里、但 CI 真的在用的入口：

- `.github/workflows/ci.yml` —— 语法自检 + `bash tools/verify.sh`（`WD_TIMEOUT=420`、
  `SHOT_DIR=verify-shots`），单测命令写的是 `test/*.test.mjs` 展开形式，并强制
  `--test-reporter=spec`：stdout 不是 tty 时 node 22 自己会切 tap，下面那些 `grep` 一条都不命中。
- `.github/workflows/pages.yml` —— 没有构建步骤，只把 `index.html`、`css/`、`js/` 拷进 `_site`
  （`tools/` 与 `test/` 不上线），`configure-pages` 之后由 `deploy-pages@v4` 部署。

`bash tools/verify.sh` 也支持局部复验：`KINDS=tents …` 只跑一款、`SKIP_UNIT=1 …` 跳单测、
`SPORT=…`/`CDP_PORT=…` 换端口。

## 门禁清单：本轮逐条复跑

`node --test --test-reporter=spec test/*.test.mjs` → **`tests 269 / pass 269 / fail 0`**。
每个套件自己跑一遍的分账（本轮实测）：

| 套件 | 用例 | 套件 | 用例 |
| --- | --- | --- | --- |
| `akabane` | 20 | `pegsolitaire` | 29 |
| `dominosa` | 20 | `registry` | 7 |
| `hitori` | 21 | `shikaku` | 24 |
| `lightsout` | 20 | `slant` | 25 |
| `nonogram` | 23 | `storage` | 9（本轮新增） |
| `numberlink` | 26 | `tents` | 22（本轮 +1） |
| `nurikabe` | 23 | **合计** | **269** |

浏览器层 `rows: 92`。`tools/playtest.mjs` 里有 23 个 `ok()` 落点（`37:` 那个是定义，不算），
92 行是这么来的：

| 组 | 落点 | 展开 |
| --- | --- | --- |
| 首页与加载 | 6 个（`window.nikoli` 挂上、卡片、每日每款一格、分母、孔明棋写"孔"、怎么玩弹窗） | 6 行 |
| 每款玩法的循环 | 8 个模板串落点，其中「落子探针」只在失败时才打 | 7 × 11 = 77 行 |
| 数邻副笔 | 1 个（那条界线必须由真 `pointerdown` 打出来） | 1 行 |
| 零散腿 | 8 个（键盘光标、撤销按钮可用性、撤销不退款、声音按钮改存档、15×15 布局、每日种子、390×720 手机视口、零控制台错误） | 8 行 |
| | | **92 行** |

关于计时：无头层**没有任何墙钟断言**（`tools/playtest.mjs` 里 `Date.now` / `performance.now`
出现 0 次），所以机器忙不会让这条腿变红。单测里剩下的毫秒只有"保险丝"一种用途 ——
例如黑白的 `BUDGET = {6: 12000, 8: 30000, 10: 60000}`（`test/akabane.test.mjs:394`）、
数邻的 `FUSE = {4: 4000, 6: 8000, 8: 40000}`（`test/dominosa.test.mjs:695`）——
它只咬"算法塌成指数"，**不承诺手感**，可证的上界写在档位自己的 tries/audit 里。

## 引擎契约

外壳只管路由、计时、记分和输入设备无关性；棋盘内部的一切属于引擎。十一套引擎实现
同一个契约（[`js/puzzles/CONTRACT.md`](js/puzzles/CONTRACT.md)）：

- `generate(seed, sizeKey) → spec` 是纯函数，`spec` 必须能 `JSON.stringify`；
- `create(spec) → engine` 是不碰 DOM、不读时钟、不采样随机数的状态机；
- 同一个 seed 在任何设备上是同一道题 —— 每日挑战靠这个才成立；
- `moves` 单调累加：撤销不退款。评星因此测得出"人在试错"，洗不掉；
- `par` 必须是可证的下界，不能是拍脑袋的目标数（逐款的推导在 `docs/DESIGN.md`）；
- `hint()` 真的落子，不是弹一句话。

加一道新玩法 = 一个引擎文件 + `registry.js` 里三处（import、`SHELL` 一条、`KINDS` 末尾一个）
+ `test/<玩法>.test.mjs` + `tools/playtest.mjs` 里一条 PLAN 和一段"该怎么点"，
最后 `index.html` 那个每日题数占位与本文/`package.json` 的玩法数由 `test/registry.test.mjs` 钉着
与 `KINDS.length` 同数。第十一款（数邻）就是照这张单子接的。

## 存档

进度、最佳用时、连续天数都在 localStorage（`js/core/storage.js`，键 `nikoli.save.v1`，见该文件 `:4`）。
没有账号、没有服务器，也不上传任何东西。设置里可以导出成一串文本再导回来 ——
换设备、清缓存之前先复制一份。这一整段现在由 `test/storage.test.mjs` 守着（9 条用例，
含"另一台机器逐字节还原""坏盘不崩""导入拒垃圾"三条），清档 `reset` 会真清盘。

## 目录

```
index.html              单页外壳：首页卡片 + 棋盘屏 + "怎么玩"抽屉（相对路径，Pages 前缀下可用）
css/game.css
js/main.js              装配 + window.nikoli（无头复验的唯一入口）
js/ui/app.js            路由（#/、#/p/<玩法>/<档位>/<序号|d>）、计时、记分、评星、键盘
js/ui/board_view.js     格坐标 ↔ 画布像素的唯一换算处；指针事件 → 整数格
js/puzzles/*.js         十一款引擎：题面、状态机、渲染、求解器
js/puzzles/registry.js  玩法注册表 + 每日排题（唯一的排题处）
js/puzzles/CONTRACT.md  引擎契约
js/core/                rng（hashSeed/mulberry32/todayKey）、storage、audio、paper、theme
test/                   13 个 node 套件，269 条用例
tools/serve.mjs         只绑 127.0.0.1 的静态服（默认 :5173）
tools/playtest.mjs      CDP 真指针复验（23 个 ok() 落点 → 92 行）
tools/verify.sh         单测 → 静态服 → 无头通关 → 截图，一把梭
docs/DESIGN.md          给改代码的人：分层、口径、踩过的坑、数学事实
.github/workflows/      ci.yml（语法 + verify）、pages.yml（拷三样上线，不跑测试）
tools/assemble-site.sh  部署产物的唯一清单（pages.yml 与本地闸调同一支）
tools/deploy-set.mjs  部署集闸：检查即将上传的那份产物
tools/deploy-set-selftest.mjs  部署集闸的阴性自证（每一类断言当场打红一次）
```

## 端口与 URL 形态

| 场景 | 地址 / 参数 | 出处 |
| --- | --- | --- |
| 手工试玩 | `http://127.0.0.1:5173/` | `tools/serve.mjs:9`（`PORT` 环境变量或 argv[2] 可换） |
| 本地复验 | `SPORT=5188`、`CDP_PORT=9335` | `tools/verify.sh:21-23`，可被同名环境变量覆盖 |
| 线上 | `https://z-biz-game.github.io/z-biz-game-nikoli-cos/` | 本轮实测 200，`js/main.js` 与 `css/game.css` 都 200 |
| 路由 | `#/`（首页）、`#/p/<玩法 id>/<档位>/<序号>`、`…/d` = 当日题 | `js/ui/app.js:42-53`；档位不在表里就回首页 |
| 存档键 | `nikoli.save.v1` | `js/core/storage.js:4` |

`tools/verify.sh:79-85` 会**按标题认站**：端口上应答的 HTML 里必须有「纸上逻辑 Nikoli」才继续，
认不出就退出 4 —— 本机同时跑着好几个会话的 dev server，绑不上端口时别人会替我们答话，
那样跑完的 92 行其实是在别人的站上找 `window.nikoli`。

## 不承诺 / 已知边界

写得越少，越容易被当成写了。这里明确不承诺的：

- **数邻不承诺纯逻辑可解**（见上表的 36/40·19/40·14/40 与提示阶梯"答案"级 0 实测样本）。
- **引擎纯度扫描只覆盖 6/11 款**。`Math.random` / `new Date` / `DOM` 的源码级扫描在
  黑白、数邻、隔离、数墙、五寸钉、帐篷这 6 个套件里；数织、数链、点灯、孔明棋、数间
  **没有这道闸**（本轮 grep：这 5 个文件里目前也确无一处命中，但那只是人查，没有命令会红）。
- **仓外探针不是闸**。`_tmp-dominosa-readings.mjs` 那种工作区根脚本给的是"本轮读数"，
  换一颗 seed 串、换一台机器都可能变；它不进 CI，也不会让任何东西变红。本文引用它时
  一律写清"仓外探针，无闸守着"。
- **墙钟只当保险丝**。92 行与 269 条用例里唯一涉及毫秒的判定就是各家那几条 `BUDGET`/`FUSE`
  上界；本文不出现"多少毫秒能玩"的承诺。上一版在这里写过 `p50/p95` 的具体毫秒，本轮删了 ——
  同一个探针在同一台机器上两轮给的数字就差了 15%（8×9 档 8.22 → 7.04），它测的是机器不是算法。
- **"每档 40 颗 seed 全绿"是对那 40 颗的承诺**，不是对 seed 空间的承诺。生成器的拒绝原因
  分布（挖不出唯一、数不完、门槛松掉 `degraded`）按档在测试与 `spec` 字段里可查，但本文不给
  跨 seed 的失败率。
- **两层对拍的样本量各家不同**（黑白 300、隔离 303、数墙 420、帐篷 36、数邻"生成盘 + 挖一格反例"），
  它们不是"全部盘面"。要引用具体张数就照右列那组等式，别看用例名。
- **WebAudio 音效没有闸**。`js/core/audio.js` 合成提示音与通关音，没有任何用例打开过它；
  无头层带 `--mute-audio`。屏幕阅读器、色觉无障碍同样没有承诺（配色只在 `js/core/theme.js`）。
- **没有 electron 目标、没有构建产物、没有 i18n**。`git ls-files | wc -l` = 46（本轮），
  仓里没有 `node_modules`，`dependencies` 字段整个不存在 —— "零运行时依赖"是文件清单，不是安装说明书。
- **存档导出没有浏览器层的闸**。本轮把它做成了 node 层的 9 条用例，无头那条腿仍然只验
  "存档落了盘"（11 行）与"声音按钮改的是存档"，没有真点过导出/导入那两个按钮。

## 许可

MIT，见 [`LICENSE`](LICENSE)。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可能住在清单里而不是盘上的 `.png`
  （有的仓另有一条"零二进制文件"的承诺，那条只约束"有没有 .png 这个文件"）；如果 P 段只筛文件名，
  声明写 512 而真图 192 就一路放行。
- **钉住两个数**：R 段实际检查的路径条数（`67`）与这一次跑的断言条数（`85`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字，也不写别仓文档闸的编号：有的仓的文档闸会拿"文档里出现过的同名标识号"回数它
  自己的条数，还有的会把文档里点到的每个组编号逐个核对"这一轮真的发过"——两道闸共用一个名字，
  或者在本仓的文档里出现一个本仓没有的组编号，打红的都是不相干的那一边。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`67`、断言仍然 `85`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；把它们接进本仓
那条浏览器 one-shot（`tools/verify.sh`）还欠着——那道脚本的腿名单与条数钉是每个仓自己的形状。

