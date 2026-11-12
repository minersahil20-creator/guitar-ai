import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AudioWaveform, BarChart3, Disc3, Download, Guitar, ListMusic, Loader2, Music4,
  RefreshCw, Scale, Sliders, Sparkles, X,
} from 'lucide-react'
import UploadPanel from '../components/UploadPanel'
import OverviewSection from '../components/sections/OverviewSection'
import ChordsSection from '../components/sections/ChordsSection'
import SoloSection from '../components/sections/SoloSection'
import ScalesSection from '../components/sections/ScalesSection'
import BackingTrackSection from '../components/sections/BackingTrackSection'
import PracticeSection from '../components/sections/PracticeSection'
import AICoach from '../components/AICoach'
import ErrorBoundary from '../components/ErrorBoundary'
import { Card, Notice, ProgressBar, SectionTitle } from '../components/ui'
import { api } from '../services/api'
import { useAnalysis } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import type { AnalysisResult, Project } from '../types'

function AICoachSection({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-4">
      <AICoach ai={result.ai} />
    </div>
  )
}

type TabKey = 'overview' | 'chords' | 'solo' | 'scales' | 'backing' | 'practice' | 'ai'

const TABS: { key: TabKey; label: string; icon: typeof Guitar }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'chords', label: 'Chords', icon: Guitar },
  { key: 'solo', label: 'Solo', icon: Music4 },
  { key: 'scales', label: 'Scales', icon: Scale },
  { key: 'backing', label: 'Backing Track', icon: Disc3 },
  { key: 'practice', label: 'Practice', icon: Sliders },
]

