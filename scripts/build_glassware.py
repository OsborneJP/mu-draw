"""Build the lab glassware pieces (docs/plans/v2-glassware.md) from their originals.

third_party/glassware/pieces.json names each piece's original drawing (public domain or CC0,
kept unchanged in third_party/glassware/originals/ and checked by SHA-256), the elements cut
out of it, an optional rotation, a crop box and a scale. For each piece this script:
- refuses an original that could load or run anything (scripts, foreign objects, embedded
  images, event attributes, links or CSS urls to anything but its own elements);
- keeps the listed elements, with their ancestors' transforms and the definitions they use,
  and drops text (Indigo's export leaves it out), metadata and editor attributes;
- turns it, crops it, and sizes it 4x its placed size, so Indigo's raster of it in Export
  and Copy image stays sharp (decision 6).

It writes web/public/glassware/<id>.svg and web/src/editor/glassware.json (the menu).
Standard library only.

Usage: python scripts/build_glassware.py            (write the pieces)
       python scripts/build_glassware.py --uncropped DIR
           (write every piece uncropped into DIR, for measuring crop boxes)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "third_party" / "glassware"
SPEC_FILE = SOURCE_DIR / "pieces.json"
ORIGINALS = SOURCE_DIR / "originals"
PIECES_DIR = ROOT / "web" / "public" / "glassware"
MENU_FILE = ROOT / "web" / "src" / "editor" / "glassware.json"

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
XML = "http://www.w3.org/XML/1998/namespace"
XML_SPACE = f"{{{XML}}}space"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)

# Ketcher draws a bond 40 px long at 100% zoom; pieces ship at 4x that (decision 6).
PX_PER_MODEL_UNIT = 40
RASTER_SCALE = 4
LICENCES = ("Public domain", "CC0 1.0")

# An allowlist: the static drawing elements the originals use (and their close kin). Anything
# else in the SVG namespace is refused, so animation (<set>, <animate>), <script>, <image>,
# <foreignObject>, links (<a>), filters and the rest never get in. Text and metadata are
# dropped, not refused. Elements of other namespaces are editor metadata, dropped; one that
# encloses a kept element, or one from XHTML anywhere, is refused.
DRAWING_ELEMENTS = {
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "use", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "marker", "pattern",
    "symbol", "style",
}  # fmt: skip
TEXT_ELEMENTS = {"text", "tspan", "textPath", "flowRoot", "flowRegion", "flowPara", "flowSpan"}
DROPPED_ELEMENTS = TEXT_ELEMENTS | {"metadata", "title", "desc"}
XHTML = "http://www.w3.org/1999/xhtml"
# Attributes that load or run something on any element.
REFUSED_ATTRIBUTES = {"src", "data"}
LOCAL_URL = re.compile(r"url\(\s*['\"]?#[^)'\"]+['\"]?\s*\)")
ANY_URL = re.compile(r"url\(", re.IGNORECASE)
# CSS that could reach outside without a plain url(): escapes (\75 rl( is url(), at-rules
# (@import, also escaped), and image-set()/image()/src() with a bare string.
CSS_ESCAPES_AND_RULES = re.compile(r"[\\@]|image-set\(|image\(|src\(", re.IGNORECASE)
REFERENCE = re.compile(r"url\(\s*['\"]?#([^)'\"]+)['\"]?\s*\)")


class GlasswareError(Exception):
    """An original or the spec is not usable; the message names it."""


@dataclass(frozen=True)
class Piece:
    id: str
    name: str
    group: str
    source: str
    keep: tuple[str, ...]  # element ids; empty when `region` picks the elements
    region: tuple[float, float, float, float] | None  # x, y, w, h in the original's units
    rotate: float
    crop: tuple[float, float, float, float]
    scale: float


def local(tag: str) -> str:
    """An element or attribute name without its namespace."""
    return tag.rsplit("}", 1)[-1]


def namespace(tag: str) -> str:
    return tag[1:].split("}", 1)[0] if tag.startswith("{") else ""


def read_spec(path: Path = SPEC_FILE) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    ids = [p["id"] for p in spec["pieces"]]
    if len(ids) != len(set(ids)):
        raise GlasswareError("pieces.json: piece ids are not unique")
    for piece in spec["pieces"]:
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", piece["id"]):
            raise GlasswareError(f"pieces.json: bad piece id {piece['id']!r}")
        if piece["group"] not in spec["groups"]:
            raise GlasswareError(f"pieces.json: {piece['id']}: unknown group {piece['group']!r}")
        if piece["source"] not in spec["sources"]:
            raise GlasswareError(f"pieces.json: {piece['id']}: unknown source {piece['source']!r}")
        if ("keep" in piece) == ("region" in piece):
            raise GlasswareError(f"pieces.json: {piece['id']}: give either keep or region")
    for key, source in spec["sources"].items():
        if source["licence"] not in LICENCES:
            licence = source["licence"]
            raise GlasswareError(f"pieces.json: {key}: licence {licence!r} is not PD or CC0")
    return spec


def pieces(spec: dict) -> list[Piece]:
    return [
        Piece(
            id=p["id"],
            name=p["name"],
            group=p["group"],
            source=p["source"],
            keep=tuple(p.get("keep", ())),
            region=tuple(p["region"]) if "region" in p else None,
            rotate=float(p.get("rotate", 0)),
            crop=tuple(p["crop"]),
            scale=float(p["scale"]),
        )
        for p in spec["pieces"]
    ]


def read_original(source: dict, originals: Path = ORIGINALS) -> ET.Element:
    """The original's tree, once its bytes are the ones recorded and nothing in it is refused."""
    data = (originals / source["file"]).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != source["sha256"]:
        raise GlasswareError(f"{source['file']}: SHA-256 {digest} is not the recorded one")
    root = ET.fromstring(data)
    problems = refused(root)
    if problems:
        raise GlasswareError(f"{source['file']}: " + "; ".join(problems))
    return root


