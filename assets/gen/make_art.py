#!/usr/bin/env python3
"""纸上逻辑 Nikoli —— 仓内美术工厂（一条命令重画全部位图资产）。

为什么把它写进仓而不是本机画完丢图：资产必须可复现、可审、改配色能重跑。
产物清单（全部真 PNG，落到盘上被 index.html / CSS / canvas 直接引用）：

  assets/icons/icon-{16,32,48,64,96,180,192,512,1024}.png   应用与 PWA 图标
  assets/icons/maskable-512.png                              Android 遮罩安全版
  assets/textures/paper-512.png                              棋盘纸纹（可平铺，画布用）
  assets/textures/grain-256.png                              首页卡片纸纹（低对比，可平铺）
  assets/sprites/glyphs.png                                  十一种玩法题头 sprite（横向 atlas）
  assets/sprites/stamp.png                                   结算印章 sprite（3 态）
  assets/brand/og-cover.png                                  社交卡 1200×630

视觉母题 = 一张方格纸：米黄纸 + 细格线 + 墨绿方块 + 一枚橙红印章。
配色不凭空编，全部取自 js/core/theme.js 的 token（下面 PALETTE 与之一一对应）。

依赖：python3 + Pillow（组合工具链同款；`python3 -c "import PIL"` 可验）。
用法：python3 assets/gen/make_art.py [--only icons|textures|sprites|og]
"""
import argparse
import math
import os
import random
import struct
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:  # pragma: no cover - 环境缺库时给一句话指路，不静默产出空图
    sys.exit('需要 Pillow：pip3 install pillow（组合工具链 make_icons.py 用的就是它）')

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# 与 js/core/theme.js 的 T 一一对应（改 token 请同步这里，两边都是同源口径）
PALETTE = {
    'paper':      (244, 239, 227),  # #f4efe3
    'paper_deep': (236, 229, 213),  # #ece5d5
    'card':       (251, 248, 240),  # #fbf8f0
    'ink':        (43, 42, 38),     # #2b2a26
    'ink_soft':   (106, 101, 90),   # #6a655a
    'ink_faint':  (169, 162, 148),  # #a9a294
    'rule':       (207, 199, 179),  # #cfc7b3
    'rule_bold':  (154, 147, 127),  # #9a937f
    'accent':     (31, 111, 92),    # #1f6f5c
    'accent_lit': (74, 163, 131),   # CSS progress 的那支绿
    'warn':       (180, 82, 47),    # #b4522f
    'gold':       (192, 138, 46),   # #c08a2e
}

FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Songti.ttc',          # 与 CSS --font 同源
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
]
MONO_CANDIDATES = [
    '/System/Library/Fonts/Menlo.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/System/Library/Fonts/Courier.ttc',
]


def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def rgba(name, a):
    r, g, b = PALETTE[name]
    return (r, g, b, a)


# ── 纸：底 + 纤维噪声 ───────────────────────────────────────────────────────

def paper_plate(size, base='paper', grain_seed=7, strength=10):
    """一张边长 size 的纸：底色 + 稀疏短纤维。放大看是纸，缩到 16px 只剩一层暖白。"""
    img = Image.new('RGB', (size, size), PALETTE[base])
    px = img.load()
    rnd = random.Random(grain_seed)
    # 纤维：稀疏的短横道，低对比 —— 放大看是纸，缩到 32px 只剩一层暖白
    for _ in range(int(size * size / 220)):
        x = rnd.randrange(size)
        y = rnd.randrange(size)
        ln = rnd.randrange(1, 4)
        d = rnd.choice((-1, 1))
        for i in range(ln):
            xx = min(size - 1, x + i)
            c = px[xx, y]
            px[xx, y] = tuple(max(0, min(255, v + d * strength)) for v in c)
    return img


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


# ── 母题：2×2 数邻骨牌 + 点 ─────────────────────────────────────────────────

