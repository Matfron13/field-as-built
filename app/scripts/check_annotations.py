"""Inspect a PDF and list its markup annotations. Exit 1 if no cloud+callout pair is found.
usage: python3 check_annotations.py file.pdf"""
import sys, json
from pypdf import PdfReader

def inspect(path):
    r = PdfReader(path); out = []
    for pno, page in enumerate(r.pages, 1):
        for a in page.get("/Annots") or []:
            a = a.get_object()
            out.append({
                "page": pno, "subtype": a.get("/Subtype"), "intent": a.get("/IT"),
                "border_effect": dict(a["/BE"]) if "/BE" in a else None,
                "subject": a.get("/Subj"), "author": a.get("/T"), "contents": a.get("/Contents"),
                "rect": [round(float(x), 1) for x in a.get("/Rect")],
                "vertices": [round(float(x), 1) for x in a["/Vertices"]] if "/Vertices" in a else None,
                "callout_line": [round(float(x), 1) for x in a["/CL"]] if "/CL" in a else None,
                "has_appearance": "/AP" in a, "grouped_to": "/IRT" in a, "status": a.get("/FAB_Status"),
            })
    return out

if __name__ == "__main__":
    anns = inspect(sys.argv[1])
    print(json.dumps(anns, indent=1, default=str))
    clouds = [a for a in anns if a["subtype"] == "/Polygon" and a["intent"] == "/PolygonCloud" and a["border_effect"] and a["border_effect"].get("/S") == "/C" and a["has_appearance"]]
    callouts = [a for a in anns if a["subtype"] == "/FreeText" and a["intent"] == "/FreeTextCallout" and a["callout_line"] and a["has_appearance"]]
    print(f"clouds={len(clouds)} callouts={len(callouts)}")
    sys.exit(0 if clouds and callouts else 1)
