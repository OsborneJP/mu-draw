# ChemDraw round-trip files

Jeff adds 10 files here from his own copy of ChemDraw (CDX and CDXML, including
reactions) for the spec's round-trip check: ChemDraw → app → ChemDraw, with atoms, bonds,
stereochemistry, arrows and text intact.

Rules:
- Files come from ChemDraw only. Don't generate, edit or "fix" them here; if one fails to
  open, that is a finding to record in BUILD-LEARNINGS.md.
- Name them `NN-short-description.cdx` / `.cdxml` (for example `03-aldol-reaction.cdxml`),
  and describe each one in the table below so a failure can be judged without ChemDraw.
- Expected values are never typed in. A test opens each file in Ketcher, saves it, reopens
  it, and compares what Ketcher/Indigo reports before and after.

| File | Contents | What to look for after a round trip |
| --- | --- | --- |
