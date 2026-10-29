"""The source of InChI and cairo as built into the app's Indigo (docs/plans/licence-notices.md,
decision 1): InChI's licence (§6) asks that its source come with the app, and cairo's (MPL 1.1)
that its source be available. Writes third_party/indigo-source/: the archive the build ships at
<base>third-party/, its README (also inside it), and SHA-256 manifests of the untouched upstream
sources the README's list of EPAM's changes is computed from.

    python scripts/build_indigo_source.py          # network: GitHub and cairographics.org

check() needs no network; tests/test_indigo_source.py runs it on the committed archive.
"""

from __future__ import annotations

import hashlib
import io
import lzma
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from lib.appconfig import ROOT

OUT = ROOT / "third_party" / "indigo-source"
INDIGO_COMMIT = "b36d38f5293470721fe02ee570d9f0e6488a5b8d"  # tag indigo-1.46.0
INCHI_COMMIT = "a515b3973d08abe659d0de3e4def3d28d74eeb88"  # IUPAC-InChI/InChI tag v1.06
# Indigo's cairo is a git snapshot that calls itself 1.17.4, not the 1.17.4 release.
CAIRO_REPO = "https://gitlab.freedesktop.org/cairo/cairo.git"
CAIRO_COMMIT = "06f405c775f46e29a7cc89b03fba9ab71a3f2623"  # 2021-07-20
NAME = f"indigo-{INDIGO_COMMIT[:8]}-inchi-cairo"
ARCHIVE = OUT / f"{NAME}.tar.xz"
README = OUT / "README.md"
MANIFEST = OUT / "upstream.sha256"
# Every file of Indigo's trees at the commit, by git blob id, as `git ls-tree` lists them: an
# archive missing a file or holding another can't pass, and anyone can check the list against
# the public commit.
INDIGO_MANIFEST = OUT / "indigo.git-blobs"

# Indigo's files that go in, and where their untouched upstream copies sit.
TREES = {"third_party/inchi/": "INCHI-1-SRC/", "third_party/cairo/": "cairo/"}
BUILD_FILES = [
    "LICENSE",
    "third_party/CMakeLists.txt",
    "api/wasm/indigo-ketcher/CMakeLists.txt",
    ".github/workflows/indigo-ci.yaml",
]
CAIRO_LICENCES = ["COPYING", "COPYING-LGPL-2.1", "COPYING-MPL-1.1"]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(data: bytes) -> str:
    """The id git gives a file's bytes."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def sparse_clone(url: str, commit: str, paths: list[str], into: Path) -> Path:
    run = lambda *a: subprocess.run(a, cwd=into, check=True, capture_output=True)  # noqa: E731
    run("git", "init", "-q")
    run("git", "remote", "add", "origin", url)
    run("git", "sparse-checkout", "set", "--no-cone", *paths)
    run("git", "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit)
    run("git", "checkout", "-q", "FETCH_HEAD")
    return into


def upstream_file(manifest: dict[str, str], path: str) -> str | None:
    """The upstream path a file of the archive is a copy of, if it has one."""
    for ours, theirs in TREES.items():
        if path.startswith(ours):
            candidate = theirs + path[len(ours) :]
            return candidate if candidate in manifest else None
    return None


def changes(files: dict[str, bytes], manifest: dict[str, str]) -> tuple[list[str], list[str]]:
    """The archive's files under TREES that differ from their upstream copies, and those that
    have none."""
    changed, added = [], []
    for path in sorted(files):
        if not any(path.startswith(t) for t in TREES):
            continue
        upstream = upstream_file(manifest, path)
        if upstream is None:
            added.append(path)
        elif manifest[upstream] != sha256(files[path]):
            changed.append(path)
    return changed, added


def readme(changed: list[str], added: list[str]) -> str:
    bullet = lambda paths: "\n".join(f"- {p}" for p in paths) or "- (none)"  # noqa: E731
    return f"""# The source of InChI and cairo as built into this app's Indigo

The app's Indigo WebAssembly file (indigo-ketcher 1.46.0) was built from Indigo's commit
{INDIGO_COMMIT} (github.com/epam/Indigo, tag indigo-1.46.0); its own version string ends
in -g{INDIGO_COMMIT[:9]}. This archive holds, unchanged from that commit:

- third_party/inchi/: InChI 1.06, under the IUPAC/InChI-Trust InChI Licence No. 1.0
  (third_party/inchi/LICENCE).
- third_party/cairo/: cairo as of its upstream commit {CAIRO_COMMIT}
  (2021-07-20; it calls itself 1.17.4), whose files are under the GNU Lesser General Public
  License 2.1 or, at the recipient's option, the Mozilla Public License 1.1. This app
  distributes cairo under the Mozilla Public License 1.1. Both texts, as cairo has them at
  that commit (gitlab.freedesktop.org/cairo/cairo), are in cairo-licences/.
- How they are built: third_party/CMakeLists.txt, api/wasm/indigo-ketcher/CMakeLists.txt and
  Indigo's CI configuration .github/workflows/indigo-ci.yaml (job build_indigo_ketcher, in
  the emscripten/emsdk:5.0.7 container), with Indigo's own LICENSE (Apache License 2.0).

## Files that differ from upstream

Compared with InChI v1.06 (github.com/IUPAC-InChI/InChI, commit {INCHI_COMMIT})
and cairo's commit above. EPAM Systems changed them; Indigo's history at github.com/epam/Indigo
shows each change.

{bullet(changed)}

## Files not upstream (added by EPAM Systems)

