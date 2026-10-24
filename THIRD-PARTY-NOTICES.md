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
- tests/fixtures/recorded/: answers recorded from PubChem (pubchem.ncbi.nlm.nih.gov).
- Packages installed by npm and conda are under their own licences.
