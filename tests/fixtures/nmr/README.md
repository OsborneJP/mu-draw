# ¹³C NMR preview fixtures

- `compounds.json`, `*.mol`: the test compounds' structures, from PubChem by name
  (`nmr_names.txt`), written by `server/scripts/gen_reference_expected.py` with each
  compound's carbon symmetry classes from server-side RDKit.
- `excerpt.sd`: the test compounds' records from NMRShiftDB2's
  `nmrshiftdb2withsignals.sd`, verbatim, and `reference_spectra.json`, their measured ¹³C
  shifts, both written by `web/scripts/build-carbon-table.ts` (which also leaves these
  compounds out of the shift table). Contains information from nmrshiftdb2
  (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database
  License (`web/public/nmr/LICENSE-nmrshiftdb2.txt`;
  https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt).
- `expected.json`: the signal count for each compound, by judgement (provisional).
- `outliers.json`: the predicted signals more than 3 ppm from the measured shift, recorded
  so they are not hidden; `web/src/chem/nmr.test.ts` fails if the predictions change.
