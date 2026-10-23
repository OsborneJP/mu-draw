import './shell.css';
import { useOnline } from './useOnline';

// index.html's <title> is the app's name for this build (staging says so).
const TITLE = document.title;

export default function Header() {
  const online = useOnline();
  return (
    <header className="app-header">
      <span className="app-title">{TITLE}</span>
      <div className="app-header-items">
        {/* Always in the page, so screen readers announce the badge when it appears. */}
        <span role="status">
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
      </div>
    </header>
  );
}