def refused(root: ET.Element) -> list[str]:
    """What in this drawing could load or run something."""
    problems = []
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        name = local(element.tag)
        if namespace(element.tag) == SVG and name not in DRAWING_ELEMENTS | DROPPED_ELEMENTS:
            problems.append(f"<{name}>")
        if namespace(element.tag) == XHTML:
            problems.append(f"XHTML <{name}>")
        if name == "style" and element.text and bad_css(element.text, stylesheet=True):
            problems.append("<style> loads something")
        for attribute, value in element.attrib.items():
            attr = local(attribute)
            if attr.lower().startswith("on"):
                problems.append(f"{attr} attribute on <{name}>")
            elif attr in REFUSED_ATTRIBUTES or attribute == f"{{{XML}}}base":
                problems.append(f"{attr} attribute on <{name}>")
            elif attr == "href" and not value.startswith("#"):
                problems.append(f"<{name}> links to {value[:40]!r}")
            elif bad_css(value, stylesheet=attr == "style"):
                problems.append(f"{attr} on <{name}> loads something")
    return sorted(set(problems))


def bad_css(text: str, stylesheet: bool = False) -> bool:
    """A url() to anything but an element of the same drawing; and in a style attribute or
    <style>, any escape, at-rule or image-set()/image()/src()."""
    if stylesheet and CSS_ESCAPES_AND_RULES.search(text):
        return True
    return len(ANY_URL.findall(text)) != len(LOCAL_URL.findall(text))


def references(element: ET.Element) -> set[str]:
    """Ids this subtree points at (href="#id", url(#id))."""
    found = set()
    for node in element.iter():
        for attribute, value in node.attrib.items():
            if local(attribute) == "href" and value.startswith("#"):
                found.add(value[1:])
            found.update(REFERENCE.findall(value))
        if isinstance(node.tag, str) and local(node.tag) == "style" and node.text:
            found.update(REFERENCE.findall(node.text))
    return found


def cleaned(element: ET.Element) -> ET.Element | None:
    """A deep copy without text, metadata, foreign elements or editor attributes."""
    if not isinstance(element.tag, str) or namespace(element.tag) != SVG:
        return None
    if local(element.tag) in DROPPED_ELEMENTS:
        return None
    if element.get("class") is not None:
        # A class's rules live in a <style> the piece doesn't carry: it would ship unstyled.
        raise GlasswareError(
            f"<{local(element.tag)} class={element.get('class')!r}> needs a stylesheet"
        )
    copy_ = ET.Element(element.tag, clean_attributes(element.attrib))
    if local(element.tag) == "style":
        copy_.text = element.text
    for child in element:
        kept = cleaned(child)
        if kept is not None:
            copy_.append(kept)
    return copy_


def clean_attributes(attributes: dict[str, str]) -> dict[str, str]:
    kept = {}
    for attribute, value in attributes.items():
        ns = namespace(attribute)
        if ns == "" or (ns == XLINK and local(attribute) == "href") or attribute == XML_SPACE:
            kept[attribute] = value
    return kept


