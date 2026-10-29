"""THIRD-PARTY-NOTICES.md keeps up with two kinds of third-party material that can arrive
without anyone writing a notice:

- data from nmrshiftdb2 (its licence asks for a notice wherever its data goes): every data
  file that mentions it must be named, by path, in THIRD-PARTY-NOTICES.md;
- the libraries packed inside a jar: every Maven artifact and every class in the jar must
  be listed in its licence file, which THIRD-PARTY-NOTICES.md names.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

from checks.files import repo_files
from lib.appconfig import ROOT

NOTICES = "THIRD-PARTY-NOTICES.md"

# Code and prose may name nmrshiftdb2 without holding its data; their own notices are review's.
CODE_AND_PROSE = set(".ts .tsx .js .mjs .cjs .py .sh .java .md .css .html".split())
# Data files that name nmrshiftdb2 but hold none of its data.
NAMES = "compound names; its header says where the shifts come from"
ONLY_NAME_IT = {
    "tests/fixtures/nmr_names.txt": NAMES,
    "tests/fixtures/proton_nmr_names.txt": NAMES,
    "web/scripts/checks/fixtures/dist-files.json": "a list of built file names",
    "third_party/notices/inventory.json": "a list of shipped file names",
}

# Each jar, and the file listing what is packed inside it (kept out of server/: a deploy that
# ships a change there waits for the API to be restarted).
JARS = {"server/opsin/opsin.jar": "third_party/opsin/LICENSES.txt"}
POM_PROPERTIES = re.compile(r"META-INF/maven/[^/]+/[^/]+/pom\.properties")


def named(path: str, text: str) -> bool:
    """The text names this repo path itself, not a longer path that ends with it."""
    return re.search(rf"(?<![\w./-]){re.escape(path)}(?![\w/-])", text) is not None


def nmrshiftdb2_files(root: Path, notices: str) -> list[str]:
    problems = []
    for path in repo_files(root):
        rel = path.relative_to(root).as_posix()
        if path.suffix in CODE_AND_PROSE or rel in ONLY_NAME_IT:
            continue
        if b"nmrshiftdb" in path.read_bytes().lower() and not named(rel, notices):
            problems.append(f"{rel} holds nmrshiftdb2 data but {NOTICES} doesn't name it")
    return problems


def artifacts(jar: zipfile.ZipFile) -> list[str]:
    """'groupId:artifactId version' for each Maven artifact packed inside the jar."""
    found = []
    for name in jar.namelist():
        if POM_PROPERTIES.fullmatch(name):
            props = dict(
                line.split("=", 1)
                for line in jar.read(name).decode("utf-8").splitlines()
                if "=" in line
            )
            found.append(f"{props['groupId']}:{props['artifactId']} {props['version']}")
    return sorted(found)


def jar_contents(root: Path, notices: str) -> list[str]:
    problems = []
    for jar_path, listing_path in JARS.items():
        if not named(listing_path, notices):
            problems.append(f"{NOTICES} doesn't name {listing_path}")
        listing = root / listing_path
        if not (root / jar_path).is_file():
            problems.append(f"{jar_path} is missing")
            continue
        if not listing.is_file():
            problems.append(f"{listing_path} is missing: it lists what {jar_path} packs inside it")
            continue
        text = listing.read_text(encoding="utf-8")
        listed = set(re.findall(r"^Maven: (.+)$", text, re.M))
        prefixes = re.findall(r"^Classes: (\S+)$", text, re.M)
        # A part's packages mustn't take in another's (a library shades others inside its own
        # package): each part lists its own, so a newly shaded one shows up as unlisted.
        for outer in sorted(set(prefixes)):
            for inner in sorted(set(prefixes)):
                if inner != outer and inner.startswith(outer):
                    problems.append(f"{listing_path} lists {outer}, which takes in {inner}")
        with zipfile.ZipFile(root / jar_path) as jar:
            for artifact in artifacts(jar):
                if artifact not in listed:
                    problems.append(
                        f"{jar_path} packs {artifact}, which {listing_path} doesn't list"
                    )
            unlisted = {
                name.rsplit("/", 1)[0] + "/" if "/" in name else name
                for name in jar.namelist()
                if name.endswith(".class") and not any(name.startswith(p) for p in prefixes)
            }
        for package in sorted(unlisted):
            problems.append(f"{jar_path} holds {package}, which {listing_path} doesn't list")
    return problems


def check(root: Path) -> list[str]:
    notices_path = root / NOTICES
    if not notices_path.is_file():
        return [f"{NOTICES} is missing"]
    notices = notices_path.read_text(encoding="utf-8")
    return nmrshiftdb2_files(root, notices) + jar_contents(root, notices)


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else ROOT
    problems = check(root)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
