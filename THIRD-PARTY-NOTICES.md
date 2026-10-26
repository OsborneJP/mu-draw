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
- 3Dmol.js 2.5.5 (npm package 3dmol, bundled into the app's 3Dmol chunk for the 3D view):
  BSD 3-Clause License, Copyright (c) 2014, University of Pittsburgh and contributors; it
  incorporates GLmol (biochem_fan), Three.js (three.js Authors) and jQuery (John Resig),
  under the terms in its LICENSE (web/node_modules/3dmol/LICENSE). Its bundle carries pako
  2.2.0 (MIT and Zlib licences), iobuffer 5.4.0, netcdfjs 3.0.0 and upng-js 2.1.0 (MIT
  licence each). The About box credits it.
- Packages installed by npm and conda are under their own licences.
