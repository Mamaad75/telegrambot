# -*- coding: utf-8 -*-
"""ساخت آیکون برنامه (PNG و ICO) — دفتر حساب با نماد ریال/سکه"""
from PIL import Image, ImageDraw
import os

SIZE = 1024
BG_TOP = (27, 74, 122)      # آبی سرمه‌ای
BG_BOT = (16, 36, 58)
PAPER = (248, 250, 252)
LINE = (203, 214, 226)
ACCENT = (13, 127, 109)     # سبز حسابداری
GOLD = (214, 158, 46)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# پس‌زمینه گرد با گرادیان عمودی
radius = int(SIZE * 0.22)
grad = Image.new("RGBA", (SIZE, SIZE))
gd = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / SIZE
    color = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (SIZE, y)], fill=color)
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# برگه فاکتور
px0, py0, px1, py1 = int(SIZE*0.22), int(SIZE*0.17), int(SIZE*0.70), int(SIZE*0.83)
d.rounded_rectangle([px0, py0, px1, py1], radius=int(SIZE*0.035), fill=PAPER)
# نوار عنوان برگه
d.rounded_rectangle([px0, py0, px1, py0 + int(SIZE*0.10)], radius=int(SIZE*0.035), fill=(31, 59, 87))
d.rectangle([px0, py0 + int(SIZE*0.06), px1, py0 + int(SIZE*0.10)], fill=(31, 59, 87))

# خطوط جدول
top = py0 + int(SIZE*0.155)
row_h = int(SIZE*0.075)
for i in range(5):
    y = top + i * row_h
    w = int((px1 - px0) * (0.72 if i % 2 == 0 else 0.55))
    d.rounded_rectangle([px0 + int(SIZE*0.045), y, px0 + int(SIZE*0.045) + w, y + int(SIZE*0.028)],
                        radius=int(SIZE*0.014), fill=LINE)
    d.rounded_rectangle([px1 - int(SIZE*0.16), y, px1 - int(SIZE*0.05), y + int(SIZE*0.028)],
                        radius=int(SIZE*0.014), fill=(226, 232, 240))

# نمودار رشد روی برگه
chart = [(px0 + int(SIZE*0.06), py1 - int(SIZE*0.09)),
         (px0 + int(SIZE*0.15), py1 - int(SIZE*0.14)),
         (px0 + int(SIZE*0.24), py1 - int(SIZE*0.11)),
         (px0 + int(SIZE*0.36), py1 - int(SIZE*0.21))]
d.line(chart, fill=ACCENT, width=int(SIZE*0.018), joint="curve")
for pt in chart:
    d.ellipse([pt[0]-int(SIZE*0.014), pt[1]-int(SIZE*0.014), pt[0]+int(SIZE*0.014), pt[1]+int(SIZE*0.014)],
              fill=ACCENT)

# سکه طلایی با نماد ریال ساده‌شده
cx, cy, cr = int(SIZE*0.72), int(SIZE*0.72), int(SIZE*0.185)
d.ellipse([cx-cr-int(SIZE*0.012), cy-cr-int(SIZE*0.012), cx+cr+int(SIZE*0.012), cy+cr+int(SIZE*0.012)],
          fill=(255, 255, 255))
d.ellipse([cx-cr, cy-cr, cx+cr, cy+cr], fill=GOLD)
d.ellipse([cx-cr+int(SIZE*0.022), cy-cr+int(SIZE*0.022), cx+cr-int(SIZE*0.022), cy+cr-int(SIZE*0.022)],
          outline=(255, 236, 190), width=int(SIZE*0.010))
# علامت جمع/تراز داخل سکه (دو کفه ترازو ساده)
bw = int(SIZE*0.012)
d.line([(cx - int(SIZE*0.075), cy - int(SIZE*0.03)), (cx + int(SIZE*0.075), cy - int(SIZE*0.03))],
       fill=(120, 78, 12), width=bw)
d.line([(cx, cy - int(SIZE*0.075)), (cx, cy + int(SIZE*0.055))], fill=(120, 78, 12), width=bw)
d.arc([cx - int(SIZE*0.085), cy - int(SIZE*0.055), cx - int(SIZE*0.025), cy + int(SIZE*0.01)], 0, 180,
      fill=(120, 78, 12), width=bw)
d.arc([cx + int(SIZE*0.025), cy - int(SIZE*0.055), cx + int(SIZE*0.085), cy + int(SIZE*0.01)], 0, 180,
      fill=(120, 78, 12), width=bw)
d.line([(cx - int(SIZE*0.045), cy + int(SIZE*0.055)), (cx + int(SIZE*0.045), cy + int(SIZE*0.055))],
       fill=(120, 78, 12), width=bw)

out_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(out_dir, exist_ok=True)
png = os.path.join(out_dir, 'icon.png')
img.save(png)

# ICO چندسایزی برای ویندوز
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
img.save(os.path.join(out_dir, 'icon.ico'), format='ICO',
         sizes=[(s, s) for s in ico_sizes])

# تصویر نصب‌کننده (بنر کناری NSIS: 164×314)
side = Image.new("RGB", (164, 314), (16, 36, 58))
sd = ImageDraw.Draw(side)
for y in range(314):
    t = y / 314
    sd.line([(0, y), (164, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i]-BG_TOP[i]) * t) for i in range(3)))
logo = img.resize((120, 120), Image.LANCZOS)
side.paste(logo, (22, 60), logo)
side.save(os.path.join(out_dir, 'installerSidebar.bmp'), format='BMP')

# هدر نصب‌کننده 150×57
head = Image.new("RGB", (150, 57), (16, 36, 58))
logo2 = img.resize((44, 44), Image.LANCZOS)
head.paste(logo2, (100, 6), logo2)
head.save(os.path.join(out_dir, 'installerHeader.bmp'), format='BMP')

print('icon.png, icon.ico, installerSidebar.bmp, installerHeader.bmp ساخته شدند')