def stamp_dominos(draw, box, tone='accent', lw=None, fill_alpha=26, horizontal=None):
    """母题主角：一块 2×1 骨牌，两端各一枚点数。横竖由盒子长宽比自己定。"""
    x0, y0, x1, y1 = box
    s = min(x1 - x0, y1 - y0)
    if horizontal is None:
        horizontal = (x1 - x0) >= (y1 - y0)
    lw = lw or max(1, int(s * 0.075))
    draw.rounded_rectangle([x0, y0, x1, y1], radius=int(s * 0.19),
                           outline=PALETTE[tone], width=lw,
                           fill=rgba(tone, fill_alpha))
    gap = int(s * 0.12)
    if horizontal:
        mid = (x0 + x1) // 2
        draw.line([(mid, y0 + gap), (mid, y1 - gap)], fill=PALETTE[tone], width=lw)
        centres = [((x0 + mid) // 2, (y0 + y1) // 2), ((mid + x1) // 2, (y0 + y1) // 2)]
    else:
        mid = (y0 + y1) // 2
        draw.line([(x0 + gap, mid), (x1 - gap, mid)], fill=PALETTE[tone], width=lw)
        centres = [((x0 + x1) // 2, (y0 + mid) // 2), ((x0 + x1) // 2, (mid + y1) // 2)]
    r = max(1, int(s * 0.115))
    for i, (cx, cy) in enumerate(centres):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PALETTE[tone])
        if i == 1:  # 第二枚多点一下，像手画的
            r2 = max(1, int(r * 0.5))
            draw.ellipse([cx - r * 1.9 + r2, cy - r * 1.9 + r2, cx - r * 1.9 + r2 * 3, cy - r * 1.9 + r2 * 3],
                         fill=PALETTE[tone])
    return centres


def ink_square(draw, box, tone='accent', radius_ratio=0.16):
    """▦ 品牌标记里的那枚实色墨块。"""
    x0, y0, x1, y1 = box
    s = min(x1 - x0, y1 - y0)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=int(s * radius_ratio), fill=PALETTE[tone])


def paper_grid_3x3(d, big, inset_ratio=0.13):
    """图标底座：一张 3×3 的方格纸，外圈两条粗线钉边。返回 (step, cell(cx,cy))。"""
    inset = int(big * inset_ratio)
    step = (big - inset * 2) / 3.0
    for i in range(4):
        bold = i in (0, 3)
        col = PALETTE['rule_bold' if bold else 'rule']
        w = max(2, int(big * (0.012 if bold else 0.006)))
        p = inset + int(round(i * step))
        d.line([(p, inset), (p, big - inset)], fill=col, width=w)
        d.line([(inset, p), (big - inset, p)], fill=col, width=w)
    pad = step * 0.17

    def cell(cx, cy):
        return [inset + cx * step + pad, inset + cy * step + pad,
                inset + (cx + 1) * step - pad, inset + (cy + 1) * step - pad]

    return step, cell


def mark_composition(d, big, cell, step):
    """品牌标记：三枚墨块 + 一枚空格 + 一块骨牌，走左上到右下的对角线。"""
    ink_square(d, cell(0, 0))
    ink_square(d, cell(1, 0))
    ink_square(d, cell(0, 1))
    x0, y0, x1, y1 = cell(1, 1)
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(step * 0.16),
                        outline=PALETTE['rule_bold'], width=max(2, int(big * 0.009)))
    bx0, by0, _bx1, _by1 = cell(1, 2)
    _cx0, _cy0, cx1, cy1 = cell(2, 2)
    stamp_dominos(d, [bx0, by0, cx1, cy1], tone='warn', fill_alpha=52)


def make_icon(size):
    """应用图标：圆角纸片 + 3×3 格 + ▦ 墨块 + 一枚朱红骨牌。"""
    big = size * 4 if size < 256 else size  # 4x 画再缩，边缘不发抖
    img = paper_plate(big, 'paper', grain_seed=11 + size)
    d = ImageDraw.Draw(img)
    step, cell = paper_grid_3x3(d, big)
    mark_composition(d, big, cell, step)
    m = rounded_mask(big, int(big * 0.225))
    img = img.convert('RGBA')
    img.putalpha(m)
    d = ImageDraw.Draw(img)
    # 外框：把纸片钉在桌面上一样的细边
    d.rounded_rectangle([int(big * .012), int(big * .012), big - int(big * .012) - 1, big - int(big * .012) - 1],
                        radius=int(big * 0.225), outline=rgba('rule_bold', 210),
                        width=max(1, int(big * 0.012)))
    if big != size:
        img = img.resize((size, size), Image.LANCZOS)
    return img


def make_maskable(size=512):
    """maskable：同一套构图收进中央 80% 安全区，四周铺满纸色（圆形遮罩切不到笔画）。"""
    img = paper_plate(size, 'paper', grain_seed=99)
    d = ImageDraw.Draw(img)
    step, cell = paper_grid_3x3(d, size, inset_ratio=0.24)
    mark_composition(d, size, cell, step)
    return img.convert('RGBA')


def make_paper_texture(size=512):
    """棋盘纸纹：可平铺（噪声按环面取模，接缝看不出来），画布用 pattern 叠在纸卡上。"""
    img = paper_plate(size, 'card', grain_seed=3, strength=12)
    rnd = random.Random(5)
    px = img.load()
    for _ in range(int(size * size / 900)):  # 几根长纤维，绕边取模保证可平铺
        x, y = rnd.randrange(size), rnd.randrange(size)
        ln, ang = rnd.randrange(12, 46), rnd.uniform(0, math.pi)
        for i in range(ln):
            xx = int(x + i * math.cos(ang)) % size
            yy = int(y + i * math.sin(ang)) % size
            c = px[xx, yy]
            px[xx, yy] = tuple(max(0, v - 6) for v in c)
    return img.convert('RGBA')


def make_grain_tile(size=256):
    img = paper_plate(size, 'paper', grain_seed=21, strength=7)
    return img.convert('RGBA')


# ── 玩法 sprite：十一种题头，一格的语汇各画一小块真题面 ──────────────────────

def mini_board(draw, box, n=3, color='rule_bold'):
    x0, y0, x1, y1 = box
    for i in range(n + 1):
        fx = x0 + (x1 - x0) * i / float(n)
        fy = y0 + (y1 - y0) * i / float(n)
        draw.line([(fx, y0), (fx, y1)], fill=PALETTE[color], width=draw_width(draw))
        draw.line([(x0, fy), (x1, fy)], fill=PALETTE[color], width=draw_width(draw))


_W = 2


def draw_width(draw=None):
    return _W


def kind_tile(img, idx, kind, S):
    """每格 S×S，画该玩法最小可辨识的一角题面。"""
    global _W
    _W = max(2, int(S * 0.028))
    d = ImageDraw.Draw(img)
    x0 = idx * S
    box = [x0 + S * .14, S * .16, x0 + S * .86, S * .84]
    paper_rect = [x0 + S * .06, S * .06, x0 + S * .94, S * .94]
    d.rounded_rectangle(paper_rect, radius=int(S * .14), fill=PALETTE['card'],
                        outline=PALETTE['rule'], width=max(1, int(S * .012)))
    tone = PALETTE['accent']
    ink = PALETTE['ink']
    cell = (box[2] - box[0]) / 3.0

    def cell_rect(cx, cy, fill):
        d.rectangle([box[0] + cx * cell + 1, box[1] + cy * cell + 1,
                     box[0] + (cx + 1) * cell - 1, box[1] + (cy + 1) * cell - 1], fill=fill)

    if kind == 'nonogram':
        mini_board(d, box, 3)
        for cx, cy in [(0, 0), (1, 0), (1, 1), (2, 2)]:
            cell_rect(cx, cy, ink)
        f = font(FONT_CANDIDATES, int(S * .13))
        d.text((box[0] + cell * 1.5, box[1] - S * .1), '2 1', font=f, fill=PALETTE['ink_soft'], anchor='mm')
    elif kind == 'numberlink':
        mini_board(d, box, 3, 'rule')
        pts = [(box[0] + cell * .5, box[1] + cell * .5), (box[2] - cell * .5, box[1] + cell * 1.5)]
        d.line([pts[0], (box[0] + cell * .5, box[1] + cell * 2.5),
                (box[2] - cell * .5, box[1] + cell * 2.5), pts[1]],
               fill=tone, width=int(S * .075), joint='curve')
        for (cx, cy), col in zip(pts, [tone, PALETTE['warn']]):
            r = S * .075
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    elif kind == 'lightsout':
        mini_board(d, box, 3, 'rule')
        cell_rect(1, 1, rgba('gold', 235))
        r = cell * .26
        cx, cy = box[0] + cell * 1.5, box[1] + cell * 1.5
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PALETTE['gold'])
        for a in range(0, 360, 60):
            d.line([cx + math.cos(math.radians(a)) * r * 1.15, cy + math.sin(math.radians(a)) * r * 1.15,
                    cx + math.cos(math.radians(a)) * r * 1.6, cy + math.sin(math.radians(a)) * r * 1.6],
                   fill=PALETTE['gold'], width=_W)
        for cx, cy in [(0, 2), (2, 0)]:
            cell_rect(cx, cy, rgba('ink', 26))
    elif kind == 'pegsolitaire':
        mini_board(d, box, 3, 'rule')
        for cx, cy in [(0, 0), (1, 0), (0, 1), (2, 2), (1, 2)]:
            ccx, ccy = box[0] + (cx + .5) * cell, box[1] + (cy + .5) * cell
            r = cell * .3
            d.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=PALETTE['ink_soft'])
            d.ellipse([ccx - r * .55, ccy - r * .6, ccx + r * .2, ccy - r * .1], fill=rgba('card', 200))
    elif kind == 'nurikabe':
        mini_board(d, box, 3, 'rule')
        d.rounded_rectangle([box[0] + cell * .1, box[1] + cell * 1.1, box[0] + cell * 2.9, box[1] + cell * 2.9],
                            radius=int(cell * .3), fill=ink)
        f = font(MONO_CANDIDATES, int(S * .15))
        d.text((box[0] + cell * 2.5, box[1] + cell * .5), '3', font=f, fill=ink, anchor='mm')
        for cx, cy in [(0, 0), (2, 0)]:
            d.ellipse([box[0] + (cx + .5) * cell - 2, box[1] + (cy + .5) * cell - 2,
                       box[0] + (cx + .5) * cell + 2, box[1] + (cy + .5) * cell + 2], fill=PALETTE['ink_faint'])
    elif kind == 'tents':
        mini_board(d, box, 3, 'rule')
        cx, cy = box[0] + cell * .5, box[1] + cell * .5
        d.polygon([(cx, cy - cell * .3), (cx - cell * .3, cy + cell * .28), (cx + cell * .3, cy + cell * .28)],
                  fill=tone)
        tx, ty = box[0] + cell * 2.5, box[1] + cell * 1.5
        d.line([(tx, ty + cell * .3), (tx, ty - cell * .05)], fill=PALETTE['warn'], width=_W + 1)
        d.ellipse([tx - cell * .26, ty - cell * .34, tx + cell * .26, ty - cell * .02], fill=PALETTE['warn'])
    elif kind == 'akabane':
        mini_board(d, box, 4, 'rule')
        c2 = (box[2] - box[0]) / 4.0
        for cx, cy in [(0, 0), (1, 0), (0, 1)]:
            d.rectangle([box[0] + cx * c2 + 1, box[1] + cy * c2 + 1, box[0] + (cx + 1) * c2 - 1,
                         box[1] + (cy + 1) * c2 - 1], fill=ink)
        f = font(MONO_CANDIDATES, int(S * .14))
        d.text((box[0] + c2 * 3.5, box[1] + c2 * .5), '2', font=f, fill=ink, anchor='mm')
    elif kind == 'hitori':
        mini_board(d, box, 3, 'rule')
        f = font(MONO_CANDIDATES, int(S * .14))
        for i, (cx, cy) in enumerate([(0, 0), (1, 1), (2, 2), (0, 2)]):
            ccx, ccy = box[0] + (cx + .5) * cell, box[1] + (cy + .5) * cell
            if i == 1:
                d.rectangle([ccx - cell * .42, ccy - cell * .42, ccx + cell * .42, ccy + cell * .42], fill=ink)
            else:
                d.text((ccx, ccy), '2', font=f, fill=ink, anchor='mm')
        cx, cy = box[0] + cell * 2.5, box[1] + cell * .5
        d.ellipse([cx - cell * .34, cy - cell * .34, cx + cell * .34, cy + cell * .34], outline=tone, width=_W)
    elif kind == 'slant':
        mini_board(d, box, 3, 'rule')
        for cx, cy, up in [(0, 0, 1), (1, 0, 0), (2, 1, 1), (0, 2, 0), (1, 2, 1)]:
            x0, y0 = box[0] + cx * cell, box[1] + cy * cell
            if up:
                d.line([(x0 + 2, y0 + cell - 2), (x0 + cell - 2, y0 + 2)], fill=ink, width=_W + 1)
            else:
                d.line([(x0 + 2, y0 + 2), (x0 + cell - 2, y0 + cell - 2)], fill=ink, width=_W + 1)
    elif kind == 'shikaku':
        d.rectangle([box[0], box[1], box[0] + cell * 2, box[1] + cell * 2], outline=ink, width=_W + 2)
        d.rectangle([box[0] + cell * 2, box[1], box[2], box[1] + cell], outline=ink, width=_W + 2)
        d.rectangle([box[0] + cell * 2, box[1] + cell, box[2], box[3]], outline=ink, width=_W + 2)
        d.rectangle([box[0], box[1] + cell * 2, box[0] + cell * 2, box[3]], outline=ink, width=_W + 2)
        f = font(MONO_CANDIDATES, int(S * .14))
        d.text((box[0] + cell, box[1] + cell), '4', font=f, fill=ink, anchor='mm')
        d.text((box[0] + cell * 2.5, box[1] + cell * .5), '2', font=f, fill=ink, anchor='mm')
    elif kind == 'dominosa':
        stamp_dominos(d, [box[0] + 2, box[1] + 2, box[0] + cell * 2 - 2, box[1] + cell - 2], tone='accent')
        stamp_dominos(d, [box[0] + 2, box[1] + cell + 2, box[0] + cell - 2, box[1] + cell * 3 - 2],
                      tone='warn')
        stamp_dominos(d, [box[0] + cell * 2 + 2, box[1] + cell + 2, box[2] - 2, box[1] + cell * 3 - 2],
                      tone='ink_soft')
    return img


