# 玩法引擎契约

引擎是**纯状态机**：不碰 DOM、不读 `localStorage`、不取当前时间、不随机（随机只走 `js/core/rng.js:41` 的 `rngFrom`）。
这条边界让整个 `test/` 目录能在 node 里跑真实游戏逻辑，也让同一个 seed 在任何设备上
生成同一道题 —— 每日挑战的"全球同题"依赖于此。

## kind 描述符（模块 default export）

```js
{
  id: 'nonogram',            // 与文件名一致
  title: '数织',              // 中文显示名
  latin: 'NONOGRAM',
  tagline: '行与列的数字，就是图形的轮廓',
  rules: ['…', '…'],          // 玩法说明（首页"怎么玩"抽屉逐条渲染）
  unit: '格',                 // HUD 进度单位
  sizes: [{ key: 5, label: '5×5', tier: '入门' }, …],
  generate(seed, sizeKey) -> spec,   // 纯函数；spec 必须能 JSON.stringify
  create(spec) -> engine,
}
```

11 家玩法各自 default export 上面这一坨，汇总住在 `js/puzzles/registry.js:33` 的 `KINDS`；
首页图标与副笔文案不在引擎里，而在同一文件 `js/puzzles/registry.js:19` 的 `SHELL`。

## engine

```js
{
  spec,
  board: { cols, rows, margin: { l, t, r, b } },  // 余量以"格"为单位，提示数字画在余量里
  layoutIn(box) -> cell                            // 由 UI 计算，引擎不要自己算尺寸

  down(x, y, btn) -> changed        // x/y 为整数格坐标（可能越界，引擎自行忽略）
  move(x, y)      -> changed        // btn=0 主笔，btn=1 副笔（数织=X 标记）
  up()            -> changed
  undo() / redo() -> changed        // 快照栈由引擎维护
  canUndo() / canRedo() -> bool
  hint() -> null | { cells: [[x, y], …], note: '' }   // 必须真的改动状态
  solved() -> bool
  stats() -> { moves, par, done, total }
  draw(ctx, v, now)                                 // 每帧调用；now 为 performance.now()
  celebrate(ctx, v, now, t)                         // 可选：通关动画 t∈[0,1]
  badCells() -> [[x, y], …]                         // 可选：与题面矛盾的格子，UI 闪红
}
```

`v`（view）由 UI 每帧构造：

```js
{ cell, ox, oy, cols, rows, w, h, dpr, hover: { x, y } | null, bad: [[x, y], …], reduce }
```

`v.bad` 由外壳在**抬手时**调 `badCells()` 算一次塞回来 —— 求解器级的检查不能跟着
`pointermove` 每帧跑。引擎负责把它画成红色描边，不负责判定何时该算。

`v.ox + x * v.cell` 是格 `(x, y)` 的左上角；`v.cell` 已含 margin 偏移后的最终边长。
`reduce` 是"减弱动效"设置，引擎据此关掉脉冲与位移。

## moves / par 的口径（评星就靠这两个数）

`moves` 是**单调累加的落子数**：撤销不回退它，重做也不另收一次（那一步早就付过账），画错的记号
不计入它，只有"往盘面上落一子"才 +1。所以 `moves - par` 就是玩家浪费的步数 —— 靠撤销洗不掉，
评星才测得出人在试错。`par` 必须是可证明的下界，不能是常数：

| 玩法 | par | 依据 |
|---|---|---|
| 数织 | 要涂黑的格数 | 一次落子最多涂一格 |
| 数链 | n×n | 铺满全盘每格至少落一次 |
| 点灯 | 最少按压数（求解器算出） | 全解枚举取权重最小 |
| 孔明棋 | 起始子数 − 1 | 每步恰好消一子 |
| 数墙 | 唯一解里的墨格数 | 一次落子最多染一墨 |
| 帐篷 | 唯一解里的帐篷数（= 行线索之和） | 一次落子最多搭一顶 |
| 黑白 | 题面之外的格数 | 每格的颜色都得有人定一次 |
| 隔离 | 唯一解里的黑格数 | 一次落子最多划一格 |
| 五寸钉 | n×n | 每格的斜线都得定一次；原地换向不收账 |
| 数间 | 盘上的数字个数 | 一笔只能围出一间，而每间都得有人围一次 |
| 数邻 | 骨牌张数 = k(k+1)/2 = 盘格数的一半 | 一笔落一块骨牌（两块一格），而每张骨牌都得有人落一次 |

"一子"是什么由各玩法自己定 —— 数织是一格、点灯是一次按、孔明棋是一跳、数间是一笔框住四格。
但 `moves` 与 `par` 必须按**同一个**"子"计：不然数间里"一笔围出四格"会被读成省了四步，
而数墙里"拖动连涂四格"会被读成四步。每家的 `test/<id>.test.mjs` 都有一条"照解走一遍
moves 恰好等于 par"的断言，就是钉这件事的。

外壳的星级：★ 解出 · ★★ 零提示 · ★★★ 零提示且 `moves ≤ ceil(par × 1.2)`。

判胜之后棋盘**锁输入**（`down()` 返回 false），改笔必须走撤销。

## 生成器的质量底线

`generate` 交出来的题**必须有唯一解**，并且要么能用人的推理路径推出（数织要求纯逻辑可解），
要么其"最少步数"是已知下界（点灯/孔明棋/数链把 `par` 记进 spec）。
UI 拿 `par` 评星，所以 par 不能是拍脑袋的常数。约束全部写在 `test/<id>.test.mjs` 里，
用 fuzz（每档 40 个 seed）守住，不靠人工抽查。