def cut(root: ET.Element, piece: Piece, where: str) -> tuple[list[ET.Element], set[str]]:
    """The piece's elements in document order, each inside copies of its ancestor groups (their
    attributes, so their transforms, but none of their other children); and the ids they use.
    The elements are those named in `keep`, or the shapes whose middle lies in `region`."""
    if piece.region is None:
        wanted = set(piece.keep)
        found = {e.get("id") for e in root.iter() if e.get("id") in wanted}
        missing = wanted - found
        if missing:
            raise GlasswareError(f"{where}: no element with id {', '.join(sorted(missing))}")
        chosen = {id(e) for e in root.iter() if e.get("id") in wanted}
    else:
        chosen = shapes_in(root, piece.region)
        if not chosen:
            raise GlasswareError(f"{where}: nothing drawn in region {piece.region}")

    def contains(element: ET.Element) -> bool:
        return any(id(node) in chosen for node in element.iter())

    def walk(element: ET.Element) -> ET.Element | None:
        if id(element) in chosen:
            return cleaned(element)
        if not contains(element):
            return None
        if namespace(element.tag) != SVG or local(element.tag) not in DRAWING_ELEMENTS:
            raise GlasswareError(f"{where}: a kept element is inside <{local(element.tag)}>")
        shell = ET.Element(element.tag, clean_attributes(element.attrib))
        for child in element:
            part = walk(child)
            if part is not None:
                shell.append(part)
        return shell

    body = []
    for child in root:
        if isinstance(child.tag, str) and local(child.tag) == "defs":
            continue
        part = walk(child)
        if part is not None:
            body.append(part)
    used = set()
    for part in body:
        used |= references(part)
    if not any(local(e.tag) in SHAPES for part in body for e in part.iter()):
        raise GlasswareError(f"{where}: nothing to draw is left (text and definitions are not)")
    return body, used


# Region choice: the middle of each shape's points (path ends and control points, under its
# transforms) must lie in the region. Coarse, but enough to tell apart drawings that stand
# side by side; the crop box is measured from the rendered ink.
SHAPES = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"}
NUMBER = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
Matrix = tuple[float, float, float, float, float, float]
IDENTITY: Matrix = (1, 0, 0, 1, 0, 0)


def multiply(m: Matrix, n: Matrix) -> Matrix:
    a, b, c, d, e, f = m
    g, h, i, j, k, l_ = n
    return (
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l_ + e,
        b * k + d * l_ + f,
    )


def transform_of(text: str | None) -> Matrix:
    matrix = IDENTITY
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", text or ""):
        v = [float(x) for x in re.findall(NUMBER, args)]
        if name == "matrix":
            step = tuple(v)
        elif name == "translate":
            step = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale":
            step = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == "rotate":
            a = math.radians(v[0])
            cx, cy = (v[1], v[2]) if len(v) > 2 else (0, 0)
            step = multiply(
                multiply(
                    (1, 0, 0, 1, cx, cy),
                    (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0),
                ),
                (1, 0, 0, 1, -cx, -cy),
            )
        elif name == "skewX":
            step = (1, 0, math.tan(math.radians(v[0])), 1, 0, 0)
        elif name == "skewY":
            step = (1, math.tan(math.radians(v[0])), 0, 1, 0, 0)
        else:
            raise GlasswareError(f"unknown transform {name}")
        matrix = multiply(matrix, step)  # type: ignore[arg-type]
    return matrix


def path_points(d: str) -> list[tuple[float, float]]:
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|" + NUMBER, d)
    points, x, y, start, command, i = [], 0.0, 0.0, (0.0, 0.0), "M", 0
    sizes = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}
    while i < len(tokens):
        if tokens[i].isalpha():
            command = tokens[i]
            i += 1
            if command in "Zz":
                x, y = start
                continue
        size = sizes[command.upper()]
        if size == 0:  # numbers right after Z, which takes none
            raise GlasswareError(f"path data has numbers after {command}: {d[:40]!r}")
        args = [float(t) for t in tokens[i : i + size]]
        i += size
        if len(args) < size:
            break
        relative = command.islower()
        upper = command.upper()
        if upper == "H":
            x = args[0] + (x if relative else 0)
        elif upper == "V":
            y = args[0] + (y if relative else 0)
        elif upper == "A":
            x, y = (args[5] + x, args[6] + y) if relative else (args[5], args[6])
        else:
            for k in range(0, size - 2, 2):  # control points
                px, py = args[k], args[k + 1]
                points.append((px + x, py + y) if relative else (px, py))
            x, y = (args[-2] + x, args[-1] + y) if relative else (args[-2], args[-1])
        points.append((x, y))
        if upper == "M":
            start = (x, y)
            command = "l" if relative else "L"
    return points


