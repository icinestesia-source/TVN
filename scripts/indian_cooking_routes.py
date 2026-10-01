"""769 Indian Cooking (TVN 1.0.8): programme-level routes from Manjula's Kitchen.

Manjula's Kitchen is already in the catalogue (src_manjulas_kitchen, home 714 Vegetarian). Its programmes are
chosen individually for 769 when the title names an Indian dish or regional cuisine, and never when it is a
Western or fusion recipe (pizza, pasta, cakes, tacos, burgers...); at most LIMIT of them, longest first. The source/channel pair is approved in
fit.ts (CURATED_REUSE 769) and the same title rule is fit.ts INDIAN_COOKING_TITLE; src/tvn-1-0-8.test.ts
checks the two agree. Reads and writes only public/independent/playable.json "programmeRoutes"["769"].
No network calls.
"""

import json
import re
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parent.parent / "public" / "independent" / "playable.json"
CHANNEL = 769
SOURCES = {"src_manjulas_kitchen"}
# 714 Vegetarian already airs all 300 Manjula's Kitchen programmes and claims first. The network's anti-duplication
# rule (src/library/query.ts DUPLICATE_SIMILARITY = 0.6) darkens a channel whose pool shares 60% or more with an
# earlier claim, so 769 may share at most 179 of them; 170 keeps a margin. The longest recipes are chosen first.
LIMIT = 170

# Keep identical to INDIAN_COOKING_TITLE in src/director/fit.ts.
NOT_INDIAN = (
    r"\b(?:pizzas?|pasta|enchiladas?|tacos?|mexican|falafel|tapas|bruschetta|(?<!milk )(?<!lentil )cakes?|cheesecakes?|mousse|cookies?|brownies?|"
    r"muffins?|pies?|lemonade|krispies|baklava|scalloped|sandwich(?:es)?|burgers?|tofu|bowls?|noodles|"
    r"avocado|jalapenos?|ricotta|tots|fusion|truffles?)\b"
)
INDIAN = (
    r"\b(?:indian|punjabi|gujarati|rajasthani|maharashtrian|bengali|hyderabadi|sindhi|bihari|mumbai|kashmiri|"
    r"samosas?|parathas?|paranthas?|puris?|poori|kachori|chaat|chat|dal|daal|dosas?|idli|uttapam|vadas?|wada|pakoras?|"
    r"pakoda|bhaji|pav|naan|roti|kulcha|bhatura|battura|chole|chana|rajma|paneer|kofta|korma|biryani|briyani|pulao|"
    r"khichdi|kadhi|sambar|rasam|chutney|raita|halwa|burfi|barfi|ladoo|laddu|peda|jalebi|jamun|rasgulla|ras ?malai|"
    r"kheer|phirni|kulfi|falooda|malpua|gujiy?a|kalakand|mithai|chum chum|cham cham|mathri|namak (?:para|pare|paare)|"
    r"shakk?ar para|gur para|chakli|chivda|poha|bhel|dhokla|muthia|khandvi|thepla|bhakarwadi|litti|chokha|sabzi|sabji|"
    r"aloo|alu|gobi|gobhi|matt?ar|palak|methi|bhindi|baingan|bharta|karela|arbi|saag|masala|tikki|tikka|makhani|"
    r"makhana|thandai|lassi|panjiri|mohan thal|puran poli|khaja|chiroti|frankie|kathi|upma|sheera|sooji|suji|rava|"
    r"besan|nimki|namkeen|gatte|dahi|chawal|cheela|curry|kokum|shakar kandi|sev|boondi|balu ?shahi|handvo|modak)\b"
)
INDIAN_COOKING_TITLE = re.compile(rf"^(?!.*{NOT_INDIAN}).*{INDIAN}", re.IGNORECASE)


def eligible(items: list) -> list[list]:
    return [row for row in items if row[3] in SOURCES and INDIAN_COOKING_TITLE.search(row[1])]


def chosen(items: list) -> list[str]:
    ranked = sorted(eligible(items), key=lambda row: (-row[2], row[0]))
    return [row[0] for row in ranked[:LIMIT]]


def main() -> None:
    doc = json.loads(CATALOGUE.read_text())
    ids = chosen(doc["items"])
    rows = {row[0]: row for row in doc["items"]}
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate ids")
    doc.setdefault("programmeRoutes", {})[str(CHANNEL)] = ids
    hours = sum(rows[video][2] for video in ids) / 3600
    picked = set(ids)
    unpicked = [row for row in eligible(doc["items"]) if row[0] not in picked]
    left = [row[1] for row in doc["items"] if row[3] in SOURCES and not INDIAN_COOKING_TITLE.search(row[1])]
    print(f"{CHANNEL}: {len(ids)} programmes, {hours:.1f} h; {len(unpicked)} shorter Indian recipes beyond the bound; {len(left)} not Indian cooking (714 only)")
    for title in left:
        print(f"  not Indian cooking: {title}")
    CATALOGUE.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