export default function Analyse() {
  const { result, setResult, job, loading, error, clear } = useAnalysis()
  const [tab, setTab] = useState<TabKey>('overview')
  const [projects, setProjects] = useState<Project[]>([])
  const player = usePlayer(result?.media.url)

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects.slice(0, 6))).catch(() => {})
  }, [result?.job_id])

  const seek = (t: number) => { void player.seek(t) }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-8">
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15">
            <Loader2 className="animate-spin text-amber-400" size={24} />
          </div>
          <h2 className="text-lg font-semibold text-slate-100">Analysing your track</h2>
          <p className="mt-1 text-sm text-slate-500">
            {job?.message || 'Starting…'}
          </p>
        </div>
        <ProgressBar value={job?.progress ?? 5} />
        <div className="flex justify-between font-mono text-[11px] text-slate-600">
          <span>{job?.stage}</span>
          <span>{job?.progress ?? 0}%</span>
        </div>
        <Card>
          <ol className="space-y-1.5 text-[12px]">
            {[
              ['download', 'Fetching audio from link'],
              ['load', 'Decoding audio'],
              ['features', 'Tempo, beats, key, chroma'],
              ['chords', 'Chord recognition'],
              ['separation', 'Stem separation (slow on CPU)'],
              ['transcription', 'Note transcription'],
              ['tabs', 'Fingering + tablature'],
              ['scales', 'Scale matching'],
              ['ai', 'Writing explanations'],
            ].map(([k, label]) => {
              const order = ['queued', 'download', 'load', 'features', 'chords', 'separation', 'transcription', 'tabs', 'scales', 'assemble', 'ai', 'save', 'done']
              const cur = order.indexOf(job?.stage ?? 'queued')
              const mine = order.indexOf(k)
              const done = cur > mine
              const active = cur === mine
              return (
                <li key={k} className={`flex items-center gap-2 ${done ? 'text-slate-500' : active ? 'text-amber-300' : 'text-slate-600'}`}>
                  <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${
                    done ? 'bg-emerald-500/20 text-emerald-400' : active ? 'bg-amber-500/25 text-amber-300' : 'bg-ink-700'}`}>
                    {done ? '✓' : active ? '•' : ''}
                  </span>
                  {label}
                </li>
              )
            })}
          </ol>
        </Card>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-100">Analyse a song</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload a recording of guitar playing — your own, or anything you have permission to use.
          </p>
        </div>
        <UploadPanel />
        {error && <Notice kind="error">{error}</Notice>}
        {!!projects.length && (
          <div>
            <SectionTitle title="Recent projects" subtitle="Jump back into an earlier analysis" />
            <div className="grid gap-2 sm:grid-cols-2">
              {projects.map((p) => (
                <Link key={p.id} to="/projects"
                  className="card flex items-center gap-3 p-3 transition hover:border-amber-500/40">
                  <ListMusic size={14} className="text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{p.name}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {p.key} · {Math.round(p.bpm ?? 0)} BPM · {p.chord_count ?? 0} chords
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const onResult = (r: AnalysisResult) => setResult(r)

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AudioWaveform size={16} className="text-amber-400" />
            <h2 className="truncate text-base font-semibold text-slate-100">{result.media?.filename || result.job_id}</h2>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
            <span>{Math.round(result.overview?.bpm || 120)} BPM</span><span>·</span>
            <span>{result.overview?.key || '—'}</span><span>·</span>
            <span>{result.overview?.time_signature || '4/4'}</span><span>·</span>
            <span>{(result.overview?.duration ?? result.media?.duration ?? 0).toFixed(1)}s</span><span>·</span>
            <span>{result.overview?.chord_count || 0} chords</span><span>·</span>
            <span>{result.overview?.note_count || 0} notes</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={api.exportUrl.tab(result.job_id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
            <Download size={12} /> tab
          </a>
          <a href={api.exportUrl.midi(result.job_id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
            <Download size={12} /> midi
          </a>
          <a href={api.exportUrl.chords(result.job_id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
            <Download size={12} /> chords
          </a>
          <a href={api.exportUrl.json(result.job_id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
            <Download size={12} /> json
          </a>
          <button onClick={clear}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-[11.5px] text-slate-400 transition hover:border-red-500/40 hover:text-red-300">
            <X size={12} /> close
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1 border-b border-ink-700 pb-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition ${
              tab === key
                ? 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30'
                : 'text-slate-400 hover:bg-ink-800/70 hover:text-slate-200'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
        <button onClick={() => setTab('ai')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition ${
            tab === 'ai'
              ? 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/30'
              : 'text-slate-400 hover:bg-ink-800/70 hover:text-slate-200'}`}>
          <Sparkles size={14} /> AI coach
        </button>
      </div>

      <div className="animate-fade-up">
        {tab === 'overview' && (
          <ErrorBoundary fallbackTitle="Could not load Overview section">
            <OverviewSection result={result} time={player.time} onSeek={seek} />
          </ErrorBoundary>
        )}
        {tab === 'chords' && (
          <ErrorBoundary fallbackTitle="Could not load Chords section">
            <ChordsSection result={result} time={player.time} onSeek={seek} onResult={onResult} player={player} />
          </ErrorBoundary>
        )}
        {tab === 'solo' && (
          <ErrorBoundary fallbackTitle="Could not load Solo section">
            <SoloSection result={result} time={player.time} onSeek={seek} onResult={onResult} player={player} />
          </ErrorBoundary>
        )}
        {tab === 'scales' && (
          <ErrorBoundary fallbackTitle="Could not load Scales section">
            <ScalesSection result={result} onSeek={seek} />
          </ErrorBoundary>
        )}
        {tab === 'backing' && (
          <ErrorBoundary fallbackTitle="Could not load Backing Track section">
            <BackingTrackSection result={result} onResult={onResult} />
          </ErrorBoundary>
        )}
        {tab === 'practice' && (
          <ErrorBoundary fallbackTitle="Could not load Practice Studio section">
            <PracticeSection result={result} player={player} />
          </ErrorBoundary>
        )}
        {tab === 'ai' && (
          <ErrorBoundary fallbackTitle="Could not load AI Coach section">
            <AICoachSection result={result} />
          </ErrorBoundary>
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="flex items-center gap-2 pt-2 text-[11px] text-slate-600">
        <RefreshCw size={11} />
        Want a second opinion? Re-run individual stages from their own pages —
        Chord Finder, Solo Transcription, Scale Finder and Stem Separation each have a
        re-run button that uses the same uploaded audio.
      </div>
    </div>
  )
}
