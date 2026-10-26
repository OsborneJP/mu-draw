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
    # Nothing else is in the folder: it all ships, and is precached.
    assert {p.name for p in bg.PIECES_DIR.iterdir()} == {
        Path(path).name for path in built if path.endswith(".svg")
    }


def test_the_script_clears_anything_else_out_of_the_folder(tmp_path, monkeypatch):
    pieces_dir = tmp_path / "web/public/glassware"
    (pieces_dir / "sub").mkdir(parents=True)
    (pieces_dir / "stray.png").write_bytes(b"x")
    (pieces_dir / "Old-Piece.SVG").write_text("<svg/>")
    (pieces_dir / "sub/old.svg").write_text("<svg/>")
    (tmp_path / "web/src/editor").mkdir(parents=True)
    monkeypatch.setattr(bg, "ROOT", tmp_path)
    monkeypatch.setattr(bg, "PIECES_DIR", pieces_dir)
    assert bg.main([]) == 0
    assert sorted(p.name for p in pieces_dir.iterdir()) == sorted(
        f"{p['id']}.svg" for p in bg.read_spec()["pieces"]
    )


def test_every_original_is_the_one_recorded(spec):
    for source in spec["sources"].values():
        data = (bg.ORIGINALS / source["file"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == source["sha256"], source["file"]
    used = {piece["source"] for piece in spec["pieces"]}
    assert used == set(spec["sources"]), "an original that no piece uses"
    assert {p.name for p in bg.ORIGINALS.iterdir()} == {s["file"] for s in spec["sources"].values()}


# What a shipped piece may contain, written out here rather than taken from the script, so a
# gap in the script's refusals is not a gap in this test too.
SHIPPED_ELEMENTS = {
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "use", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "marker", "pattern",
    "symbol",
}  # fmt: skip


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
    ids = [e.get("id") for e in root.iter() if isinstance(e.tag, str) and e.get("id")]
    assert len(ids) == len(set(ids)), "an id is used twice"
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue  # the credit comment
        assert element.tag.startswith(SVG) and element.tag[len(SVG) :] in SHIPPED_ELEMENTS
        for attribute, value in element.attrib.items():
            name = attribute.split("}")[-1]
            assert not name.lower().startswith("on") and name not in {"src", "data", "class"}
            assert attribute != "{http://www.w3.org/XML/1998/namespace}base"
            if name == "href":
                assert value[1:] in ids, f"{value} points outside the piece"
    # No CSS escape or at-rule, and every url() points inside the piece.
    assert "\\" not in text and "@" not in text
    for target in re.findall(r"url\(([^)]*)\)", text, re.IGNORECASE):
        assert target.startswith("#") and target[1:] in ids, f"url({target})"


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
    start = notices.index("- web/public/glassware/")
    block = notices[start : notices.index("\n- ", start)]
    for source in spec["sources"].values():
        assert source["licence"] in bg.LICENCES
        entry = (
            f'"{source["title"]}" by {source["author"]} ({source["site"]}, {source["licence"]}):'
            f"\n    {source['url']}"
        )
        assert entry in block, f"THIRD-PARTY-NOTICES.md lacks {entry!r}"
    assert len(re.findall(r'^  - "', block, re.MULTILINE)) == len(spec["sources"])
    for other in ("CC BY", "BY-SA", "BY-NC", "GFDL", "GPL"):
        assert other not in block


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


KEPT = "g2023"  # kept by the first piece, the round-bottom flask


def inside(markup: str):
    """Puts `markup` (one element, SVG unless it says otherwise) inside the kept group."""

    def change(text: str) -> str:
        root = ET.fromstring(text)
        group = next(e for e in root.iter() if e.get("id") == KEPT)
        group.append(
            ET.fromstring(f'<x xmlns="http://www.w3.org/2000/svg" {XMLNS}>{markup}</x>')[0]
        )
        return ET.tostring(root, encoding="unicode")

    return change


def around(tag: str, attributes: str):
    """Wraps the kept group in `<tag attributes>`."""

    def change(text: str) -> str:
        root = ET.fromstring(text)
        parent = next(p for p in root.iter() for c in p if c.get("id") == KEPT)
        group = next(c for c in parent if c.get("id") == KEPT)
        wrapper = ET.fromstring(f"<{tag} {XMLNS} {attributes}/>")
        parent.insert(list(parent).index(group), wrapper)
        parent.remove(group)
        wrapper.append(group)
        return ET.tostring(root, encoding="unicode")

    return change


XMLNS = (
    'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml" '
    'xmlns:x="urn:example"'
)
OUT = "https://x.example/a.svg#p"


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
        # Inside the kept group, where it would ship if the rule were missing.
        (inside(f'<use href="#path6311"><set attributeName="href" to="{OUT}"/></use>'), "<set>"),
        (
            inside(
                '<use xlink:href="#path6311">'
                f'<animate attributeName="xlink:href" values="#a;{OUT}"/></use>'
            ),
            "<animate>",
        ),
        (inside(f'<use xlink:href="{OUT}"/>'), "<use> links to"),
        (
            inside(f'<path d="M0 0" style="fill:\\75 rl({OUT})"/>'),
            "style on <path> loads something",
        ),
        (inside(f'<style>@\\69mport "{OUT}";</style>'), "<style> loads something"),
        (inside(f'<style>g{{fill:image-set("{OUT}" 1x)}}</style>'), "<style> loads something"),
        (inside(f"<style>g{{fill:url({OUT})}}</style>"), "<style> loads something"),
        (inside(f'<path d="M0 0" fill="URL({OUT})"/>'), "fill on <path> loads something"),
        (
            inside(f'<path d="M0 0" style="fill:url(\'{OUT}\')"/>'),
            "style on <path> loads something",
        ),
        (around("h:img", f'src="{OUT}"'), "XHTML <img>"),
        (around("h:object", f'data="{OUT}"'), "data attribute on <object>"),
        (around("g", 'xml:base="https://x.example/"'), "base attribute on <g>"),
    ],
    ids=[
        "script",
        "foreignObject",
        "image",
        "event",
        "link",
        "import",
        "style-url",
        "fill-url",
        "set",
        "animate",
        "use-link",
        "css-escape",
        "escaped-import",
        "image-set",
        "style-element-url",
        "uppercase-url",
        "quoted-url",
        "xhtml-img",
        "xhtml-object",
        "xml-base",
    ],  # fmt: skip
)
def test_an_original_that_could_load_or_run_something_is_refused(tmp_path, change, message):
    spec_file, originals = doctored(tmp_path, change)
    with pytest.raises(bg.GlasswareError, match=re.escape(message)) as error:
        bg.build(spec_file, originals)
    assert "Simple_distillation_apparatus.svg" in str(error.value)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        # A kept element inside something that isn't an SVG drawing element.
        (around("x:wrap", ""), "a kept element is inside <wrap>"),
        # A class's rules would not come along: the piece would ship unstyled.
        (inside('<path d="M0 0 L9 9" class="fil0"/>'), "needs a stylesheet"),
    ],
    ids=["foreign-wrapper", "class"],
)
def test_a_piece_the_script_cannot_cut_faithfully_is_refused(tmp_path, change, message):
    spec_file, originals = doctored(tmp_path, change)
    with pytest.raises(bg.GlasswareError, match=re.escape(message)):
        bg.build(spec_file, originals)