{bullet(added)}
"""


def add(tar: tarfile.TarFile, path: str, data: bytes, mtime: int) -> None:
    info = tarfile.TarInfo(f"{NAME}/{path}")
    info.size, info.mtime, info.mode = len(data), mtime, 0o644
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    tar.addfile(info, io.BytesIO(data))


def archive_bytes(files: dict[str, bytes], mtime: int) -> bytes:
    """The same bytes for the same files: sorted, one owner and time (the Indigo commit's)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for path in sorted(files):
            add(tar, path, files[path], mtime)
    return lzma.compress(raw.getvalue(), preset=9)


def build() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        indigo, inchi = Path(tmp, "indigo"), Path(tmp, "inchi")
        indigo.mkdir()
        inchi.mkdir()
        cairo = Path(tmp, "cairo")
        cairo.mkdir()
        github = "https://github.com/{}.git".format
        sparse_clone(github("epam/Indigo"), INDIGO_COMMIT, [*TREES, *BUILD_FILES], indigo)
        sparse_clone(github("IUPAC-InChI/InChI"), INCHI_COMMIT, ["INCHI-1-SRC/"], inchi)
        sparse_clone(CAIRO_REPO, CAIRO_COMMIT, ["src/", "boilerplate/", *CAIRO_LICENCES], cairo)
        show = ["git", "show", "-s", "--format=%ct", "HEAD"]
        mtime = int(subprocess.run(show, cwd=indigo, check=True, capture_output=True).stdout)
        ls_tree = ["git", "ls-tree", "-r", "HEAD", "--", *TREES]
        listing = subprocess.run(ls_tree, cwd=indigo, check=True, capture_output=True, text=True)
        blobs = {}
        for line in listing.stdout.splitlines():
            meta, path = line.split("\t", 1)
            blobs[path] = meta.split()[2]

        files: dict[str, bytes] = {}
        for tree in TREES:
            for f in sorted((indigo / tree).rglob("*")):
                if f.is_file():
                    files[f.relative_to(indigo).as_posix()] = f.read_bytes()
        for path in BUILD_FILES:
            files[path] = (indigo / path).read_bytes()

        manifest: dict[str, str] = {}
        for f in sorted((inchi / "INCHI-1-SRC").rglob("*")):
            if f.is_file():
                manifest[f.relative_to(inchi).as_posix()] = sha256(f.read_bytes())
        for f in sorted(p for p in cairo.rglob("*") if ".git" not in p.parts):
            if f.is_file():
                name = f.relative_to(cairo).as_posix()
                manifest[f"cairo/{name}"] = sha256(f.read_bytes())
                if name in CAIRO_LICENCES:
                    files[f"cairo-licences/{name}"] = f.read_bytes()

        # Keep only the upstream entries the archive's files are copies of.
        kept = {u: manifest[u] for p in files if (u := upstream_file(manifest, p))}
        changed, added = changes(files, kept)
        text = readme(changed, added)
        files["README.md"] = text.encode()

    OUT.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_bytes(archive_bytes(files, mtime))
    README.write_text(text, encoding="utf-8")
    MANIFEST.write_text("".join(f"{h}  {p}\n" for p, h in sorted(kept.items())), encoding="utf-8")
    INDIGO_MANIFEST.write_text(
        "".join(f"{h}  {p}\n" for p, h in sorted(blobs.items())), encoding="utf-8"
    )
    print(f"{ARCHIVE.relative_to(ROOT)}: {ARCHIVE.stat().st_size} bytes, {len(files)} files")
    print(f"differ from upstream: {len(changed)}; not upstream: {len(added)}")


def read_manifest(path: Path = MANIFEST) -> dict[str, str]:
    """A manifest's entries (upstream.sha256 by default, or indigo.git-blobs)."""
    entries = (line.split("  ", 1) for line in path.read_text(encoding="utf-8").splitlines())
    return {name: digest for digest, name in entries}


def archive_files(path: Path = ARCHIVE) -> dict[str, bytes]:
    with tarfile.open(path, mode="r:xz") as tar:
        return {
            m.name.removeprefix(f"{NAME}/"): tar.extractfile(m).read()  # type: ignore[union-attr]
            for m in tar.getmembers()
            if m.isfile()
        }


def check(
    files: dict[str, bytes], beside: bytes, manifest: dict[str, str], indigo: dict[str, str]
) -> list[str]:
    """Problems with an archive's files, given the README beside it, the upstream manifest and
    Indigo's trees by git blob id: the archive must hold exactly Indigo's files, the README
    inside must be the one beside it, and it must list exactly the files that differ from (or
    are missing in) the untouched upstream sources."""
    problems = []
    trees = {p: git_blob(d) for p, d in files.items() if any(p.startswith(t) for t in TREES)}
    for path in sorted(set(indigo) - set(trees)):
        problems.append(f"{path} is missing from the archive")
    for path in sorted(set(trees) - set(indigo)):
        problems.append(f"{path} is in the archive but not in Indigo's tree")
    for path in sorted(set(trees) & set(indigo)):
        if trees[path] != indigo[path]:
            problems.append(f"{path} is not Indigo's file")
    inside = files.get("README.md")
    if inside != beside:
        problems.append("the README inside the archive is not the one beside it")
    text = (inside or b"").decode()
    changed, added = changes(files, manifest)
    # The bullets of the two lists, which close the README.
    lists = text.split("## Files that differ from upstream", 1)[-1]
    listed = {line[2:] for line in lists.splitlines() if line.startswith("- ")}
    for path in changed + added:
        if path not in listed:
            problems.append(f"{path} differs from upstream but the README doesn't list it")
    for path in listed - set(changed + added) - {"(none)"}:
        problems.append(f"the README lists {path}, which is the same as upstream")
    if INDIGO_COMMIT not in text:
        problems.append(f"the README doesn't name Indigo's commit {INDIGO_COMMIT}")
    return problems


if __name__ == "__main__":
    if sys.argv[1:]:
        raise SystemExit("usage: python scripts/build_indigo_source.py")
    build()
