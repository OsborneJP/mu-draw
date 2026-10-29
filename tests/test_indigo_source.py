"""The InChI and cairo source the app ships (docs/plans/licence-notices.md, decision 1, bar B.4):
the README inside the archive is the one beside it, it lists exactly the files that differ from
the untouched upstream sources, and the app's build names the same archive."""

import build_indigo_source as source

from lib.appconfig import ROOT


def test_the_committed_archive_passes():
    readme = source.README.read_bytes()
    assert source.check(source.archive_files(), readme, source.read_manifest()) == []


def fixture() -> tuple[dict[str, bytes], dict[str, str]]:
    """A tiny archive: one InChI file as upstream, one changed and listed, one added and listed."""
    same, changed = b"int same;\n", b"int changed;\n"
    manifest = {
        "INCHI-1-SRC/INCHI_BASE/src/same.c": source.sha256(same),
        "INCHI-1-SRC/INCHI_BASE/src/changed.c": source.sha256(b"int original;\n"),
    }
    files = {
        "third_party/inchi/INCHI_BASE/src/same.c": same,
        "third_party/inchi/INCHI_BASE/src/changed.c": changed,
        "third_party/inchi/CMakeLists.txt": b"project(inchi)\n",
    }
    diff, added = source.changes(files, manifest)
    files["README.md"] = source.readme(diff, added).encode()
    return files, manifest


def test_a_listed_change_and_addition_pass():
    files, manifest = fixture()
    assert source.check(files, files["README.md"], manifest) == []


def test_a_change_the_readme_does_not_list_fails():
    files, manifest = fixture()
    files["third_party/inchi/INCHI_BASE/src/same.c"] = b"int same, now changed;\n"
    assert source.check(files, files["README.md"], manifest) == [
        "third_party/inchi/INCHI_BASE/src/same.c differs from upstream"
        " but the README doesn't list it"
    ]


def test_a_listed_file_that_is_the_same_as_upstream_fails():
    files, manifest = fixture()
    files["third_party/inchi/INCHI_BASE/src/changed.c"] = b"int original;\n"
    assert source.check(files, files["README.md"], manifest) == [
        "the README lists third_party/inchi/INCHI_BASE/src/changed.c, which is the same as upstream"
    ]


def test_the_readme_beside_the_archive_must_be_the_one_inside():
    files, manifest = fixture()
    assert source.check(files, files["README.md"] + b"\nedited\n", manifest) == [
        "the README inside the archive is not the one beside it"
    ]


def test_the_build_ships_this_archive():
    # web/src/shell/thirdParty.ts names the archive the app offers; the build copies it from here.
    named = (ROOT / "web/src/shell/thirdParty.ts").read_text()
    assert f"third-party/{source.ARCHIVE.name}" in named
