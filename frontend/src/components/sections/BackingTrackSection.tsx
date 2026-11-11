import { useState, useRef } from 'react'
import {
  CheckCircle2, Disc3, Download, FastForward, Headphones,
  Layers, Music2, Pause, Play, RefreshCw, RotateCcw,
  Sparkles, Volume2, XCircle, Zap
} from 'lucide-react'
import { Badge, Notice, Spinner } from '../ui'
import { api, fmtTime, pollJob } from '../../services/api'
import type { AnalysisResult } from '../../types'

interface Props {
  result: AnalysisResult
  onResult: (r: AnalysisResult) => void
}

export default function BackingTrackSection({ result, onResult }: Props) {
  const [soloOnly, setSoloOnly] = useState(true)
  const [strength, setStrength] = useState<number>(0.85)
  const [mode, setMode] = useState<'fast' | 'ai'>('fast')
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [activeTrack, setActiveTrack] = useState<'backing' | 'guitar' | 'rhythm' | 'original'>('backing')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(0.9)

  const hasBacking = Boolean(result?.stems?.backing?.available || result?.backing?.available)
  const backingUrl = result?.stems?.backing?.url || result?.backing?.url
  const guitarUrl = result?.stems?.guitar?.url || result?.guitar?.url
  const rhythmUrl = result?.rhythm_guitar?.url || result?.stems?.rhythm_guitar?.url
  const originalUrl = result?.media?.url

  const currentUrl =
    activeTrack === 'backing' ? backingUrl :
    activeTrack === 'guitar' ? guitarUrl :
    activeTrack === 'rhythm' ? rhythmUrl : originalUrl

  const togglePlay = () => {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play().catch(() => undefined)
      setPlaying(true)
    }
  }

  const changeTrack = (track: 'backing' | 'guitar' | 'rhythm' | 'original') => {
    if (track === activeTrack) return
    const wasPlaying = playing
    setActiveTrack(track)
    if (audioRef.current) {
      const savedTime = audioRef.current.currentTime
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = savedTime
          if (wasPlaying) {
            audioRef.current.play().catch(() => undefined)
            setPlaying(true)
          }
        }
      }, 50)
    }
  }

  const handleSeek = (t: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = t
    }
    setCurrentTime(t)
  }

  const handleSpeed = (rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) {
      audioRef.current.playbackRate = rate
    }
  }

  const handleVolume = (v: number) => {
    setVolume(v)
    if (audioRef.current) {
      audioRef.current.volume = v
    }
  }

  const makeBacking = async (selectedMode: 'fast' | 'ai' = mode) => {
    if (!result) return
    setRunning(true)
    setErr(null)
    setProgressPct(5)
    setMsg(
      soloOnly
        ? 'Removing lead guitar solo (keeping rhythm guitar, bass & keys)…'
        : 'Removing all guitar frequencies…'
    )
    try {
      const { job_id } = await api.makeBackingTrack(result.job_id, {
        mode: selectedMode,
        solo_only: soloOnly,
        strength,
      })
      await pollJob(job_id, (j) => {
        setProgressPct(j.progress || 0)
        setMsg(j.message ? `${j.stage}: ${j.message}` : `${j.stage}…`)
      })
      const updated = await api.result(result.job_id)
      onResult(updated)
      setActiveTrack('backing')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      setMsg('')
      setProgressPct(0)
    }
  }

  return (
    <div className="space-y-4">
      {/* Hidden audio element */}
      {currentUrl && (
        <audio
          ref={audioRef}
          src={currentUrl}
          crossOrigin="anonymous"
          preload="auto"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
        />
      )}

      {err && <Notice kind="error">{err}</Notice>}

      {/* ── INSTRUMENTS PRESERVATION STATUS BAR ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/80 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          <div>
            <span className="font-semibold text-slate-200">Bass Guitar</span>
            <span className="block text-[10px] text-emerald-400/90">100% Intact</span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/80 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          <div>
            <span className="font-semibold text-slate-200">Drums / Beat</span>
            <span className="block text-[10px] text-emerald-400/90">100% Intact</span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/80 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          <div>
            <span className="font-semibold text-slate-200">Keys / Piano</span>
            <span className="block text-[10px] text-emerald-400/90">Intact</span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-900/80 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          <div>
            <span className="font-semibold text-slate-200">Rhythm Guitar</span>
            <span className="block text-[10px] text-emerald-400/90">{soloOnly ? 'Kept for Jamming' : 'Cut'}</span>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs sm:col-span-1">
          <XCircle size={14} className="shrink-0 text-amber-400" />
          <div>
            <span className="font-semibold text-amber-200">Lead Solo</span>
            <span className="block text-[10px] text-amber-400">Removed</span>
          </div>
        </div>
      </div>

      {hasBacking ? (
        <div className="space-y-4">
          <div className="card relative overflow-hidden border-amber-500/30 bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950 p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700/60 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-lg shadow-amber-900/40">
                  <Disc3 size={24} className={playing ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-100">
                      {activeTrack === 'backing' ? 'Jam Backing Track (Solo Removed)' :
                       activeTrack === 'guitar' ? 'Extracted Guitar Solo Track' :
                       activeTrack === 'rhythm' ? 'Rhythm Guitar & Keys Chords' : 'Original Full Track'}
                    </h2>
                    <Badge tone={activeTrack === 'backing' ? 'emerald' : activeTrack === 'guitar' ? 'violet' : activeTrack === 'rhythm' ? 'sky' : 'slate'}>
                      {activeTrack === 'backing' ? 'Ready to Jam' : activeTrack === 'guitar' ? 'Solo Only' : activeTrack === 'rhythm' ? 'Chords & Rhythm' : 'Full Mix'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">
                    {activeTrack === 'backing'
                      ? 'Rhythm guitar, bass, drums, and keys are playing! Plug in your guitar and solo over the track.'
                      : activeTrack === 'guitar'
                      ? 'Listen to the isolated lead guitar solo to master the phrasing and technique.'
                      : activeTrack === 'rhythm'
                      ? 'Isolated rhythm section chords and harmonic bed.'
                      : 'The full song with all instruments and original guitars.'}
                  </p>
                </div>
              </div>

              {backingUrl && (
                <a
                  href={backingUrl}
                  download={`${result.job_id}-backing-track.wav`}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-950/40 transition hover:from-emerald-400 hover:to-emerald-500"
                >
                  <Download size={14} /> Download Jam Track (.wav)
                </a>
              )}
            </div>

            {/* A/B Track Selector */}
            <div className="my-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => changeTrack('backing')}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                  activeTrack === 'backing'
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50'
                    : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Disc3 size={14} /> Backing Track (Jam Ready)
              </button>
              {guitarUrl && (
                <button
                  type="button"
                  onClick={() => changeTrack('guitar')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                    activeTrack === 'guitar'
                      ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/50'
                      : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Headphones size={14} /> Isolated Guitar Solo
                </button>
              )}
              {rhythmUrl && (
                <button
                  type="button"
                  onClick={() => changeTrack('rhythm')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                    activeTrack === 'rhythm'
                      ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/50'
                      : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers size={14} /> Rhythm Guitars & Chords
                </button>
              )}
              {originalUrl && (
                <button
                  type="button"
                  onClick={() => changeTrack('original')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                    activeTrack === 'original'
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                      : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Music2 size={14} /> Original Full Mix
                </button>
              )}
            </div>

            {/* Transport Controls */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-amber-300">{fmtTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="h-2 flex-1 accent-amber-500"
                />
                <span className="font-mono text-xs text-slate-500">{fmtTime(duration)}</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSeek(0)}
                    className="rounded-lg border border-ink-700 bg-ink-800/80 p-2 text-slate-400 transition hover:text-slate-200"
                    title="Rewind to start"
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-md shadow-amber-900/30 transition hover:from-amber-300"
                    title={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">Practice Speed:</span>
                  {[0.5, 0.75, 1, 1.25].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSpeed(s)}
                      className={`rounded px-2 py-0.5 font-mono text-[11px] transition ${
                        Math.abs(playbackRate - s) < 0.01
                          ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                          : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Volume2 size={15} className="text-slate-500" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => handleVolume(parseFloat(e.target.value))}
                    className="w-20 accent-amber-500"
                    title={`Volume: ${Math.round(volume * 100)}%`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Re-generate Option Bar */}
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-200">Backing Track Settings</div>
                <div className="text-[11px] text-slate-400">
                  Choose how much guitar to attenuate and which separation engine to use
                </div>
              </div>

              <button
                type="button"
                onClick={() => makeBacking(mode)}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:opacity-50"
              >
                {running ? <Spinner className="mr-1" /> : <RefreshCw size={13} />}
                {running ? 'Updating…' : 'Re-make Backing Track'}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
                <span className="block text-[11px] font-medium text-slate-400">Target:</span>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setSoloOnly(true)}
                    className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      soloOnly
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                        : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Solo Only (Keep Rhythm)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSoloOnly(false)}
                    className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      !soloOnly
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                        : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Cut All Guitars
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
                <span className="block text-[11px] font-medium text-slate-400">Solo Cut Strength:</span>
                <div className="mt-1 flex gap-1">
                  {[
                    { label: '85% (Natural)', val: 0.85 },
                    { label: '100% (Mute)', val: 1.0 },
                    { label: '70% (Guide)', val: 0.70 },
                  ].map((s) => (
                    <button
                      key={s.val}
                      type="button"
                      onClick={() => setStrength(s.val)}
                      className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
                        Math.abs(strength - s.val) < 0.05
                          ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                          : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
                <span className="block text-[11px] font-medium text-slate-400">Engine:</span>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setMode('fast')}
                    className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      mode === 'fast'
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                        : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap size={11} className="mr-1 inline" /> Instant (2s)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('ai')}
                    className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      mode === 'ai'
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                        : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles size={11} className="mr-1 inline" /> Deep AI
                  </button>
                </div>
              </div>
            </div>

            {running && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-2">
                    <Spinner className="h-3 w-3 text-amber-400" /> {msg || 'Processing track…'}
                  </span>
                  <span className="font-mono text-amber-400">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-900">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
                    style={{ width: `${Math.max(5, progressPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card space-y-5 p-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-xl shadow-amber-900/30">
            <Disc3 size={32} />
          </div>

          <div className="mx-auto max-w-md space-y-1">
            <h2 className="text-lg font-bold text-slate-100">Make Backing Track</h2>
            <p className="text-xs leading-relaxed text-slate-400">
              Selectively remove the lead guitar solo while keeping rhythm guitars, bassline, drums, and keyboards so you can jam along.
            </p>
          </div>

          <div className="mx-auto grid max-w-lg gap-3 text-left sm:grid-cols-2">
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
              <span className="text-xs font-semibold text-slate-300">Solo Removal Mode</span>
              <div className="mt-2 space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="radio"
                    name="modalSoloOnly"
                    checked={soloOnly}
                    onChange={() => setSoloOnly(true)}
                    className="accent-amber-500"
                  />
                  <span>Solo Only (Keep Rhythm, Bass & Keys)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="radio"
                    name="modalSoloOnly"
                    checked={!soloOnly}
                    onChange={() => setSoloOnly(false)}
                    className="accent-amber-500"
                  />
                  <span>Full Cut (Remove All Guitars)</span>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
              <span className="text-xs font-semibold text-slate-300">Processing Engine</span>
              <div className="mt-2 space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input
                    type="radio"
                    name="modalMode"
                    checked={mode === 'fast'}
                    onChange={() => setMode('fast')}
                    className="accent-amber-500"
                  />
                  <span>Instant (2s spectral subtraction)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                  <input
                    type="radio"
                    name="modalMode"
                    checked={mode === 'ai'}
                    onChange={() => setMode('ai')}
                    className="accent-amber-500"
                  />
                  <span>Deep AI (Demucs neural model)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => makeBacking(mode)}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-6 py-3 text-sm font-bold text-ink-950 shadow-lg shadow-amber-900/40 transition hover:from-amber-300 disabled:opacity-50"
            >
              {running ? <Spinner /> : <Disc3 size={17} />}
              {running ? msg || 'Removing solo…' : 'Make Backing Track Now'}
            </button>
          </div>

          {running && (
            <div className="mx-auto max-w-md space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="flex items-center gap-2">
                  <Spinner className="h-3 w-3 text-amber-400" /> {msg || 'Processing track…'}
                </span>
                <span className="font-mono text-amber-400">{progressPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-900">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
                  style={{ width: `${Math.max(5, progressPct)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