def shape_points(element: ET.Element) -> list[tuple[float, float]]:
    name = local(element.tag)
    f = lambda key: float(re.findall(NUMBER, element.get(key, "0"))[0])  # noqa: E731
    if name == "path":
        return path_points(element.get("d", ""))
    if name in ("rect", "use"):
        return [(f("x"), f("y")), (f("x") + f("width"), f("y") + f("height"))]
    if name in ("circle", "ellipse"):
        rx = f("r") if name == "circle" else f("rx")
        ry = f("r") if name == "circle" else f("ry")
        return [(f("cx") - rx, f("cy") - ry), (f("cx") + rx, f("cy") + ry)]
    if name == "line":
        return [(f("x1"), f("y1")), (f("x2"), f("y2"))]
    values = [float(v) for v in re.findall(NUMBER, element.get("points", ""))]
    return list(zip(values[0::2], values[1::2], strict=False))


def shapes_in(root: ET.Element, region: tuple[float, float, float, float]) -> set[int]:
    rx, ry, rw, rh = region
    chosen: set[int] = set()

    def walk(element: ET.Element, matrix: Matrix) -> None:
        if not isinstance(element.tag, str) or local(element.tag) in ("defs", *DROPPED_ELEMENTS):
            return
        matrix = multiply(matrix, transform_of(element.get("transform")))
        if local(element.tag) == "use":
            # Placed by what it points at, which its own x and y don't say: keep it by id.
            raise GlasswareError(f"region mode can't place <use id={element.get('id')!r}>")
        if local(element.tag) in SHAPES:
            points = shape_points(element)
            if points:
                a, b, c, d, e, f = matrix
                xs = [a * px + c * py + e for px, py in points]
                ys = [b * px + d * py + f for px, py in points]
                mx, my = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
                if rx <= mx <= rx + rw and ry <= my <= ry + rh:
                    chosen.add(id(element))
            return
        for child in element:
            walk(child, matrix)

    for child in root:
        walk(child, IDENTITY)
    return chosen


def definitions(root: ET.Element, used: set[str], drawn: set[str]) -> ET.Element | None:
    """Copies of the elements the piece refers to, and those they refer to in turn, except
    those it draws itself (`drawn`), so no id is in the piece twice."""
    by_id = {e.get("id"): e for e in root.iter() if e.get("id")}
    wanted, todo = set(), list(used)
    while todo:
        ident = todo.pop()
        if ident in wanted or ident not in by_id:
            continue
        wanted.add(ident)
        todo.extend(references(by_id[ident]))
    if not wanted:
        return None
    wanted -= drawn
    if not wanted:
        return None
    defs = ET.Element(f"{{{SVG}}}defs")
    for element in root.iter():
        if element.get("id") in wanted:
            kept = cleaned(element)
            if kept is not None:
                defs.append(kept)
    return defs


def canvas(root: ET.Element) -> tuple[float, float, float, float]:
    """The original's own drawing area, in its user units."""
    box = root.get("viewBox")
    if box:
        x, y, w, h = (float(v) for v in re.split(r"[\s,]+", box.strip()))
        return x, y, w, h
    return 0.0, 0.0, length(root.get("width")), length(root.get("height"))


def length(value: str | None) -> float:
    match = re.fullmatch(r"\s*([0-9.]+)\s*(px)?\s*", value or "")
    if not match:
        raise GlasswareError(f"a width or height of {value!r} needs a viewBox")
    return float(match.group(1))


