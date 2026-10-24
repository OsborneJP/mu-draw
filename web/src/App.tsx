import KetcherEditor from './editor/KetcherEditor';
import NamePanel from './panels/NamePanel';
import PropertiesPanel from './panels/PropertiesPanel';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        {/* The canvas, with Get name's answer floating over it. */}
        <div className="canvas-area">
          <KetcherEditor />
          <NamePanel />
        </div>
        <PropertiesPanel />
      </main>
    </div>
  );
}
