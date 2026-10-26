"""The lab glassware pieces (docs/plans/v2-glassware.md, bar A) are cut by
scripts/build_glassware.py from the committed public-domain and CC0 originals, load and run
nothing, and are credited.

web/public/glassware/*.svg and web/src/editor/glassware.json must equal what the script makes
now; each rule that keeps a piece inert has a doctored original that the script refuses.
"""

import hashlib
import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

import build_glassware as bg

SVG = "{http://www.w3.org/2000/svg}"


@pytest.fixture(scope="module")
def built() -> dict[str, str]:
    return bg.build()


@pytest.fixture(scope="module")
def spec() -> dict:
    return bg.read_spec()


def shipped() -> list[Path]:
    return sorted(bg.PIECES_DIR.glob("*.svg"))


def test_the_committed_pieces_and_menu_are_what_the_script_makes(built):
    for path, text in built.items():
        assert (bg.ROOT / path).read_text(encoding="utf-8") == text, f"{path} is stale"
    assert {p.name for p in shipped()} == {
        Path(path).name for path in built if path.endswith(".svg")
    }


def test_every_original_is_the_one_recorded(spec):
    for source in spec["sources"].values():
        data = (bg.ORIGINALS / source["file"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == source["sha256"], source["file"]
    used = {piece["source"] for piece in spec["pieces"]}
    assert used == set(spec["sources"]), "an original that no piece uses"
    assert {p.name for p in bg.ORIGINALS.iterdir()} == {s["file"] for s in spec["sources"].values()}


@pytest.mark.parametrize("path", shipped(), ids=lambda p: p.name)
def test_a_shipped_piece_is_sized_and_inert(path):
    text = path.read_text(encoding="utf-8")
    assert len(text.encode()) < 120_000
    root = ET.fromstring(text)
    assert root.tag == f"{SVG}svg"
    width, height = float(root.get("width")), float(root.get("height"))
    x, y, w, h = (float(v) for v in root.get("viewBox").split())
    assert width > 0 and height > 0 and w > 0 and h > 0
    assert width / height == pytest.approx(w / h, rel=1e-3)
    names = {element.tag.split("}")[-1] for element in root.iter() if isinstance(element.tag, str)}
    assert not names & (bg.REFUSED_ELEMENTS | bg.DROPPED_ELEMENTS), names
    assert bg.refused(root) == []
    for element in root.iter():
        for attribute, value in element.attrib.items():
            assert not attribute.split("}")[-1].lower().startswith("on")
            if attribute.endswith("href"):
                assert value.startswith("#")
    assert "@import" not in text
    assert all(u.startswith("url(#") for u in re.findall(r"url\([^)]*\)", text))


def test_the_menu_lists_every_piece_with_its_placed_size(built, spec):
    menu = json.loads(built["web/src/editor/glassware.json"])
    assert menu["groups"] == spec["groups"]
    assert [p["id"] for p in menu["pieces"]] == [p["id"] for p in spec["pieces"]]
    for entry, piece in zip(menu["pieces"], spec["pieces"], strict=True):
        assert entry["file"] == f"glassware/{piece['id']}.svg"
        assert (bg.ROOT / "web/public" / entry["file"]).exists()
        assert entry["width"] == pytest.approx(piece["crop"][2] * piece["scale"], abs=1e-4)
        assert entry["height"] == pytest.approx(piece["crop"][3] * piece["scale"], abs=1e-4)
        # Shipped at 4x its placed size, for Indigo's raster (decision 6).
        root = ET.fromstring((bg.ROOT / "web/public" / entry["file"]).read_text(encoding="utf-8"))
        assert float(root.get("width")) == pytest.approx(entry["width"] * 160, abs=0.01)
    for name in sorted({n for s in spec["sources"].values() for n in s["credit_names"]}):
        assert name in menu["credit"]


def test_pieces_cut_from_one_drawing_keep_its_scale(spec):
    scales: dict[str, set[float]] = {}
    for piece in spec["pieces"]:
        scales.setdefault(piece["source"], set()).add(piece["scale"])
    assert {source: len(s) for source, s in scales.items()} == {s: 1 for s in scales}


def test_every_original_is_credited_in_the_third_party_notices(spec):
    notices = (bg.ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
    for source in spec["sources"].values():
        assert source["licence"] in bg.LICENCES
        for fact in (source["title"], source["author"], source["url"]):
            assert fact in notices, f"THIRD-PARTY-NOTICES.md lacks {fact!r}"
    assert "public domain" in notices.lower() and "CC0" in notices


# Doctored originals: each is refused, with its file named.


def doctored(tmp_path: Path, change) -> tuple[Path, Path]:
    """A copy of the spec and originals in which one original is changed by `change`
    (text -> text), and its recorded SHA-256 updated to match."""
    originals = tmp_path / "originals"
    shutil.copytree(bg.ORIGINALS, originals)
    spec = json.loads(bg.SPEC_FILE.read_text(encoding="utf-8"))
    source = spec["sources"]["qg-distillation"]
    path = originals / source["file"]
    path.write_text(change(path.read_text(encoding="utf-8")), encoding="utf-8")
    source["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    spec_file = tmp_path / "pieces.json"
    spec_file.write_text(json.dumps(spec), encoding="utf-8")
    return spec_file, originals


def inject(markup: str):
    return lambda text: text.replace("</svg>", f"{markup}</svg>")


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (inject("<script>alert(1)</script>"), "<script>"),
        (inject('<foreignObject width="9" height="9"/>'), "<foreignObject>"),
        (inject('<image href="beaker.png" width="9" height="9"/>'), "<image>"),
        (inject('<rect width="9" height="9" onclick="go()"/>'), "onclick attribute"),
        (inject('<a href="https://example.com/"><rect width="9" height="9"/></a>'), "links to"),
        (inject("<style>@import url(x.css);</style>"), "<style> loads something"),
        (
            inject('<rect width="9" height="9" style="fill:url(https://x.example/p.svg#a)"/>'),
            "style on <rect> loads something",
        ),
        (
            inject('<rect width="9" height="9" fill="url(other.svg#g)"/>'),
            "fill on <rect> loads something",
        ),
    ],
    ids=["script", "foreignObject", "image", "event", "link", "import", "style-url", "fill-url"],
)
def test_an_original_that_could_load_or_run_something_is_refused(tmp_path, change, message):
    spec_file, originals = doctored(tmp_path, change)
    with pytest.raises(bg.GlasswareError, match=re.escape(message)) as error:
        bg.build(spec_file, originals)
    assert "Simple_distillation_apparatus.svg" in str(error.value)


def test_an_original_whose_bytes_changed_is_refused(tmp_path):
    spec_file, originals = doctored(tmp_path, lambda text: text)
    path = originals / "Simple_distillation_apparatus.svg"
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(bg.GlasswareError, match="SHA-256"):
        bg.build(spec_file, originals)


def test_text_and_editor_metadata_are_dropped(tmp_path, built):
    # A label kept on purpose still goes: Indigo's export would drop it anyway.
    spec_file = respec(tmp_path, lambda s: s["pieces"][0]["keep"].append("text4894"))
    svg = bg.build(spec_file)[f"web/public/glassware/{bg.read_spec()['pieces'][0]['id']}.svg"]
    assert "<text" not in svg and "tspan" not in svg
    for path, text in built.items():
        for mark in ("inkscape", "sodipodi", "metadata", "rdf:"):
            assert mark not in text, f"{path} keeps {mark}"


def respec(tmp_path: Path, edit) -> Path:
    spec = json.loads(bg.SPEC_FILE.read_text(encoding="utf-8"))
    edit(spec)
    spec_file = tmp_path / "pieces.json"
    spec_file.write_text(json.dumps(spec), encoding="utf-8")
    return spec_file


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda s: s["sources"]["qg-distillation"].update(licence="CC BY-SA 4.0"), "not PD or CC0"),
        (lambda s: s["pieces"][0].update(keep=["no-such-id"]), "no element with id no-such-id"),
        (lambda s: s["pieces"][0].update(region=[0, 0, 1, 1]), "either keep or region"),
        (lambda s: s["pieces"][1].update(id=s["pieces"][0]["id"]), "not unique"),
        (lambda s: s["pieces"][0].update(group="Pots"), "unknown group"),
    ],
    ids=["licence", "missing-id", "keep-and-region", "duplicate", "group"],
)
def test_a_broken_spec_is_refused(tmp_path, edit, message):
    with pytest.raises(bg.GlasswareError, match=re.escape(message)):
        bg.build(respec(tmp_path, edit))


def test_a_region_picks_the_shapes_whose_middle_lies_in_it():
    root = ET.fromstring(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'
        '<g transform="translate(100,0)"><path id="right" d="m 10,10 h 20 v 20 z"/></g>'
        '<path id="left" d="M 10 10 C 20 0 30 0 40 10"/>'
        '<rect id="wide" x="0" y="0" width="202" height="10"/></svg>'
    )
    chosen = bg.shapes_in(root, (0, 0, 100, 100))
    ids = {e.get("id") for e in root.iter() if id(e) in chosen}
    assert ids == {"left"}  # "wide" has its middle at x = 101; "right" is moved over
    right = bg.shapes_in(root, (100, 0, 100, 100))
    assert {e.get("id") for e in root.iter() if id(e) in right} == {"right", "wide"}


def test_a_turned_piece_is_turned_and_its_box_is_measured_turned():
    assert bg.turned_bounds((0, 0, 10, 20), 90) == pytest.approx((-20, 0, 20, 10))
