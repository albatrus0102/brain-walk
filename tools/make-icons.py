#!/usr/bin/env python3
"""앱 아이콘 생성기 (Pillow). 실행: python3 tools/make-icons.py
M3 기본색 #386A20 위에 흰 잎사귀(두뇌 산책의 '길' = 잎맥) 모양을 그려요.
만들어지는 파일: icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon-180.png, badge-72.png, icon.svg"""
import math, os
from PIL import Image, ImageDraw

PRIMARY = (0x38, 0x6A, 0x20)
LIGHT = (0xB7, 0xF3, 0x97)
WHITE = (255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
S = 2048  # 4배 확대해서 그린 뒤 줄여요 (부드러운 가장자리)

def bez(p0, p1, p2, p3, n=80):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out

def leaf_points(cx, cy, size, ang):
    """뾰족한 잎사귀 윤곽 (위쪽 끝이 뾰족, 아래쪽이 줄기). ang(도)만큼 회전."""
    h = size; w = size * 0.62
    top = (0, -h/2); bot = (0, h/2)
    right = bez(bot, (w*1.05, h*0.25), (w*0.95, -h*0.25), top)
    left = bez(top, (-w*0.95, -h*0.25), (-w*1.05, h*0.25), bot)
    pts = right + left
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    return [(cx + x*ca - y*sa, cy + x*sa + y*ca) for x, y in pts], (cx, cy, ca, sa, h, w)

def draw_mark(d, cx, cy, size, fg, bg, ang=35):
    pts, (cx, cy, ca, sa, h, w) = leaf_points(cx, cy, size, ang)
    d.polygon(pts, fill=fg)
    rot = lambda x, y: (cx + x*ca - y*sa, cy + x*sa + y*ca)
    lw = int(size * 0.045)
    # 가운데 잎맥 + 갈래 잎맥 (갈래 = 생각이 뻗어 가는 길)
    d.line([rot(0, h*0.52), rot(0, -h*0.32)], fill=bg, width=lw)
    for k, (yy, dx) in enumerate([(0.20, 0.30), (0.02, 0.27), (-0.16, 0.2)]):
        for sgn in (-1, 1):
            d.line([rot(0, h*yy), rot(sgn*w*dx*1.6, h*(yy-0.17))], fill=bg, width=lw)
    # 줄기
    d.line([rot(0, h*0.5), rot(-h*0.03, h*0.66)], fill=fg, width=lw)

def canvas(bg_round, scale_mark, bg=PRIMARY, fg=WHITE, vein=PRIMARY):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg_round: d.rounded_rectangle([0, 0, S-1, S-1], radius=int(S*0.22), fill=bg)
    else: d.rectangle([0, 0, S, S], fill=bg)
    draw_mark(d, S*0.5, S*0.5, S*scale_mark, fg, vein)
    return im

def save(im, name, px):
    im.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

os.makedirs(OUT, exist_ok=True)
any_icon = canvas(True, 0.62)
save(any_icon, 'icon-192.png', 192); save(any_icon, 'icon-512.png', 512)
save(canvas(False, 0.46), 'maskable-512.png', 512)          # 안전 영역(가운데 80%) 안에 들어가게 작게
save(canvas(False, 0.58), 'apple-touch-icon-180.png', 180)   # iOS 가 모서리를 직접 둥글게 해요
# 알림 배지: 투명 바탕 + 흰 모양 (단색)
b = Image.new('RGBA', (S, S), (0, 0, 0, 0)); bd = ImageDraw.Draw(b)
pts, _ = leaf_points(S*0.5, S*0.5, S*0.78, 35); bd.polygon(pts, fill=WHITE)
save(b, 'badge-72.png', 72)
open(os.path.join(OUT, 'icon.svg'), 'w').write('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#386A20"/><g transform="translate(256 256) rotate(35)"><path d="M0 -158 C -100 -80 -108 70 0 158 C 108 70 100 -80 0 -158 Z" fill="#fff"/><path d="M0 130 V -100 M0 60 L-50 20 M0 60 L50 20 M0 10 L-46 -28 M0 10 L46 -28 M0 -40 L-34 -66 M0 -40 L34 -66" stroke="#386A20" stroke-width="14" stroke-linecap="round" fill="none"/></g></svg>''')
print('icons ok')
