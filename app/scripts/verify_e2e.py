"""End-to-end check of Field As-Built through the real UI (headless Chrome), as real signed-in users.
 auth gate + noindex + invite-only signup -> PE: project + sample set -> Foreman (phone viewport): sheet picker,
 capture (AI or stub per server config), offline capture queued in IndexedDB then synced -> role checks ->
 PE: drag + confirm / reject -> export full-set PDF, per-sheet PDF, markup CSV -> verify annotations + log page.
usage: python3 verify_e2e.py [base_url]   (makes at most ONE model call per run; the offline capture is forced to stub)"""
import sys, os, json, subprocess, csv, io, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from check_annotations import inspect

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4317").rstrip("/")
HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.abspath(os.path.join(HERE, "..")); ROOT = os.path.dirname(APP)
SHOTS = os.path.join(ROOT, "screenshots"); OUT = os.path.join(ROOT, "out"); os.makedirs(SHOTS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
ACC = json.load(open(os.path.join(APP, "data", "secrets", "accounts.json")))
PE = "e2e-pe@field-as-built.app"; FM = "e2e-foreman@field-as-built.app"
PHOTO = os.path.join(APP, "sample", "sample-field-photo-LP1.jpg")
PROJECT = "E2E test project"
results = []
def ok(c, m): print(("PASS " if c else "FAIL ") + m, flush=True); results.append(bool(c)); return c
def shot(pg, n): pg.screenshot(path=os.path.join(SHOTS, n))

def login(ctx, email):
    pg = ctx.new_page(); pg.goto(BASE); pg.wait_for_selector("[data-testid=login-form]")
    pg.fill("[data-testid=login-email]", email); pg.fill("[data-testid=login-password]", ACC[email]["password"]); pg.click("[data-testid=login-submit]")
    pg.wait_for_selector("[data-testid=sign-out]", timeout=20000); return pg
def token(pg): return json.loads(pg.evaluate("localStorage.getItem('fab-auth')"))["access_token"]
def H(pg): return {"Authorization": f"Bearer {token(pg)}"}

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    # ---- 1. not public
    anon = b.new_context(); pg = anon.new_page()
    resp = pg.goto(BASE); pg.wait_for_selector("[data-testid=login-form]")
    ok(pg.locator("meta[name=robots]").get_attribute("content").startswith("noindex"), "page has <meta name=robots noindex>")
    ok("noindex" in (resp.headers.get("x-robots-tag") or ""), f"X-Robots-Tag header: {resp.headers.get('x-robots-tag')}")
    shot(pg, "10-login.png")
    codes = [pg.request.get(f"{BASE}{u}").status for u in ["/api/me", "/api/config", "/api/sample/photo", "/api/projects/00000000-0000-0000-0000-000000000000/state"]]
    ok(all(c == 401 for c in codes), f"API without a session -> {codes} (all 401)")
    ok(pg.request.get(f"{BASE}/api/me", headers={"Authorization": "Bearer not-a-real-token"}).status == 401, "forged bearer token rejected")
    pub = pg.request.get(f"{BASE}/api/public-config").json()
    su = pg.request.post(f"{pub['supabaseUrl']}/auth/v1/signup", headers={"apikey": pub["supabaseKey"], "Content-Type": "application/json"}, data=json.dumps({"email": "stranger-e2e@example.com", "password": "Very-long-Passw0rd-xyz"}))
    ok(su.status >= 400, f"public signup refused (HTTP {su.status}: {su.text()[:80]})")
    pg.fill("[data-testid=login-email]", PE); pg.fill("[data-testid=login-password]", "wrong-password-123"); pg.click("[data-testid=login-submit]")
    pg.wait_for_selector("[data-testid=login-error]"); ok(True, "wrong password shows an error")
    anon.close()

    # ---- 2. PE sets up a project with the sample set
    pe_ctx = b.new_context(viewport={"width": 1500, "height": 950}, accept_downloads=True); pe = login(pe_ctx, PE)
    me = pe.request.get(f"{BASE}/api/me", headers=H(pe)).json()
    ok(any(m["role"] == "pe" for m in me["memberships"]), "PE account has role pe")
    proj = next((x for x in me["projects"] if x["name"] == PROJECT), None)
    if not proj: proj = pe.request.post(f"{BASE}/api/projects", headers=H(pe), data={"name": PROJECT}).json()
    pid = proj["id"]
    ok(pe.request.post(f"{BASE}/api/projects/{pid}/reset", headers=H(pe)).ok, "PE reset the e2e project")
    pe.reload(); pe.wait_for_selector("[data-testid=project-select]"); pe.select_option("[data-testid=project-select]", pid)
    pe.click("[data-testid=load-sample]"); pe.wait_for_function("document.querySelector('[data-testid=sheet-picker]').innerText.includes('E-')", timeout=30000)
    for _ in range(20):
        st = pe.request.get(f"{BASE}/api/projects/{pid}/state", headers=H(pe)).json()
        if len(st["sheets"]) >= 2: break
        pe.wait_for_timeout(1000)
    ok(len(st["drawings"]) == 1 and len(st["sheets"]) == 2, f"sample set added: {len(st['drawings'])} set, {len(st['sheets'])} sheets")
    ok(len(me["projects"]) >= 1, f"PE sees {len(me['projects'])} project(s) in the org")

    # ---- 3. Foreman on a phone
    fm_ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); fm = login(fm_ctx, FM)
    fm.select_option("[data-testid=project-select]", pid); fm.wait_for_timeout(800)
    ok(fm.locator("[data-testid=role]").inner_text() == "Foreman", "foreman sees role chip 'Foreman'")
    ok(fm.locator("[data-testid=load-sample]").count() == 0 and fm.locator("[data-testid=export]").count() == 0, "foreman has no drawing-upload or export controls")
    fm.click("[data-testid=sheet-picker]"); fm.fill("[data-testid=sheet-search]", "e-101"); shot(fm, "11-phone-sheet-picker.png")
    ok(fm.locator(".pick").count() == 1, "sheet search narrows the list to E-101")
    fm.click("[data-testid=sheet-E-101]")
    fm.set_input_files("[data-testid=photo-input]", PHOTO)
    fm.fill("[data-testid=note]", "Panel LP-1 relocated 3 ft north to clear duct, conduits re-stubbed above")
    fm.click("[data-testid=suggest]")
    fm.wait_for_function("document.querySelectorAll('[data-testid^=queue-]').length >= 1", timeout=90000)
    st = fm.request.get(f"{BASE}/api/projects/{pid}/state", headers=H(fm)).json(); m1 = st["markups"][0]
    ok(m1["status"] == "draft", f"capture 1 -> draft via {m1['method']} (conf {m1['confidence']}, anchor '{m1.get('anchorText')}')")
    shot(fm, "12-phone-captured.png")
    # offline capture (forced stub so the run makes at most one model call)
    fm.evaluate("localStorage.setItem('fab-force-stub','1')")
    fm_ctx.set_offline(True); fm.wait_for_timeout(300)
    ok("Offline" in fm.locator("[data-testid=net]").inner_text(), "app shows Offline")
    fm.set_input_files("[data-testid=photo-input]", PHOTO)
    fm.fill("[data-testid=note]", "J-3 for EWC moved 4 ft west in corridor 107")
    fm.click("[data-testid=suggest]"); fm.wait_for_selector("[data-testid=outbox]")
    ok("1 waiting to sync" in fm.locator("[data-testid=outbox]").inner_text(), "offline capture queued in IndexedDB (1 waiting to sync)")
    shot(fm, "13-phone-offline-queued.png")
    fm_ctx.set_offline(False)
    fm.wait_for_selector("[data-testid=outbox]", state="detached", timeout=60000)
    st = fm.request.get(f"{BASE}/api/projects/{pid}/state", headers=H(fm)).json()
    m2 = next((m for m in st["markups"] if "J-3" in (m.get("anchorText") or "")), None)
    ok(m2 and m2["method"].startswith("stub") and len(st["markups"]) == 2, f"offline capture synced -> draft anchored on '{m2 and m2['anchorText']}'")
    cap2 = next(c for c in st["captures"] if c["id"] == m2["captureId"])
    dup = fm.request.post(f"{BASE}/api/captures", headers=H(fm), multipart={"photo": {"name": "p.jpg", "mimeType": "image/jpeg", "buffer": open(PHOTO, "rb").read()}, "note": "dup", "sheetId": m2["sheetId"], "clientId": cap2["clientId"], "mode": "stub"}).json()
    ok(dup.get("duplicate") and dup["markup"]["id"] == m2["id"], "re-sending the same offline capture is idempotent (no duplicate)")
    # role enforcement
    c1 = fm.request.patch(f"{BASE}/api/markups/{m1['id']}", headers=H(fm), data={"status": "confirmed"}).status
    c2 = fm.request.post(f"{BASE}/api/projects", headers=H(fm), data={"name": "nope"}).status
    c3 = fm.request.get(f"{BASE}/api/projects/{pid}/export.pdf?drawingId={st['drawings'][0]['id']}", headers=H(fm)).status
    c4 = fm.request.post(f"{BASE}/api/projects/{pid}/sample", headers=H(fm)).status
    ok([c1, c2, c3, c4] == [403] * 4, f"foreman blocked from confirm/create project/export/add set -> {[c1, c2, c3, c4]}")
    fm_ctx.close()

    # ---- 4. PE reviews and exports
    pe.reload(); pe.wait_for_selector(f"[data-testid=queue-{m1['id']}]", timeout=30000)
    pe.click(f"[data-testid=queue-{m1['id']}]"); pe.wait_for_timeout(1500)
    box = pe.locator(f"[data-testid=markup-{m1['id']}] rect.hit").bounding_box()
    sx, sy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pe.mouse.move(sx, sy); pe.mouse.down(); pe.mouse.move(sx + 30, sy + 15, steps=5); pe.mouse.move(sx + 60, sy + 30, steps=5); pe.mouse.up(); pe.wait_for_timeout(1500)
    m1b = next(x for x in pe.request.get(f"{BASE}/api/projects/{pid}/state", headers=H(pe)).json()["markups"] if x["id"] == m1["id"])
    ok(m1b["cloud"]["x"] > m1["cloud"]["x"] + 5, f"PE drag moved cloud x {m1['cloud']['x']} -> {m1b['cloud']['x']}")
    pe.click("[data-testid=confirm]"); pe.wait_for_timeout(1200)
    pe.click(f"[data-testid=queue-{m2['id']}]"); pe.wait_for_timeout(500); pe.click("[data-testid=reject]"); pe.wait_for_timeout(1200)
    shot(pe, "14-pe-review.png")
    st = pe.request.get(f"{BASE}/api/projects/{pid}/state", headers=H(pe)).json()
    ok(sorted(m["status"] for m in st["markups"]) == ["confirmed", "rejected"], "PE confirmed one, rejected one")
    # full-set export via UI
    pe.click(f"[data-testid=queue-{m1['id']}]"); pe.wait_for_timeout(500)
    with pe.expect_download() as dl: pe.click("[data-testid=export]")
    full = os.path.join(OUT, "export-full-set.pdf"); dl.value.save_as(full)
    pe.click("[data-testid=scope-sheet]")
    with pe.expect_download() as dl: pe.click("[data-testid=export]")
    one = os.path.join(OUT, "export-sheet-E-101.pdf"); dl.value.save_as(one)
    with pe.expect_download() as dl: pe.click("[data-testid=export-csv]")
    csvp = os.path.join(OUT, "markup-log.csv"); dl.value.save_as(csvp)
    pe_ctx.close(); b.close()

