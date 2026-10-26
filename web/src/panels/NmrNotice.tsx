import { CARBON_TABLE_LICENCE_FILE } from '../chem/rdkitFiles';

// NMRShiftDB2's licence notice (its section 4.3), on every prediction of either NMR preview.
// The link opens the copy of the licence the app ships, so it never leaves the app.

const LICENCE_URI = 'https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt';

export default function NmrNotice({ testId }: { testId: string }) {
  return (
    <p className="nmr-notice" data-testid={testId}>
      Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the{' '}
      <a href={CARBON_TABLE_LICENCE_FILE} target="_blank" rel="noopener">
        nmrshiftdb2 Database License
      </a>{' '}
      ({LICENCE_URI}).
    </p>
  );
}
