"""Generate a FAKE sample electrical plan set (2 sheets) + a fake field photo.
Clearly marked SAMPLE - NOT FOR CONSTRUCTION. Output: ../sample/"""
import os
from reportlab.lib.pagesizes import landscape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random

OUT = os.path.join(os.path.dirname(__file__), "..", "sample")
os.makedirs(OUT, exist_ok=True)
W, H = 1224, 792  # 17x11 (ANSI B) landscape, points

ROOMS = [  # name, number, x, y, w, h
    ("OFFICE", "101", 80, 430, 260, 230),
    ("CONFERENCE", "102", 340, 430, 300, 230),
    ("OPEN OFFICE", "103", 640, 430, 300, 230),
    ("ELEC ROOM", "104", 80, 200, 180, 230),
    ("STORAGE", "105", 260, 200, 180, 230),
    ("BREAK ROOM", "106", 440, 200, 250, 230),
    ("CORRIDOR", "107", 690, 200, 250, 230),
]

def grid(c):
    c.setLineWidth(0.4); c.setDash([8, 3, 2, 3]); c.setStrokeColor(colors.grey)
    xs = [80, 340, 640, 940]; ys = [200, 430, 660]
    for i, x in enumerate(xs):
        c.line(x, 170, x, 700)
    for y in ys:
        c.line(60, y, 960, y)
    c.setDash()
    c.setStrokeColor(colors.black)
    for i, x in enumerate(xs):
        c.circle(x, 715, 11); c.setFont("Helvetica-Bold", 10); c.drawCentredString(x, 711, "ABCD"[i])
    for j, y in enumerate(ys):
        c.circle(45, y, 11); c.setFont("Helvetica-Bold", 10); c.drawCentredString(45, y - 4, str(3 - j))

def rooms(c):
    c.setLineWidth(3); c.setStrokeColor(colors.black)
    for name, num, x, y, w, h in ROOMS:
        c.rect(x, y, w, h)
        c.setFont("Helvetica-Bold", 9); c.drawCentredString(x + w / 2, y + h / 2 + 4, name)
        c.setFont("Helvetica", 9); c.drawCentredString(x + w / 2, y + h / 2 - 8, num)
    # door gaps
    c.setStrokeColor(colors.white); c.setLineWidth(4)
    for x in (160, 470, 780):
        c.line(x, 430, x + 30, 430)
    c.setStrokeColor(colors.black)

def title_block(c, num, title):
    c.setLineWidth(1.5); c.rect(20, 20, W - 40, H - 40)
    c.rect(990, 20, 214, H - 40)
    c.setFont("Helvetica-Bold", 11); c.drawString(1000, 740, "SAMPLE ENGINEERING CO.")
    c.setFont("Helvetica", 8); c.drawString(1000, 726, "(fictional - demo only)")
    c.setFont("Helvetica-Bold", 10); c.drawString(1000, 690, "PROJECT:"); c.setFont("Helvetica", 10)
    c.drawString(1000, 676, "Sample Tenant Fit-Out"); c.drawString(1000, 662, "123 Example St, Anytown")
    c.setFillColor(colors.red); c.setFont("Helvetica-Bold", 12)
    c.drawString(1000, 600, "SAMPLE DRAWING"); c.drawString(1000, 584, "NOT FOR CONSTRUCTION")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8); c.drawString(1000, 140, "DATE: 2026-11-09   SCALE: 1/8\" = 1'-0\"")
    c.setFont("Helvetica-Bold", 12); c.drawString(1000, 110, title)
    c.setFont("Helvetica-Bold", 30); c.drawString(1000, 50, num)
    c.setFont("Helvetica", 8); c.drawString(1000, 90, "SHEET NUMBER:")

def recept(c, x, y, ckt):
    c.setLineWidth(1); c.circle(x, y, 6); c.line(x - 4, y - 2, x - 4, y + 2); c.line(x + 4, y - 2, x + 4, y + 2)
    c.setFont("Helvetica", 6); c.drawString(x + 8, y - 2, ckt)