R = PdfReader(full); anns = inspect(full)
clouds = [a for a in anns if a["subtype"] == "/Polygon"]; callouts = [a for a in anns if a["subtype"] == "/FreeText"]
ok(len(R.pages) == 3, f"full-set PDF: 2 sheets + 1 log page = {len(R.pages)} pages")
ok(len(clouds) == 1 and len(callouts) == 1, f"full-set has only the confirmed markup (clouds={len(clouds)}, callouts={len(callouts)})")
c = clouds[0] if clouds else {}
ok(c.get("intent") == "/PolygonCloud" and c.get("border_effect", {}).get("/S") == "/C" and c.get("has_appearance"), "cloud is a Bluebeam-style /PolygonCloud with appearance")
ok(callouts and callouts[0]["intent"] == "/FreeTextCallout" and callouts[0]["callout_line"] and "LP-1" in str(callouts[0]["contents"]).upper(), "callout is /FreeTextCallout with leader + note text")
ok(c.get("vertices") and abs(c["vertices"][0] - m1b["cloud"]["x"]) < 0.2, "cloud reflects the PE's dragged position")
ok("captured 20" in str(c.get("subject")), f"annotation subject carries capture date: {c.get('subject')}")
log = R.pages[-1].extract_text()
ok("Markup log" in log and "CONFIRMED" in log and "(1)" in log, "log page lists markups grouped by capture date")
R1 = PdfReader(one); a1 = inspect(one)
ok(len(R1.pages) == 2 and len([a for a in a1 if a["subtype"] == "/Polygon"]) == 1, f"per-sheet export: E-101 + log = {len(R1.pages)} pages, 1 cloud")
rows = list(csv.DictReader(io.StringIO(open(csvp, encoding="utf-8-sig").read())))
ok(len(rows) == 1 and rows[0]["sheet"] == "E-101" and rows[0]["status"] == "confirmed" and rows[0]["captured_by"] == FM and rows[0]["confirmed_by"] == PE, f"markup CSV: {len(rows)} row, sheet {rows[0]['sheet'] if rows else '-'}, by {rows[0]['captured_by'] if rows else '-'}")
subprocess.run(["pdftoppm", "-r", "80", "-png", "-f", "3", "-l", "3", full, os.path.join(SHOTS, "15-export-log-page")], check=True)
subprocess.run(["pdftoppm", "-r", "80", "-png", "-f", "1", "-l", "1", full, os.path.join(SHOTS, "16-export-sheet")], check=True)
print(f"\noutputs: {OUT}\nscreenshots: {SHOTS}")
print("ALL PASS" if all(results) else f"SOME CHECKS FAILED ({results.count(False)})"); sys.exit(0 if all(results) else 1)
