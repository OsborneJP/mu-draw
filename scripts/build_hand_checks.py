"""Render docs/v1-hand-checks.md: Jeff's steps for the Testing checklist's hand checks.

    python scripts/build_hand_checks.py           # rewrite docs/v1-hand-checks.md
    python scripts/build_hand_checks.py --check   # exit 1 if it is out of date

Every SMILES, name and value in the sheet comes from the generated fixtures
(tests/fixtures/reference_expected.json, from server-side RDKit; name_responses.json, from
recorded PubChem answers) and every message from the app's source, so nothing in it is typed
by hand (invariant 3; docs/plans/v1-release.md, bar A).
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from lib.appconfig import ROOT, load

DOC = ROOT / "docs" / "v1-hand-checks.md"
FIXTURES = ROOT / "tests" / "fixtures"
PANELS = ROOT / "web" / "src" / "panels"

# The spec's 10 reference compounds, and (E)-cinnamic acid, which Jeff added on 2026-10-23.
PROPERTIES = (
    "aspirin",
    "ibuprofen",
    "caffeine",
    "glucose",
    "paracetamol",
    "benzoic acid",
    "nicotine",
    "cholesterol",
    "(R)-2-butanol",
    "aldehydo-D-glucose",
    "(E)-cinnamic acid",
)
# The checklist's stereocentre box: 2-butanol, and open-chain glucose.
STEREO = ("(R)-2-butanol", "aldehydo-D-glucose")
# Get name's 20 known compounds (tests/fixtures/reference_names.txt, its first block).
GET_NAME = (
    *PROPERTIES,
    "ethanol",
    "acetone",
    "ethyl acetate",
    "toluene",
    "pyridine",
    "(S)-2-butanol",
    "L-alanine",
    "maleic acid",
    "aniline",
)
# Name to structure: what is on the canvas first, what is added, and what replaces it.
ON_CANVAS, ADDED, REPLACING = "aspirin", "caffeine", "ibuprofen"
ENANTIOMERS = ("(R)-2-butanol", "(S)-2-butanol")
LIPINSKI = {"mw": "MW", "logp": "logP", "hbd": "H-bond donors", "hba": "H-bond acceptors"}


def app_text(path: Path, pattern: str) -> str:
    """One message as the app's source writes it."""
    match = re.search(pattern, path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"{path.relative_to(ROOT)} no longer has the text this sheet quotes")
    return match[1].replace("\\'", "'")


def messages() -> dict[str, str]:
    return {
        "not_found": app_text(PANELS / "naming.ts", r"'not-found': '((?:[^'\\]|\\.)*)'"),
        "offline": app_text(PANELS / "NameToStructure.tsx", r"const OFFLINE = '((?:[^'\\]|\\.)*)'"),
        "update": app_text(
            ROOT / "web" / "src" / "shell" / "UpdateBanner.tsx",
            r'data-testid="update-message">([^<]*)<',
        ),
    }


def code(smiles: str) -> str:
    if "|" in smiles or "`" in smiles:
        raise ValueError("a SMILES this sheet can't put in a table")
    return f"`{smiles}`"


def lipinski(rules: dict[str, bool]) -> str:
    failed = [label for key, label in LIPINSKI.items() if not rules[key]]
    return "all 4" if not failed else "fails " + ", ".join(failed)