def turned_bounds(box: tuple[float, float, float, float], degrees: float):
    """The bounds of `box` turned by `degrees` about the origin (SVG's rotate())."""
    x, y, w, h = box
    a = math.radians(degrees)
    corners = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
    xs = [cx * math.cos(a) - cy * math.sin(a) for cx, cy in corners]
    ys = [cx * math.sin(a) + cy * math.cos(a) for cx, cy in corners]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def number(value: float) -> str:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def piece_svg(piece: Piece, source: dict, root: ET.Element, uncropped: bool = False) -> str:
    where = f"{piece.id} ({source['file']})"
    body, used = cut(root, piece, where)
    if uncropped:
        x, y, w, h = turned_bounds(canvas(root), piece.rotate)
        x, y, w, h = x - w / 2, y - h / 2, w * 2, h * 2  # room for anything off the canvas
    else:
        x, y, w, h = piece.crop
    width = w * piece.scale * PX_PER_MODEL_UNIT * RASTER_SCALE
    height = h * piece.scale * PX_PER_MODEL_UNIT * RASTER_SCALE
    out = ET.Element(
        f"{{{SVG}}}svg",
        {
            "width": number(width),
            "height": number(height),
            "viewBox": " ".join(number(v) for v in (x, y, w, h)),
        },
    )
    out.append(ET.Comment(f" {credit_of(source)} Cut out by scripts/build_glassware.py. "))
    group = ET.Element(f"{{{SVG}}}g")
    for attribute in ("style", "fill", "stroke", "stroke-width", "fill-rule"):
        if root.get(attribute) is not None:
            group.set(attribute, root.get(attribute))
    used |= references(group)  # the root's own presentation attributes, now on this group
    drawn = {e.get("id") for part in body for e in part.iter() if e.get("id")}
    defs = definitions(root, used, drawn)
    if defs is not None:
        out.append(defs)
    out.append(group)
    if piece.rotate:
        group.set("transform", f"rotate({number(piece.rotate)})")
    group.extend(body)
    return ET.tostring(out, encoding="unicode") + "\n"


def credit_of(source: dict) -> str:
    return f'"{source["title"]}" by {source["author"]} ({source["site"]}, {source["licence"]}).'


def menu(spec: dict, all_pieces: list[Piece]) -> dict:
    authors: list[str] = []
    for piece in all_pieces:
        for name in spec["sources"][piece.source]["credit_names"]:
            if name not in authors:
                authors.append(name)
    named = ", ".join(authors[:-1]) + f" and {authors[-1]}" if len(authors) > 1 else authors[0]
    return {
        "about": "Generated by scripts/build_glassware.py from third_party/glassware/pieces.json.",
        "groups": spec["groups"],
        "credit": (
            f"Drawings from Wikimedia Commons and Openclipart by {named}; public domain and CC0."
        ),
        "pieces": [
            {
                "id": p.id,
                "name": p.name,
                "group": p.group,
                "file": f"glassware/{p.id}.svg",
                "width": round(p.crop[2] * p.scale, 4),
                "height": round(p.crop[3] * p.scale, 4),
            }
            for p in all_pieces
        ],
    }


def build(spec_file: Path = SPEC_FILE, originals: Path = ORIGINALS) -> dict[str, str]:
    """Every output file's path (relative to the repo) and text."""
    spec = read_spec(spec_file)
    all_pieces = pieces(spec)
    trees = {key: read_original(source, originals) for key, source in spec["sources"].items()}
    outputs = {}
    for piece in all_pieces:
        source = spec["sources"][piece.source]
        svg = piece_svg(piece, source, trees[piece.source])
        outputs[f"web/public/glassware/{piece.id}.svg"] = svg
    outputs["web/src/editor/glassware.json"] = (
        json.dumps(menu(spec, all_pieces), indent=2, ensure_ascii=False) + "\n"
    )
    return outputs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--uncropped", type=Path, help="write uncropped pieces into this folder")
    args = parser.parse_args(argv)
    try:
        if args.uncropped:
            spec = read_spec()
            args.uncropped.mkdir(parents=True, exist_ok=True)
            for piece in pieces(spec):
                source = spec["sources"][piece.source]
                svg = piece_svg(piece, source, read_original(source), uncropped=True)
                (args.uncropped / f"{piece.id}.svg").write_text(svg, encoding="utf-8")
            return 0
        outputs = build()
    except GlasswareError as error:
        print(f"build_glassware: {error}", file=sys.stderr)
        return 1
    # The folder holds exactly the pieces: anything else would ship and be precached unchecked.
    keep = {Path(path).name for path in outputs if path.startswith("web/public/glassware/")}
    for path in PIECES_DIR.iterdir() if PIECES_DIR.exists() else ():
        if path.name not in keep:
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    PIECES_DIR.mkdir(parents=True, exist_ok=True)
    for path, text in outputs.items():
        (ROOT / path).write_text(text, encoding="utf-8")
    print(f"build_glassware: {len(outputs) - 1} pieces written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
