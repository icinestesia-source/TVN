"""Write docs/remaining-content-map-v43.{json,md}: the latest decision for every channel decided in Pass 22 or
Pass 23, and every channel still NEEDS_CONTENT exactly once. Run after regenerating the channel manifest."""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from pass22_decisions import DECISIONS as P22  # noqa: E402
from pass23_decisions import ATTEMPTS, DECISIONS as P23, V42_STATUS  # noqa: E402

after = {r["number"]: r for r in json.load(open(os.path.join(ROOT, "docs/channel-manifest.json")))["records"]}

EXPECT = {
    "ACTIVATED": ("PLAYABLE", "PLAYABLE_STRONG"),
    "GENERATED_PRESENTATION": ("GENERATED",),
    "RETROTV_ORIGINAL": ("RETROTV_ORIGINAL",),
    "INTENTIONALLY_UNAVAILABLE": ("DELIBERATELY_UNAVAILABLE",),
    "UNRESOLVED": ("NEEDS_CONTENT",),
    "RIGHTS_BLOCKED": ("NEEDS_CONTENT",),
}

rows = []
for n in sorted(set(P22) | set(P23)):
    d, a = (P23 if n in P23 else P22)[n], after[n]
    assert a["status"] in EXPECT[d["outcome"]], (n, d["outcome"], a["status"])
    row = dict(number=n, name=a["name"], category=a["category"], decidedIn="23" if n in P23 else "22", outcome=d["outcome"],
               subtype=d["subtype"], reason=d["reason"], statusAfter=a["status"], programmesAfter=a["programmes"], hoursAfter=a["hours"])
    if n in V42_STATUS:
        row["statusBefore"] = V42_STATUS[n]
    for key in ("mechanism", "evidence", "redirect", "rights"):
        if key in d:
            row[key] = d[key]
    if n in ATTEMPTS:
        row["attempt"] = ATTEMPTS[n]
    rows.append(row)

needs = sorted(n for n, r in after.items() if r["status"] == "NEEDS_CONTENT")
unresolved = [dict(number=r["number"], name=r["name"], finalClass=r["subtype"], reason=r["reason"]) for r in rows if r["statusAfter"] == "NEEDS_CONTENT"]
assert sorted(r["number"] for r in unresolved) == needs, set(needs) ^ {r["number"] for r in unresolved}
assert not any(r["finalClass"].startswith("OTHER") for r in unresolved)
assert set(ATTEMPTS) <= {r["number"] for r in unresolved}, set(ATTEMPTS) - {r["number"] for r in unresolved}

doc = {
    "format": "retrotv-remaining-content-map",
    "catalogue": "catalogue-v43",
    "pass": "23",
    "channels": len(unresolved),
    "outcomes": dict(Counter(r["outcome"] for r in rows)),
    "classes": dict(Counter(r["finalClass"] for r in unresolved)),
    "records": rows,
    "unresolved": unresolved,
}
json.dump(doc, open(os.path.join(ROOT, "docs/remaining-content-map-v43.json"), "w"), indent=1, ensure_ascii=False)


def cell(text):
    return str(text).replace("|", "/")


md = ["# Remaining content map — catalogue-v43 (after Pass 23)", "",
      f"Latest decision for every channel decided in Pass 22 or Pass 23. {len(unresolved)} channels remain NEEDS_CONTENT, each once, in a precise class.", "",
      "## Outcomes", "", "| Outcome | Channels |", "|---|---|"]
md += [f"| {k} | {v} |" for k, v in sorted(doc["outcomes"].items())]
md += ["", "## Still unresolved by class", "", "| Class | Channels |", "|---|---|"]
md += [f"| {k} | {v} |" for k, v in sorted(doc["classes"].items())]
md += ["", "## Channels", "", "| # | Channel | Pass | Outcome | Subtype | Status | Hours | Reason |", "|---|---|---|---|---|---|---|---|"]
for r in rows:
    extra = f" Redirect: {r['redirect']:03d}." if "redirect" in r else ""
    attempt = f" Pass 23 attempt: {cell(r['attempt'])}" if "attempt" in r else ""
    md.append(f"| {r['number']:03d} | {r['name']} | {r['decidedIn']} | {r['outcome']} | {r['subtype']} | {r['statusAfter']} | {r['hoursAfter']} | {cell(r['reason'])}{extra}{attempt} |")
open(os.path.join(ROOT, "docs/remaining-content-map-v43.md"), "w").write("\n".join(md) + "\n")
print(doc["outcomes"], doc["classes"], len(unresolved))