def render(reference: dict, names: dict, said: dict[str, str], url: str) -> str:
    compounds = {c["typed_name"]: c for c in reference["compounds"]}
    answers = names["responses"]
    for name in {*PROPERTIES, *GET_NAME, ON_CANVAS, ADDED, REPLACING, *ENANTIOMERS}:
        if name not in compounds or not answers.get(name, {}).get("found"):
            raise ValueError(f"{name}: not in the fixtures, or PubChem had no name for it")
    invented = reference["invented"]
    for structure in invented:
        if answers.get(structure["name"], {}).get("found") is not False:
            raise ValueError(f"{structure['name']}: the recorded answer isn't 'not found'")

    def panel(name: str) -> dict:
        return compounds[name]["panel"]

    lines = [
        "# Version 1 hand checks, on Windows 11 and macOS",
        "",
        "Rendered by `python scripts/build_hand_checks.py` from the generated fixtures; do not",
        "edit by hand. It covers the boxes still open in docs/SPEC.md's Testing checklist",
        "(docs/plans/v1-release.md, bar A).",
        "",
        "Do each check twice: on a Windows 11 laptop (Chrome or Edge) and on a Mac (Chrome),",
        "in the app installed from:",
        "",
        f"    {url}",
        "",
        'Then tell Claude what you saw: "all pass on both", or the step and platform that',
        "didn't.",
        "",
        "**To put a structure on the canvas,** copy its SMILES from this sheet, click an empty",
        "part of the canvas, press Ctrl+V (⌘V on a Mac), and click to place it. If the browser",
        "asks to see what you copied, allow it. Clear the canvas between compounds with",
        "Ketcher's Clear Canvas button.",
        "",
        "## 1. Properties match server-side RDKit",
        "",
        "Box: *Properties match server-side RDKit for the 10 reference compounds* (and",
        "(E)-cinnamic acid, added on 2026-10-23).",
        "",
        "Paste each structure and compare the Properties panel with its row. The values are",
        f"server-side RDKit {reference['rdkit_version']}'s, rounded as the panel rounds them.",
        "",
        "| Compound | SMILES to paste |",
        "| --- | --- |",
        *(f"| {name} | {code(compounds[name]['smiles'])} |" for name in PROPERTIES),
        "",
        "| Compound | Formula | Average MW (g/mol) | Exact mass | Degree of unsaturation"
        " | H-bond donors | H-bond acceptors | Rotatable bonds | TPSA (Å²) | logP | Lipinski |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        *(
            f"| {name} | {p['formula']} | {p['average_mw']} | {p['exact_mass']}"
            f" | {p['degree_of_unsaturation']} | {p['hbd']} | {p['hba']} | {p['rotatable_bonds']}"
            f" | {p['tpsa']} | {p['logp']} | {lipinski(p['lipinski'])} |"
            for name in PROPERTIES
            for p in [panel(name)]
        ),
        "",
        "## 2. Stereocentre count",
        "",
        "Box: *Stereocenter count: 2-butanol shows 1; open-chain glucose shows 4, up to 16",
        "stereoisomers.* Paste each (SMILES in section 1) and read the panel's Stereochemistry.",
        "",
        "| Compound | Stereocenters | Stereogenic double bonds | Undefined"
        " | Stereoisomers, at most |",
        "| --- | --- | --- | --- | --- |",
        *(
            f"| {name} | {s['centres']} | {s['double_bonds']} | {s['undefined']}"
            f" | {s['max_stereoisomers']} |"
            for name in STEREO
            for s in [panel(name)["stereo"]]
        ),
        "",
        "## 3. Get name",
        "",
        "Box: *Get name: 20 known compounds correct, 3 invented structures give the not-found",
        "message.* Paste each structure, then press **Get name** in the header. PubChem may have",
        "retitled a compound since these answers were recorded; the same CID is what matters.",
        "Where the drawing leaves stereochemistry undefined, a note under the name says at how",
        "many places (the last column).",
        "",
        "| Compound | SMILES to paste | IUPAC name | PubChem title | CID | Undefined stereo |",
        "| --- | --- | --- | --- | --- | --- |",
        *(
            f"| {name} | {code(compounds[name]['smiles'])} | {a['iupac']} | {a['title']}"
            f" | {a['cid']} | {a['undefined_stereo'] or 'none'} |"
            for name in GET_NAME
            for a in [answers[name]]
        ),
        "",
        f'Each of these invented structures should say: "{said["not_found"]}"',
        "",
        "| Made from | SMILES to paste |",
        "| --- | --- |",
        *(f"| {' + '.join(s['made_from'])} | {code(s['smiles'])} |" for s in invented),
        "",
        "## 4. Name to structure: Add, Replace, and the round trip",
        "",
        "Box: *Name to structure: Add and Replace both work, and the round trip shows PubChem's",
        "name next to the typed name.*",
        "",
        f"1. Paste {ON_CANVAS} ({code(compounds[ON_CANVAS]['smiles'])}).",
        f"2. Type `{ADDED}` in the header's Name to structure box and press **Add**. The",
        "   structure follows the pointer; click to place it. The canvas has both.",
        f"3. Type `{REPLACING}` and press **Replace**. The canvas has only {REPLACING}.",
        "4. The Name panel shows *You typed* with what you typed, and *PubChem's IUPAC name*",
        f'   beside it: "{answers[REPLACING]["iupac"]}".',
        f"5. Type PubChem's own name for {ON_CANVAS}, `{answers[ON_CANVAS]['iupac']}`, and press",
        "   **Replace**. The two names match, so a ✓ follows PubChem's name.",
        "",
        "## 5. (R)- and (S)-2-butanol",
        "",
        "Box: *Stereo: (R)- and (S)-2-butanol give different names and draw with the right",
        "wedges.*",
        "",
        "Type each name in Name to structure and press **Replace**. Check by eye that the wedge",
        "gives the configuration named, and that the panel shows PubChem's name:",
        "",
        "| Typed | PubChem's IUPAC name | CID |",
        "| --- | --- | --- |",
        *(
            f"| `{name}` | {answers[name]['iupac']} | {answers[name]['cid']} |"
            for name in ENANTIOMERS
        ),
        "",
        "Then paste each one's SMILES and press **Get name**: the same two names.",
        "",
        "| Compound | SMILES to paste |",
        "| --- | --- |",
        *(f"| {name} | {code(compounds[name]['smiles'])} |" for name in ENANTIOMERS),
        "",
        "## 6. Offline",
        "",
        "Box: *Offline: properties, functional groups and export all work; naming buttons show",
        "the offline message.*",
        "",
        f"1. In the installed app, paste {ON_CANVAS}, then turn Wi-Fi off. The header says",
        "   **Offline**.",
        "2. Change the drawing (add a carbon): the Properties panel follows it.",
        "3. Tick **Show functional groups**: the groups are listed and coloured on the drawing.",
        "4. **Export** saves a PNG and an SVG; **Copy image** pastes into Word.",
        '5. **Predict ¹³C NMR** still shows a spectrum (the NMR section\'s "Option A only" box',
        "   doesn't apply: the prediction is built into the app; docs/plans/v1-release.md,",
        "   decision 1).",
        "6. **Get name**, the Name to structure box with **Add** and **Replace**, **Safety** and",
        f'   **Show in 3D** are greyed, and each says "{said["offline"]}" (Show in 3D under',
        "   the button, the others when you hover over them).",
        "7. Turn Wi-Fi back on: they work again.",
        "",
        "## 7. The update banner",
        "",
        "Box: *Publishing a new build shows the update banner on next launch, and in an open",
        "app when the student returns to it or it comes back online.*",
        "",
        "This needs Claude to publish a new build while you watch, so it is done with the two",
        "deploys that are coming anyway: the review's fixes, then 1.0.0.",
        "",
        "| Deploy | Windows 11 | Mac |",
        "| --- | --- | --- |",
        "| The review's fixes | App open: switch to another window, then back"
        " | App closed: launch it |",
        "| 1.0.0 | App closed: launch it | App open with Wi-Fi off: turn Wi-Fi on |",
        "",
        "Each time, tell Claude when the apps are ready; Claude deploys and says when it's live.",
        f'Then the banner says "{said["update"]}" The drawing stays as it',
        "was until you click **Reload**; after it, the drawing is still there, and after the",
        "second deploy About shows Version 1.0.0.",
        "",
    ]
    return "\n".join(lines)


def current() -> str:
    reference = json.loads((FIXTURES / "reference_expected.json").read_text(encoding="utf-8"))
    names = json.loads((FIXTURES / "name_responses.json").read_text(encoding="utf-8"))
    return render(reference, names, messages(), load().url("production"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="fail if the sheet is out of date")
    args = parser.parse_args(argv)
    text = current()
    if args.check:
        if DOC.read_text(encoding="utf-8") != text:
            print(f"{DOC.relative_to(ROOT)} is out of date; run scripts/build_hand_checks.py")
            return 1
        return 0
    DOC.write_text(text, encoding="utf-8")
    print(f"wrote {DOC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