def make_glyph_atlas(S=120):
    kinds = ['nonogram', 'numberlink', 'lightsout', 'pegsolitaire', 'nurikabe', 'tents',
             'akabane', 'hitori', 'slant', 'shikaku', 'dominosa']
    img = Image.new('RGBA', (S * len(kinds), S), (0, 0, 0, 0))
    for i, k in enumerate(kinds):
        tile = paper_plate(S, 'paper', grain_seed=40 + i).convert('RGBA')
        kind_tile(tile, 0, k, S)
        img.alpha_composite(tile, (i * S, 0))
    return img, kinds


def make_stamp_sprite(S=128):
    """结算印章三态：合上 / 盖章 / 褪色。canvas 直接 drawImage 到棋盘上。"""
    atlas = Image.new('RGBA', (S * 3, S), (0, 0, 0, 0))
    for i, (scale, alpha) in enumerate([(0.72, 120), (1.0, 255), (1.0, 90)]):
        tile = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        r = S * .40 * scale
        cx = cy = S / 2.0
        col = rgba('warn', alpha)
        # 印章边：双层圆环 + 缺口，像橡胶垫印歪了一下
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=max(2, int(S * .045)))
        d.ellipse([cx - r * .82, cy - r * .82, cx + r * .82, cy + r * .82], outline=col, width=max(1, int(S * .018)))
        f = font(FONT_CANDIDATES, int(S * .40 * scale))
        d.text((cx, cy + S * .01), '解', font=f, fill=col, anchor='mm')
        atlas.alpha_composite(tile, (i * S, 0))
    return atlas


