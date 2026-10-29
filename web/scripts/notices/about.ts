// Part 1 of the shipped notices (docs/plans/licence-notices.md, "The notices file").
import { basename } from 'node:path';
import { INDIGO_SOURCE_FILE } from '../../src/shell/thirdParty.ts';

export const ABOUT = `MU Draw: third-party licences and notices
=========================================

MU Draw is built from other people's software and data. This file names each part the app
contains, with its licence and copyright notices, as those licences ask. It is written from the
reviewed records in the app's source (third_party/notices/), and every build is checked
against them.

1. About this file
==================

- MU Draw's own code is under the MIT licence. That licence, and the Apache License 2.0 under
  which EPAM Systems publishes Ketcher and Indigo, cover only their authors' own code. Every
  other part keeps the licence given for it below.
- The source of InChI and cairo, as built into the app's copy of Indigo, comes with the app:
  ${basename(INDIGO_SOURCE_FILE)}, beside this file. Its README lists what EPAM Systems
  changed. cairo is distributed here under the Mozilla Public License 1.1 only.
- Part 2 lists the app's code, part 3 what is inside its two WebAssembly files, and part 4
  the data and ported code in the app itself. The licence texts follow.
`;
