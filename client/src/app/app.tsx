import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Dashboard from '../pages/Dashboard';
// import RoomDetail from '../pages/RoomDetail';
import Transcripts from '../pages/Transcripts';
import OidPage from '../pages/OidPage';
import ResidentsPage from '../pages/ResidentsPage';
import ResidentProfilePage from '../pages/ResidentProfilePage';
import NoteSequencePage from '../pages/NoteSequencePage';

export function App() {
  const location = useLocation();
  const isOidPage = location.pathname === '/oid';

  return (
    <>
      {!isOidPage && <Navbar />}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* Old Page */}
        {/* <Route path="/room/:id" element={<RoomDetail />} /> */}
        <Route path="/transcripts" element={<Transcripts />} />
        <Route path="/oid" element={<OidPage />} />
        <Route path="/residents" element={<ResidentsPage />} />
        <Route path="/residents/:id" element={<ResidentProfilePage />} />
        <Route path="/note-sequence" element={<NoteSequencePage />} />
      </Routes>
    </>
  );
}

export default App;