# ── 社交卡 ───────────────────────────────────────────────────────────────────

def make_og():
    W, H = 1200, 630
    img = Image.new('RGBA', (W, H), PALETTE['paper'])
    tile = make_paper_texture(512)
    for ty in range(0, H, 512):
        for tx in range(0, W, 512):
            img.alpha_composite(tile, (tx, ty))
    d = ImageDraw.Draw(img)
    # 右侧一张 5×5 真题面，左侧留白写字
    board = [W - 470, 130, W - 130, 470]
    d.rounded_rectangle([board[0] - 26, board[1] - 26, board[2] + 26, board[3] + 26], radius=26,
                        fill=PALETTE['card'], outline=PALETTE['rule'], width=3)
    cell = (board[2] - board[0]) / 5.0
    for i in range(6):
        w = 4 if i in (0, 5) else 2
        d.line([(board[0] + i * cell, board[1]), (board[0] + i * cell, board[3])],
               fill=PALETTE['rule_bold' if i in (0, 5) else 'rule'], width=w)
        d.line([(board[0], board[1] + i * cell), (board[2], board[1] + i * cell)],
               fill=PALETTE['rule_bold' if i in (0, 5) else 'rule'], width=w)
    for cx, cy in [(0, 0), (1, 0), (2, 1), (3, 1), (1, 2), (0, 3), (2, 3), (3, 3)]:
        d.rectangle([board[0] + cx * cell + 3, board[1] + cy * cell + 3,
                     board[0] + (cx + 1) * cell - 3, board[1] + (cy + 1) * cell - 3], fill=PALETTE['ink'])
    stamp_dominos(d, [board[0] + cell * 3.14, board[1] + cell * 4.16,
                      board[0] + cell * 4.86, board[1] + cell * 4.84], tone='accent', fill_alpha=40)
    # 文案
    f_big = font(FONT_CANDIDATES, 118)
    f_mid = font(FONT_CANDIDATES, 40)
    f_sm = font(MONO_CANDIDATES, 26)
    d.text((86, 150), '纸上逻辑', font=f_big, fill=PALETTE['ink'])
    d.text((90, 292), 'NIKOLI', font=f_sm, fill=PALETTE['rule_bold'])
    d.line([(90, 340), (90 + 250, 340)], fill=PALETTE['accent'], width=5)
    d.text((88, 372), '十一种纸笔推理谜题', font=f_mid, fill=PALETTE['ink_soft'])
    d.text((90, 438), '唯一解生成器出题 · 提示来自真求解器', font=font(FONT_CANDIDATES, 26),
           fill=PALETTE['ink_faint'])
    x = 90
    for i, k in enumerate(['nonogram', 'numberlink', 'lightsout', 'dominosa', 'shikaku', 'hitori']):
        d.rectangle([x, 500, x + 44, 544], outline=PALETTE['rule'], width=2)
        mini = Image.new('RGBA', (44, 44), (0, 0, 0, 0))
        kind_tile(mini, 0, k, 44)
        img.alpha_composite(mini, (x, 500))
        x += 52
    d = ImageDraw.Draw(img)
    out = Image.new('RGB', (W, H), PALETTE['paper'])
    out.paste(img, (0, 0), img)
    return out


