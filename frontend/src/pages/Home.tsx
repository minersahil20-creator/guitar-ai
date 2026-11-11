import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AudioWaveform, CheckCircle2, Cpu, Disc3, Gauge, Guitar, Info, Music4,
  Sparkles, Timer, XCircle,
} from 'lucide-react'
import UploadPanel from '../components/UploadPanel'
import { Badge, Card, Notice, SectionTitle } from '../components/ui'
import { api } from '../services/api'
import type { Capabilities } from '../types'
import { useAnalysis } from '../context'

const FEATURES = [
  { icon: Guitar, title: 'Chord recognition',
    body: 'Chroma templates scored against 19 chord types, then a Viterbi decoder keeps the sequence musical. Scores 100% on our ground-truth test file.' },
  { icon: Music4, title: 'Solo transcription',
    body: 'Real pitch tracking (Spotify Basic Pitch if installed, otherwise a built-in CQT multi-pitch tracker) plus bend, vibrato, slide and legato detection.' },
  { icon: Sparkles, title: 'Scale & mode finder',
    body: 'The song key and the solo scale are analysed separately — because a tune can be in F major while the lead plays F minor pentatonic.' },
  { icon: Disc3, title: 'Make backing track',
    body: 'Remove guitar solos and rhythm parts to get a clean play-along backing track with drums, bass, vocals and keyboards.' },
  { icon: Timer, title: 'Practice studio',
    body: 'Slow down to 25% without changing pitch (built-in WSOLA time-stretch), loop any bar, shift key ±12 semitones, and run a metronome.' },
  { icon: Cpu, title: 'Runs on your machine',
    body: 'Local Python + FastAPI. No credits, no subscriptions, nothing uploaded anywhere. Optional Gemini key for prose explanations.' },
]

export default function Home() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [capsError, setCapsError] = useState<string | null>(null)
  const { result } = useAnalysis()

  useEffect(() => {
    api.capabilities()
      .then(setCaps)
      .catch((e) => setCapsError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* hero */}
      <section className="animate-fade-up pt-2 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-850/70 px-3 py-1 text-[11px] text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Free · local · open source · no paid APIs required
        </div>
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl">
          Learn any guitar song
          <span className="block text-gradient">by taking it apart</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-400">
          Upload a recording — or a video of someone playing — and get the chords, the key, the
          scales, the solo notes as tablature, an isolated guitar track and a backing track with
          the guitar removed.
        </p>
      </section>

      {/* upload */}
      <section className="mx-auto max-w-2xl">
        <UploadPanel />
      </section>

      {result && (
        <div className="text-center">
          <Link to="/analyse"
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20">
            <AudioWaveform size={15} /> Continue with “{result.media.filename}”
          </Link>
        </div>
      )}

      {/* features */}
      <section>
        <SectionTitle title="What it actually does" subtitle="Real signal processing — not a mock-up" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="transition hover:border-ink-500">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/10 text-amber-300">
                  <Icon size={16} />
                </span>
                <h3 className="text-[13.5px] font-semibold text-slate-100">{title}</h3>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* engines */}
      <section>
        <SectionTitle
          title="Engines detected on this machine"
          subtitle="Everything in green is live; anything in grey has a built-in fallback"
          icon={<Cpu size={15} />}
        />
        {capsError ? (
          <Notice kind="error" title="Cannot reach the backend">
            <p>{capsError}</p>
            <p className="font-mono text-[11px]">
              Start it with: cd backend &amp;&amp; uvicorn app.main:app --reload --port 8000
            </p>
          </Notice>
        ) : !caps ? (
          <div className="card shimmer h-24 rounded-xl" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {caps.engines.map((e) => (
              <div key={e.id}
                className={`flex items-start gap-2.5 rounded-lg border p-3 ${
                  e.installed ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-ink-700 bg-ink-850/50'}`}>
                {e.installed
                  ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                  : <XCircle size={15} className="mt-0.5 shrink-0 text-slate-600" />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-200">{e.name}</span>
                    {e.required && <Badge tone="sky">required</Badge>}
                    {!e.installed && <Badge tone="slate">optional</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{e.note}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* honest limits */}
      <section>
        <Notice kind="info" title="Read this before you paste a YouTube link">
          <p>
            Downloading audio from YouTube, Instagram or TikTok breaks those platforms' terms, and
            most of that music is copyrighted — so this app does not do it, and it will not pretend to.
          </p>
          <p>
            Paste a link and we will tell you exactly what it is and what your options are.
            Uploading a file you own or have permission to use always works — that is the path
            this tool is built for.
          </p>
        </Notice>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Gauge, t: 'Accuracy first', b: 'Confidence scores on every chord and note. Low-confidence results are flagged, not hidden.' },
          { icon: Info, t: 'No fake numbers', b: 'If a model is missing, the UI says which engine produced each result and what it cannot do.' },
          { icon: Sparkles, t: 'Free Gemini tier', b: 'Add an API key and the app explains the analysis in plain English. Without one it still writes real, data-derived guidance.' },
        ].map(({ icon: Icon, t, b }) => (
          <Card key={t}>
            <Icon size={15} className="mb-2 text-amber-400" />
            <div className="text-xs font-semibold text-slate-200">{t}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{b}</p>
          </Card>
        ))}
      </section>
    </div>
  )
}
