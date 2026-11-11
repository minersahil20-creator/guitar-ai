import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AudioWaveform, Disc3, Guitar, Home, ListMusic, Menu, Music4, Scale,
  Settings as SettingsIcon, Sliders, Sparkles, X, CircleDot,
} from 'lucide-react'
import { useAnalysis } from '../context'
import { fmtTime } from '../services/api'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/analyse', label: 'Analyse Song', icon: AudioWaveform },
  { to: '/chords', label: 'Chord Finder', icon: Guitar },
  { to: '/solo', label: 'Solo Transcription', icon: Music4 },
  { to: '/scales', label: 'Scale Finder', icon: Scale },
  { to: '/backing-track', label: 'Make Backing Track', icon: Disc3 },
  { to: '/practice', label: 'Practice Studio', icon: Sliders },
  { to: '/projects', label: 'My Projects', icon: ListMusic },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { result, jobId } = useAnalysis()

  useEffect(() => { setOpen(false); window.scrollTo(0, 0) }, [location.pathname])

  return (
    <div className="flex min-h-screen">
      {/* backdrop (mobile) */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-ink-700 bg-ink-900/95 backdrop-blur transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 shadow-lg shadow-amber-900/30">
            <Guitar size={18} className="text-ink-950" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-gradient">Fretwork AI</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">guitar analysis</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500/15 to-transparent text-amber-200 ring-1 ring-amber-500/25'
                    : 'text-slate-400 hover:bg-ink-800/70 hover:text-slate-100'
                }`}>
              {({ isActive }) => (
                <>
                  <Icon size={16} className={isActive ? 'text-amber-300' : 'text-slate-500 group-hover:text-slate-300'} />
                  <span className="font-medium">{label}</span>
                  {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* current track */}
        {result && (
          <div className="m-3 rounded-lg border border-ink-700 bg-ink-850/70 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
              <CircleDot size={10} className="text-emerald-400" /> loaded
            </div>
            <div className="truncate text-xs font-medium text-slate-200">{result.media?.filename || result.job_id}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
              <span>{fmtTime(result.media?.duration ?? result.overview?.duration ?? 0)}</span>
              <span>·</span>
              <span>{Math.round(result.overview?.bpm || 120)} BPM</span>
              <span>·</span>
              <span>{result.overview?.key || '—'}</span>
            </div>
          </div>
        )}

        <div className="border-t border-ink-700 p-4">
          <div className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-transparent p-2.5 ring-1 ring-violet-500/20">
            <Sparkles size={14} className="text-violet-300" />
            <p className="text-[10.5px] leading-snug text-slate-400">
              Runs fully on your machine. No paid APIs required.
            </p>
          </div>
        </div>
      </aside>

      {/* main */}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-700/70 bg-ink-950/80 px-4 py-3 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} className="text-slate-300" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-slate-100">
              {NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label ?? 'Fretwork AI'}
            </h1>
          </div>
          {jobId && (
            <span className="hidden rounded-md bg-ink-800 px-2 py-1 font-mono text-[10px] text-slate-500 sm:inline">
              {jobId}
            </span>
          )}
        </header>
        <div className="px-4 py-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
