import { useSyncExternalStore } from 'react';
import { getSaveStatus, subscribeSaveStatus } from '../editor/autosave';
import CopyImageButton from '../panels/CopyImageButton';
import ExportDialog from '../panels/ExportDialog';
import GetNameButton from '../panels/GetNameButton';
import NameToStructure from '../panels/NameToStructure';
import PracticeButton from '../panels/PracticeButton';
import AboutBox from './AboutBox';
import './shell.css';
import { useOnline } from './useOnline';

// index.html's <title> is the app's name for this build (staging says so). Its first word,
// "MU", is in gold.
const TITLE = document.title;
const [MARK, ...REST] = TITLE.split(' ');

export default function Header() {
  const online = useOnline();
  const saveStatus = useSyncExternalStore(subscribeSaveStatus, getSaveStatus);
  return (
    <header className="app-header">
      <span className="app-title" data-testid="app-title">
        <span className="app-title-mark">{MARK}</span> {REST.join(' ')}
      </span>
      <div className="app-header-items">
        {/* Always in the page, so screen readers announce a badge when it appears. */}
        <span role="status" className="app-header-items">
          {saveStatus === 'failed' && (
            <span
              className="warning-badge"
              data-testid="autosave-failed-badge"
              title="This browser would not store the drawing (it may be too large). Save it to a file to keep it."
            >
              Not autosaved
            </span>
          )}
          {!online && (
            <span
              className="offline-badge"
              data-testid="offline-badge"
              title="No internet connection. Drawing still works."
            >
              Offline
            </span>
          )}
        </span>
        <PracticeButton />
        <NameToStructure />
        <GetNameButton />
        <CopyImageButton />
        <ExportDialog />
        <AboutBox title={TITLE} />
      </div>
    </header>
  );
}