def test_a_reference_in_the_original_roots_style_brings_its_definition(tmp_path):
    root_style = lambda text: text.replace("<svg", '<svg style="fill:url(#linearGradient4335)"', 1)  # noqa: E731
    spec_file, originals = doctored(tmp_path, root_style)
    svg = bg.build(spec_file, originals)["web/public/glassware/round-bottom-flask.svg"]
    assert 'style="fill:url(#linearGradient4335)"' in svg
    assert 'id="linearGradient4335"' in svg


def test_a_piece_with_nothing_left_to_draw_is_refused(tmp_path):
    spec_file = respec(tmp_path, lambda s: s["pieces"][0].update(keep=["text4894"]))
    with pytest.raises(bg.GlasswareError, match="nothing to draw is left"):
        bg.build(spec_file)


def test_path_data_with_numbers_after_z_is_an_error_naming_it():
    with pytest.raises(bg.GlasswareError, match="numbers after Z"):
        bg.path_points("M0 0 L1 1 Z 5 5")


def test_a_region_refuses_a_use_whose_place_it_cannot_tell():
    root = ET.fromstring(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
        '<defs><path id="p" d="M150 50 h10 v10 z"/></defs><use id="u" xlink:href="#p"/></svg>'
    )
    with pytest.raises(bg.GlasswareError, match="region mode can't place <use id='u'>"):
        bg.shapes_in(root, (0, 0, 100, 100))


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
