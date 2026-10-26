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
- tests/fixtures/recorded/: answers recorded from PubChem (pubchem.ncbi.nlm.nih.gov).
  The `ghs-*.json` recordings are PubChem's GHS sections, which contain data from:
  - the European Chemicals Agency (C&L Inventory), which may be reproduced for
    non-commercial purposes provided that ECHA is acknowledged as the source: "Source:
    European Chemicals Agency, http://echa.europa.eu/" (https://echa.europa.eu/web/guest/legal-notice);
  - Regulation (EC) No 1272/2008, Annex VI, from EUR-Lex, © European Union, CC BY 4.0
    (https://eur-lex.europa.eu/content/legal-notice/legal-notice.html);
  - NITE-CMC (Japan), which asks that the source be cited
    (https://www.chem-info.nite.go.jp/en/chem/chrip/chrip_search/html/condUse.html);
  - HCIS, Safe Work Australia, and HSDB (US National Library of Medicine).
  The app shows each source's credit, in plain text, wherever it shows its data (Safety).
- Packages installed by npm and conda are under their own licences.
