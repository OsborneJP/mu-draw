# Third-party notices

LICENSE (MIT) covers this repository's own code and documents. These parts keep their
own licences:

- server/opsin/opsin.jar: OPSIN, under the MIT licence in server/opsin/LICENSE.txt. The jar
  also packs the libraries OPSIN uses: dk.brics.automaton (BSD); Woodstox (Apache License
  2.0), with the parts of MSV (BSD licences; a few files under the Apache Software License
  1.1 or the Apache License 2.0), RELAX NG datatype (BSD) and ISO RELAX (MIT) that it carries
  inside itself; Stax2 API (BSD 2-Clause); Apache Commons IO and Apache Log4j API (Apache
  License 2.0). Their versions, copyright notices, licence texts and NOTICE files are in
  third_party/opsin/LICENSES.txt. OPSIN runs only on the server, so none of this reaches a
  student's device.
- third_party/indigo-source/: the source of InChI 1.06 (IUPAC/InChI-Trust InChI Licence No. 1.0,
  third_party/inchi/LICENCE inside the archive) and cairo (upstream commit 06f405c7, which calls
  itself 1.17.4; distributed here under the Mozilla Public License 1.1, which its authors let the
  recipient choose instead of the LGPL 2.1)
  as built into the app's Indigo, with Indigo's build files (Apache License 2.0), taken unchanged
  from Indigo's commit b36d38f5 by scripts/build_indigo_source.py. Its README lists the files
  that differ from the upstream releases. The app ships it.
- These files contain information from nmrshiftdb2 (www.nmrshiftdb.org), which is made
  available here under the nmrshiftdb2 Database License
  (web/public/nmr/LICENSE-nmrshiftdb2.txt;
  https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt):
  - the ¹³C and ¹H shift tables, web/public/nmr/carbon-shifts.bin and
    web/public/nmr/proton-shifts.bin, derived from it by web/scripts/build-carbon-table.ts
    and web/scripts/build-proton-table.ts;
  - the test compounds' records and measured shifts, and the predictions' outliers against
    them: tests/fixtures/nmr/excerpt.sd, tests/fixtures/nmr/reference_spectra.json,
    tests/fixtures/nmr/outliers.json, tests/fixtures/proton_nmr/excerpt.sd,
    tests/fixtures/proton_nmr/reference_spectra.json and tests/fixtures/proton_nmr/outliers.json;
  - a few of those measured shifts, quoted in BUILD-LEARNINGS.md and
    docs/plans/v2-proton-nmr.md.

  Both NMR previews show this notice with every prediction.
