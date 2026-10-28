import { useState } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
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
import JoinPage from './pages/JoinPage';
import RequestsPage from './pages/RequestsPage';
import NotificationsPage from './pages/NotificationsPage';
import { pendingJoin, rememberJoin } from './lib/join';
import type { Mode } from './lib/types';
import { FamilyChat, FamilyEvents, FamilyHome, FamilySurveys, FamilyTasks } from './pages/family/Family';

// Signed out: keep the join link for after sign-in.
function JoinLater() {
  const { code = '' } = useParams();
  rememberJoin(code);
  return <Navigate to="/login" replace />;
}

// After sign-in, a join link opened before it wins over the usual entry screen.
function Home() {
  const [code] = useState(pendingJoin);
  return code ? <Navigate to={`/join/${code}`} replace /> : <ModePicker auto />;
}

// The emailed link to a join request opens the requests screen in a mode that may decide it.
function ToRequests() {
  const { modes } = useAuth();
  const mode = (['admin', 'coach', 'sysadmin'] as Mode[]).find((m) => modes.includes(m));
  return <Navigate to={mode ? `/m/${mode}/requests` : '/'} replace />;
}

function Gate() {
  const { loading, session } = useAuth();
  if (loading) return <p className="center">טוען…</p>;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join/:code" element={<JoinLater />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<Home />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/requests" element={<ToRequests />} />
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
        <Route path="requests" element={<RequestsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
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