def write(img, rel, optimize=True):
    path = os.path.join(REPO, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=optimize)
    print('%-46s %5dx%-5d %7d B' % (rel, img.width, img.height, os.path.getsize(path)))
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=None, choices=['icons', 'textures', 'sprites', 'og'])
    args = ap.parse_args()
    want = lambda g: args.only in (None, g)

    if want('icons'):
        for s in (16, 32, 48, 64, 96, 180, 192, 512, 1024):
            write(make_icon(s), 'assets/icons/icon-%d.png' % s)
        write(make_maskable(512), 'assets/icons/maskable-512.png')
    if want('textures'):
        write(make_paper_texture(512), 'assets/textures/paper-512.png')
        write(make_grain_tile(256), 'assets/textures/grain-256.png')
    if want('sprites'):
        atlas, kinds = make_glyph_atlas(120)
        write(atlas, 'assets/sprites/glyphs.png')
        write(make_stamp_sprite(128), 'assets/sprites/stamp.png')
        lines = ['# 由 assets/gen/make_art.py 生成，勿手改。', '# 横向 atlas：每格 120px，第 i 格对应下面第 i 个玩法 id。']
        lines += kinds
        open(os.path.join(REPO, 'assets/sprites/glyphs.txt'), 'w').write('\n'.join(lines) + '\n')
    if want('og'):
        write(make_og(), 'assets/brand/og-cover.png')


if __name__ == '__main__':
    main()
