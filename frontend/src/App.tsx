import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Analyse from './pages/Analyse'
import Chords from './pages/Chords'
import Solo from './pages/Solo'
import Scales from './pages/Scales'
import BackingTrack from './pages/BackingTrack'
import Practice from './pages/Practice'
import Projects from './pages/Projects'
import Settings from './pages/Settings'

export default function App() {
  const location = useLocation()

  return (
    <Layout>
      <ErrorBoundary fallbackTitle="An unexpected application error occurred" resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/analyse" element={<Analyse />} />
          <Route path="/chords" element={<Chords />} />
          <Route path="/solo" element={<Solo />} />
          <Route path="/scales" element={<Scales />} />
          <Route path="/backing-track" element={<BackingTrack />} />
          <Route path="/stems" element={<Navigate to="/backing-track" replace />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}