def power(c):
    title_block(c, "E-101", "FIRST FLOOR POWER PLAN")
    grid(c); rooms(c)
    # Panel LP-1 in elec room
    c.setFillColor(colors.black); c.rect(90, 330, 14, 60, fill=1)
    c.setFont("Helvetica-Bold", 8); c.drawString(110, 365, "PANEL LP-1"); c.setFont("Helvetica", 7); c.drawString(110, 355, "208Y/120V 225A")
    c.rect(90, 240, 14, 50, fill=1); c.setFont("Helvetica-Bold", 8); c.drawString(110, 265, "PANEL HP-1")
    # Transformer
    c.rect(170, 215, 50, 30); c.setFont("Helvetica", 7); c.drawString(172, 228, "XFMR T-1")
    for (x, y, k) in [(100, 600, "LP-1/1"), (300, 600, "LP-1/1"), (380, 640, "LP-1/3"), (600, 640, "LP-1/3"),
                      (680, 640, "LP-1/5"), (900, 640, "LP-1/5"), (700, 450, "LP-1/7"), (900, 450, "LP-1/7"),
                      (300, 220, "LP-1/9"), (460, 400, "LP-1/11"), (640, 400, "LP-1/11"), (560, 220, "LP-1/13")]:
        recept(c, x, y, k)
    # J-box + floor box
    c.rect(560, 590, 12, 12); c.setFont("Helvetica", 7); c.drawString(575, 593, "FLOOR BOX FB-1")
    c.rect(780, 300, 10, 10); c.drawString(793, 302, "J-BOX J-3 (EWC)")
    c.setFont("Helvetica-Bold", 8); c.drawString(80, 150, "GENERAL NOTES:")
    c.setFont("Helvetica", 7)
    for i, t in enumerate(["1. ALL RECEPTACLES 18\" AFF UNLESS NOTED.", "2. HOME RUNS TO PANEL LP-1 IN ELEC ROOM 104.",
                           "3. COORDINATE FLOOR BOX FB-1 WITH FURNITURE PLAN."]):
        c.drawString(80, 138 - i * 10, t)

def lighting(c):
    title_block(c, "E-201", "FIRST FLOOR LIGHTING PLAN")
    grid(c); rooms(c)
    c.setLineWidth(0.8)
    for name, num, x, y, w, h in ROOMS:
        for i in range(2):
            for j in range(2):
                fx = x + w * (0.25 + 0.5 * i) - 20; fy = y + h * (0.25 + 0.5 * j) - 8
                c.rect(fx, fy, 40, 16); c.line(fx, fy, fx + 40, fy + 16)
        c.setFont("Helvetica", 6); c.drawString(x + 6, y + 6, "TYPE A")
    c.setFont("Helvetica", 8); c.drawString(80, 150, "LIGHTING CONTROL: OCC SENSOR IN EACH ROOM. EMERGENCY FIXTURES ON CKT LP-1/20.")

pdf = canvas.Canvas(os.path.join(OUT, "sample-electrical-plan-E101-E201.pdf"), pagesize=(W, H))
pdf.setTitle("SAMPLE electrical plans (fake) - Field As-Built demo"); pdf.setAuthor("Field As-Built demo generator")
power(pdf); pdf.showPage(); lighting(pdf); pdf.showPage(); pdf.save()

# Fake "field photo": stylized electrical room wall with a panel, labeled SAMPLE
random.seed(4)
img = Image.new("RGB", (1200, 900), (188, 184, 172))
d = ImageDraw.Draw(img)
for _ in range(6000):  # concrete texture
    x, y = random.randrange(1200), random.randrange(900); v = random.randint(150, 205); d.point((x, y), (v, v - 3, v - 10))
d.rectangle([0, 760, 1200, 900], fill=(120, 118, 112))
d.rectangle([430, 180, 690, 700], fill=(150, 152, 156), outline=(60, 60, 60), width=6)  # panel can
d.rectangle([450, 200, 670, 680], outline=(90, 90, 90), width=3)
for k in range(12):
    d.rectangle([500, 240 + k * 34, 620, 262 + k * 34], fill=(40, 40, 40))
for xx in (480, 540, 600, 640):  # conduits up
    d.rectangle([xx, 0, xx + 18, 180], fill=(170, 170, 175), outline=(90, 90, 90))
try:
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
    fs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
except Exception:
    f = fs = ImageFont.load_default()
d.rectangle([470, 110, 650, 160], fill=(250, 250, 250)); d.text((488, 115), "LP-1", fill=(0, 0, 0), font=f)
d.rectangle([60, 300, 330, 360], fill=(255, 255, 255)); d.text((72, 312), "ELEC RM 104", fill=(0, 0, 0), font=fs)
d.line([(380, 760), (380, 700)], fill=(255, 140, 0), width=4); d.text((150, 790), "~3'-0\" from orig. location", fill=(255, 255, 255), font=fs)
img = img.filter(ImageFilter.GaussianBlur(0.8))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 1200, 44], fill=(200, 0, 0)); d.text((14, 6), "SAMPLE FIELD PHOTO (synthetic) - Field As-Built demo", fill=(255, 255, 255), font=fs)
img.save(os.path.join(OUT, "sample-field-photo-LP1.jpg"), quality=85)
print("ok")