- web/public/ir-bands.json: the IR hint table, compiled by MU Draw contributors, under
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); changes to it stay under
  that licence. Its values are adapted in part from "Infrared spectroscopy correlation
  table", Wikipedia (https://en.wikipedia.org/wiki/Infrared_spectroscopy_correlation_table),
  CC BY-SA 4.0, and cross-checked against OpenStax Organic Chemistry, section 12.7, Table
  12.1 (https://openstax.org/books/organic-chemistry/pages/12-7-interpreting-infrared-spectra),
  which is CC BY-NC-SA 4.0: values only, no text copied. The app shows this credit, in plain
  text, wherever it shows the hints.
- web/public/glassware/ (the lab glassware pieces): cut by scripts/build_glassware.py from
  the drawings kept unchanged in third_party/glassware/originals/. Each of those is in the
  public domain or under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/), so no
  credit is required; the app gives it anyway, in plain text, in the Templates menu's
  Glassware tab and in About. The drawings:
  - "Simple distillation apparatus" by Quantockgoblin (original PNG) and Slashme (SVG) (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Simple_distillation_apparatus.svg
  - "Schlenk flasks" by Quantockgoblin (original PNG) and Slashme (SVG) (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Schlenk_flasks.svg
  - "Allihn condenser" by Quantockgoblin (original) and Jxjl (vector) (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Allihn_condenser.svg
  - "Burette" by Mysid, after Quantockgoblin (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Burette.svg
  - "Tlc sequence" by Quantockgoblin (original PNG) and Shakiestone (SVG) (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Tlc_sequence.svg
  - "Mehrhalskolben V.1" by Jü (Wikimedia Commons, CC0 1.0):
    https://commons.wikimedia.org/wiki/File:Mehrhalskolben.V.1.V.1.svg
  - "Funnel Types V.1" by Jü (Wikimedia Commons, CC0 1.0):
    https://commons.wikimedia.org/wiki/File:Funnel_Types_V.1.svg
  - "Dropping Funnel V.1" by Jü (Wikimedia Commons, CC0 1.0):
    https://commons.wikimedia.org/wiki/File:Dropping_Funnel_V.1.svg
  - "Graduated Cylinder tall form 250ml" by Xavax (Wikimedia Commons, Public domain):
    https://commons.wikimedia.org/wiki/File:Graduated_Cylinder_tall_form_250ml.svg
  - "Erlenmeyerkolben" by B_Lachner (Openclipart, CC0 1.0):
    https://openclipart.org/detail/176995/erlenmeyerkolben
  - "Beakers" by B_Lachner (Openclipart, CC0 1.0):
    https://openclipart.org/detail/175615/beakers
  - "Separatory funnel" by stefg1971 (Openclipart, CC0 1.0):
    https://openclipart.org/detail/175342/separatory-funnel
  - "Buchner funnel and flask" by MeV (Openclipart, CC0 1.0):
    https://openclipart.org/detail/28348/buchner-funnel-and-flask
- web/src/chem/tautomers.ts, resonance.ts and rdkitTables.json: ported from, and tables taken
  from, the RDKit's C++ source (www.rdkit.org; release 2026.09.1: MolStandardize/Tautomer.cpp
  and its tautomerTransforms.in, Resonance.cpp, ConjugHybrid.cpp, Aromaticity.cpp), under
  RDKit's BSD 3-Clause licence (tests/fixtures/recorded/rdkit/license.txt, which
  rdkitTables.json carries into the built app). The RDKit source files recorded in
  tests/fixtures/recorded/rdkit/ are RDKit's own, under the same licence.
- web/src/chem/biochemData.json and tests/fixtures/biochem_peptides_expected.json: values
  read from Biopython 1.88 (https://biopython.org; Biopython License Agreement, in the
  package's LICENSE.rst) by server/scripts/gen_biochem_expected.py: the 20 standard amino
  acids' codes, the base pairs, and Bjellqvist's pKa values (Electrophoresis 1993, 14,
  1023-1031; 1994, 15, 529-539), with Biopython's answers for the test peptides.
- web/public/ghs/GHS01.svg to GHS09.svg: the nine GHS hazard pictograms, unedited copies of
  Wikimedia Commons' GHS-pictogram-explos, -flamme, -rondflam, -bottle, -acid, -skull,
  -exclam, -silhouette and -pollu .svg (https://commons.wikimedia.org/wiki/File:GHS-pictogram-flamme.svg
  and so on), which Commons marks public domain ("ineligible for copyright … contains no
  original authorship"), converted from UNECE's EPS files. Read 2026-10-26.
- tests/fixtures/recorded/: answers recorded from PubChem (pubchem.ncbi.nlm.nih.gov).
  The `ghs-*.json` recordings are PubChem's GHS sections, and tests/fixtures/safety_responses.json
  is built from them (the server's answers, holding parts of that data); docs/plans/v2-safety-snapshot.md
  and BUILD-LEARNINGS.md quote a few of their figures. They contain data from:
  - the European Chemicals Agency (C&L Inventory), which may be reproduced for
    non-commercial purposes provided that ECHA is acknowledged as the source: "Source:
    European Chemicals Agency, http://echa.europa.eu/" (https://echa.europa.eu/web/guest/legal-notice);
  - Regulation (EC) No 1272/2008, Annex VI, from EUR-Lex, © European Union, CC BY 4.0
    (https://eur-lex.europa.eu/content/legal-notice/legal-notice.html);
  - NITE-CMC (Japan), which asks that the source be cited
    (https://www.chem-info.nite.go.jp/en/chem/chrip/chrip_search/html/condUse.html);
  - HCIS, Safe Work Australia: PubChem gives no licence for it; Safe Work Australia's own
    documents are CC BY-NC (https://www.safeworkaustralia.gov.au/copyright);
  - HSDB, US National Library of Medicine: no restrictions; NLM asks to be acknowledged
    (https://www.nlm.nih.gov/web_policies.html).
  The app shows each source's credit, in plain text, wherever it shows its data (Safety).
- 3Dmol.js 2.5.5 (npm package 3dmol, bundled into the app's 3Dmol chunk for the 3D view):
  BSD 3-Clause License, Copyright (c) 2014, University of Pittsburgh and contributors; it
  incorporates GLmol (biochem_fan), Three.js (three.js Authors) and jQuery (John Resig),
  under the terms in its LICENSE (web/node_modules/3dmol/LICENSE). Its bundle carries pako
  2.2.0 (MIT and Zlib licences), iobuffer 5.4.0, netcdfjs 3.0.0 and upng-js 2.1.0 (MIT
  licence each). The About box credits it.
- Packages installed by npm and conda are under their own licences.
