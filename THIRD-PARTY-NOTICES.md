# Third-party notices

LICENSE (MIT) covers this repository's own code and documents. These parts keep their
own licences:

- server/opsin/opsin.jar: OPSIN, under the MIT licence in server/opsin/LICENSE.txt.
- web/public/nmr/carbon-shifts.bin and tests/fixtures/nmr/excerpt.sd and
  reference_spectra.json: contain information from nmrshiftdb2 (www.nmrshiftdb.org),
  which is made available here under the nmrshiftdb2 Database License
  (web/public/nmr/LICENSE-nmrshiftdb2.txt;
  https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt).
  web/scripts/build-carbon-table.ts shows how the shift table is derived from it.
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
- Packages installed by npm and conda are under their own licences.
