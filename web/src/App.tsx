import KetcherEditor from './editor/KetcherEditor';
import PropertiesPanel from './panels/PropertiesPanel';
import Header from './shell/Header';
import UpdateBanner from './shell/UpdateBanner';

export default function App() {
  return (
    <div className="app">
      <Header />
      <UpdateBanner />
      <main className="workspace">
        <KetcherEditor />
        <PropertiesPanel />
      </main>
    </div>
  );
}
