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
