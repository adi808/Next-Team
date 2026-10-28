import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isDemo } from './lib/supabase';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import Login from './pages/Login';
import ModePicker from './pages/ModePicker';
import Shell from './components/Shell';
import ClubsPage from './pages/admin/ClubsPage';
import ClubPage from './pages/admin/ClubPage';
import ListsPage from './pages/admin/ListsPage';
import TeamsPage from './pages/team/TeamsPage';
import TeamPage, { CoachTeamTab } from './pages/team/TeamPage';
import CoachHome from './pages/team/CoachHome';
import EventPrepPage from './pages/event/EventPrepPage';
import PlayerPage from './pages/player/PlayerPage';
import EventPage from './pages/event/EventPage';
import ProfilePage from './pages/ProfilePage';
import { FamilyChat, FamilyEvents, FamilyHome, FamilySurveys, FamilyTasks } from './pages/family/Family';

function Gate() {
  const { loading, session } = useAuth();
  if (loading) return <p className="center">טוען…</p>;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<ModePicker auto />} />
      <Route path="/pick" element={<ModePicker />} />
      <Route path="/m/:mode" element={<Shell />}>
        <Route path="clubs" element={<ClubsPage />} />
        <Route path="club/:clubId" element={<ClubPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="coach" element={<CoachHome />} />
        <Route path="t/:tab" element={<CoachTeamTab />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="team/:teamId" element={<TeamPage />} />
        <Route path="player/:playerId" element={<PlayerPage />} />
        <Route path="me" element={<ProfilePage />} />
        <Route path="event/:eventId" element={<EventPage />} />
        <Route path="event/:eventId/prep" element={<EventPrepPage />} />
        <Route path="home" element={<FamilyHome />} />
        <Route path="events" element={<FamilyEvents />} />
        <Route path="tasks" element={<FamilyTasks />} />
        <Route path="surveys" element={<FamilySurveys />} />
        <Route path="chat" element={<FamilyChat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// the demo runs inside a sandboxed frame, so it keeps its location in memory
const Router = isDemo ? MemoryRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </Router>
  );
}
