import KetcherEditor from './editor/KetcherEditor';
import NamePanel from './panels/NamePanel';
import NmrPanel from './panels/NmrPanel';
import PracticePanel from './panels/PracticePanel';
import PropertiesPanel from './panels/PropertiesPanel';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        {/* The canvas, with Get name's answer floating over it, and Practice and the NMR
            preview below it. */}
        <div className="canvas-area">
          <KetcherEditor />
          <NamePanel />
          <PracticePanel />
          <NmrPanel />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
