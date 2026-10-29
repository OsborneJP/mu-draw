"""The InChI and cairo source the app ships (docs/plans/licence-notices.md, decision 1, bar B.4):
the README inside the archive is the one beside it, it lists exactly the files that differ from
the untouched upstream sources, and the app's build names the same archive."""

import build_indigo_source as source

from lib.appconfig import ROOT


def test_the_committed_archive_passes():
    readme = source.README.read_bytes()
    indigo = source.read_manifest(source.INDIGO_MANIFEST)
    assert source.check(source.archive_files(), readme, source.read_manifest(), indigo) == []


def fixture() -> tuple[dict[str, bytes], dict[str, str], dict[str, str]]:
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
    indigo = {p: source.git_blob(d) for p, d in files.items() if p.startswith("third_party/")}
    return files, manifest, indigo


def test_a_listed_change_and_addition_pass():
    files, manifest, indigo = fixture()
    assert source.check(files, files["README.md"], manifest, indigo) == []


def test_a_change_the_readme_does_not_list_fails():
    files, manifest, indigo = fixture()
    files["third_party/inchi/INCHI_BASE/src/same.c"] = b"int same, now changed;\n"
    indigo["third_party/inchi/INCHI_BASE/src/same.c"] = source.git_blob(
        files["third_party/inchi/INCHI_BASE/src/same.c"]
    )  # as in Indigo's tree
    assert source.check(files, files["README.md"], manifest, indigo) == [
        "third_party/inchi/INCHI_BASE/src/same.c differs from upstream"
        " but the README doesn't list it"
    ]


def test_a_listed_file_that_is_the_same_as_upstream_fails():
    files, manifest, indigo = fixture()
    files["third_party/inchi/INCHI_BASE/src/changed.c"] = b"int original;\n"
    indigo["third_party/inchi/INCHI_BASE/src/changed.c"] = source.git_blob(
        files["third_party/inchi/INCHI_BASE/src/changed.c"]
    )  # as in Indigo's tree
    assert source.check(files, files["README.md"], manifest, indigo) == [
        "the README lists third_party/inchi/INCHI_BASE/src/changed.c, which is the same as upstream"
    ]


def test_the_readme_beside_the_archive_must_be_the_one_inside():
    files, manifest, indigo = fixture()
    assert source.check(files, files["README.md"] + b"\nedited\n", manifest, indigo) == [
        "the README inside the archive is not the one beside it"
    ]


def test_the_build_ships_this_archive():
    # web/src/shell/thirdParty.ts names the archive the app offers; the build copies it from here.
    named = (ROOT / "web/src/shell/thirdParty.ts").read_text()
    assert f"third-party/{source.ARCHIVE.name}" in named


def test_a_file_missing_from_the_archive_or_not_indigos_fails():
    files, manifest, indigo = fixture()
    del files["third_party/inchi/CMakeLists.txt"]
    files["third_party/inchi/stray.c"] = b"int stray;\n"
    problems = source.check(files, files["README.md"], manifest, indigo)
    assert "third_party/inchi/CMakeLists.txt is missing from the archive" in problems
    assert "third_party/inchi/stray.c is in the archive but not in Indigo's tree" in problems


def test_a_file_whose_bytes_are_not_indigos_fails():
    files, manifest, indigo = fixture()
    files["third_party/inchi/CMakeLists.txt"] = b"project(not_indigos)\n"
    assert "third_party/inchi/CMakeLists.txt is not Indigo's file" in source.check(
        files, files["README.md"], manifest, indigo
    )


def test_the_indigo_manifest_is_gits_own_listing():
    # git's blob ids, which anyone can check against the public commit (git ls-tree -r).
    indigo = source.read_manifest(source.INDIGO_MANIFEST)
    files = source.archive_files()
    assert all(len(blob) == 40 for blob in indigo.values())
    assert indigo["third_party/inchi/LICENCE"] == source.git_blob(
        files["third_party/inchi/LICENCE"]
    )
