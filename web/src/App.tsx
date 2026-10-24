import KetcherEditor from './editor/KetcherEditor';
import NamePanel from './panels/NamePanel';
import NmrPanel from './panels/NmrPanel';
import PropertiesPanel from './panels/PropertiesPanel';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        {/* The canvas, with Get name's answer and the NMR preview floating over it. */}
        <div className="canvas-area">
          <KetcherEditor />
          <NamePanel />
          <NmrPanel />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
