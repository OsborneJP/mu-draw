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
- tests/fixtures/recorded/: answers recorded from PubChem (pubchem.ncbi.nlm.nih.gov).
- Packages installed by npm and conda are under their own licences.
