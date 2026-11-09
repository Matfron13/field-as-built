"""End-to-end check of the running prototype through the real UI (headless Chrome):
reset -> load sample set -> pick E-101 -> sample photo + note -> Suggest placement -> drag -> Confirm
-> (plus a stub-mode capture via API that gets rejected) -> Export PDF -> verify annotations with pypdf.
usage: python3 verify_e2e.py [base_url]"""
import sys, os, json, subprocess, time
from playwright.sync_api import sync_playwright
from check_annotations import inspect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4317"
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SHOTS = os.path.join(ROOT, "screenshots"); OUT = os.path.join(ROOT, "out"); os.makedirs(SHOTS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
ok = lambda c, m: print(("PASS " if c else "FAIL ") + m) or c
results = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
    pg.goto(BASE); pg.wait_for_selector("[data-testid=load-sample]")
    pg.request.post(f"{BASE}/api/reset"); pg.reload()
    pg.click("[data-testid=load-sample]"); pg.wait_for_selector("[data-testid=sheet-E-101]")
    pg.click("[data-testid=sheet-E-101]"); pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(SHOTS, "01-sheet-loaded.png"))
    pg.click("[data-testid=sample-photo]"); pg.wait_for_timeout(300)
    pg.fill("[data-testid=note]", "Panel LP-1 relocated 3 ft north to clear duct, conduits re-stubbed above")
    pg.click("[data-testid=suggest]")
    pg.wait_for_selector("[data-testid^=queue-]", timeout=60000); pg.wait_for_timeout(600)
    st = pg.request.get(f"{BASE}/api/state").json(); m = st["markups"][0]
    results.append(ok(m["status"] == "draft", f"suggestion created draft markup via {m['method']} (conf {m['confidence']}, anchor '{m.get('anchorText')}')"))
    pg.screenshot(path=os.path.join(SHOTS, "02-suggested-draft.png"))
    # drag the cloud 60px right, 30px down
    box = pg.locator(f"[data-testid=markup-{m['id']}] rect.hit").bounding_box()
    sx, sy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(sx, sy); pg.mouse.down(); pg.mouse.move(sx + 30, sy + 15, steps=5); pg.mouse.move(sx + 60, sy + 30, steps=5); pg.mouse.up(); pg.wait_for_timeout(600)
    m2 = next(x for x in pg.request.get(f"{BASE}/api/state").json()["markups"] if x["id"] == m["id"])
    results.append(ok(m2["cloud"]["x"] > m["cloud"]["x"] + 5 and m2["cloud"]["y"] < m["cloud"]["y"] - 2, f"drag moved cloud {m['cloud']} -> {m2['cloud']}"))
    pg.click("[data-testid=confirm]"); pg.wait_for_timeout(500)
    # second capture via API in forced stub mode, then reject it in the UI
    sheet_id = next(s["id"] for s in st["sheets"] if s["number"] == "E-101")
    with open(os.path.join(ROOT, "sample", "sample-field-photo-LP1.jpg"), "rb") as f: photo = f.read()
    r = pg.request.post(f"{BASE}/api/captures", multipart={"photo": {"name": "p.jpg", "mimeType": "image/jpeg", "buffer": photo}, "note": "J-3 for EWC moved 4 ft west in corridor 107", "sheetId": sheet_id, "mode": "stub"}).json()
    stub = r["markup"]
    results.append(ok(stub["method"].startswith("stub") and "J-3" in stub["anchorText"], f"stub placement anchored on '{stub['anchorText']}' ({stub['reasoning']})"))
    # third capture via stub, left as draft (should be excluded from export)
    r3 = pg.request.post(f"{BASE}/api/captures", multipart={"photo": {"name": "p.jpg", "mimeType": "image/jpeg", "buffer": photo}, "note": "Added duplex receptacle at floor box FB-1, LP-1/3", "sheetId": sheet_id, "mode": "stub"}).json()["markup"]
    pg.reload(); pg.wait_for_selector(f"[data-testid=queue-{stub['id']}]")
    pg.click(f"[data-testid=queue-{stub['id']}]"); pg.click("[data-testid=reject]"); pg.wait_for_timeout(500)
    pg.click(f"[data-testid=queue-{m['id']}]"); pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(SHOTS, "03-review-queue-confirmed.png"))
    with pg.expect_download() as dl: pg.click("[data-testid=export]")
    out_pdf = os.path.join(OUT, "exported-as-built.pdf"); dl.value.save_as(out_pdf)
    b.close()

anns = inspect(out_pdf)
print(json.dumps(anns, indent=1, default=str))
clouds = [a for a in anns if a["subtype"] == "/Polygon"]; callouts = [a for a in anns if a["subtype"] == "/FreeText"]
results.append(ok(len(clouds) == 1 and len(callouts) == 1, f"export has exactly the 1 confirmed markup (clouds={len(clouds)}, callouts={len(callouts)}); rejected + draft excluded"))
c = clouds[0] if clouds else {}
results.append(ok(c.get("intent") == "/PolygonCloud" and c.get("border_effect", {}).get("/S") == "/C", "cloud is /Polygon + /IT /PolygonCloud + /BE /S /C (Bluebeam cloud)"))
results.append(ok(c.get("vertices") and abs(c["vertices"][0] - m2["cloud"]["x"]) < 0.2, "cloud vertices reflect the dragged position"))
results.append(ok(callouts and callouts[0]["intent"] == "/FreeTextCallout" and callouts[0]["callout_line"] and "PANEL LP-1" in str(callouts[0]["contents"]).upper(), "callout is FreeText /FreeTextCallout with /CL leader and the note text"))
results.append(ok(all(a["has_appearance"] for a in anns), "all annotations carry /AP appearance streams"))
subprocess.run(["pdftoppm", "-r", "110", "-png", "-f", "1", "-l", "1", out_pdf, os.path.join(SHOTS, "04-exported-pdf-page1")], check=True)
print(f"\nexported: {out_pdf}\nscreenshots: {SHOTS}")
print("ALL PASS" if all(results) else "SOME CHECKS FAILED"); sys.exit(0 if all(results) else 1)
