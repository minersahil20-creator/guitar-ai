import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Headphones, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { StemsResult } from '../types'
import { Badge, Notice } from './ui'
import { fmtTime } from '../services/api'

interface Props {
  stems: StemsResult
  jobId: string
}

/**
 * Multi-track stem player and standalone audition studio.
 * Supports playing all stems together with live mute/solo/fader controls,
 * OR previewing single tracks (Guitar isolated, Backing track, or individual stems)
 * instantly with zero buffering lag.
 */
export default function StemMixer({ stems, jobId }: Props) {
  const refs = useRef<Record<string, HTMLAudioElement | null>>({})
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<string | null>(null)

  // Dedicated preview player for individual tracks (Guitar, Backing track, single stem audition)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const [previewTrack, setPreviewTrack] = useState<{ id: string; label: string; url: string } | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const [previewDuration, setPreviewDuration] = useState(0)

  const list = useMemo(() => stems?.stems ?? [], [stems?.stems])

  useEffect(() => {
    const valid = list.filter((s) => s && s.stem)
    setVolumes(Object.fromEntries(valid.map((s) => [s.stem, 0.85])))
    setMuted(Object.fromEntries(valid.map((s) => [s.stem, false])))
    setSolo(null)
    setTime(0)
  }, [list])

  // Track master mixer playback time
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const active = Object.values(refs.current).find((a) => a && !a.paused)
      if (active) setTime(active.currentTime)
    }, 100)
    return () => clearInterval(id)
  }, [playing])

  const anySolo = solo !== null
  const effectiveVolume = (s: string) => {
    if (muted[s]) return 0
    if (anySolo && solo !== s) return 0
    return volumes[s] ?? 0.85
  }

  const stopPreview = () => {
    if (previewRef.current) {
      previewRef.current.pause()
    }
    setPreviewPlaying(false)
  }

  const playAll = async () => {
    stopPreview()
    const els = Object.entries(refs.current)
      .filter(([name, a]) => a && (solo ? name === solo : !muted[name]))
      .map(([, a]) => a!)

    if (els.length === 0) {
      // If all muted, just try playing all
      const allEls = Object.values(refs.current).filter(Boolean) as HTMLAudioElement[]
      await Promise.all(allEls.map((a) => a.play().catch(() => undefined)))
    } else {
      await Promise.all(els.map((a) => a.play().catch(() => undefined)))
    }
    setPlaying(true)
  }

  const pauseAll = () => {
    Object.values(refs.current).forEach((a) => a?.pause())
    setPlaying(false)
  }

  const seekAll = (t: number) => {
    Object.values(refs.current).forEach((a) => {
      if (a) a.currentTime = t
    })
    setTime(t)
  }

  useEffect(() => {
    Object.entries(refs.current).forEach(([stem, el]) => {
      if (el) el.volume = Math.max(0, Math.min(1, effectiveVolume(stem)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumes, muted, solo])

  // Single track preview controls
  const togglePreview = (id: string, label: string, url: string) => {
    if (previewTrack?.id === id && previewPlaying) {
      previewRef.current?.pause()
      setPreviewPlaying(false)
      return
    }

    // Stop multi-track playback first
    pauseAll()

    if (previewTrack?.id !== id) {
      setPreviewTrack({ id, label, url })
      setPreviewTime(0)
      if (previewRef.current) {
        previewRef.current.src = url
        previewRef.current.currentTime = 0
        previewRef.current.play().catch(() => undefined)
        setPreviewPlaying(true)
      }
    } else {
      previewRef.current?.play().catch(() => undefined)
      setPreviewPlaying(true)
    }
  }

  const seekPreview = (t: number) => {
    if (previewRef.current) {
      previewRef.current.currentTime = t
    }
    setPreviewTime(t)
  }

  return (
    <div className="space-y-4">
      {/* Hidden dedicated single-track audition player */}
      <audio
        ref={previewRef}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setPreviewDuration(e.currentTarget.duration || 0)}
        onEnded={() => setPreviewPlaying(false)}
      />

      {stems.is_true_separation ? (
        <Notice kind="info" title="AI Source Separation Active (Meta Demucs htdemucs_6s)">
          <p>
            Stems are separated by deep learning model <strong>htdemucs_6s</strong> into isolated <strong>Guitar</strong>, <strong>Backing Track</strong> (guitar removed), <strong>Vocals</strong>, <strong>Drums</strong>, <strong>Bass</strong>, and <strong>Piano</strong>.
          </p>
        </Notice>
      ) : (
        <Notice kind="info" title="Harmonic & Percussive Stems Active">
          <p>
            Stems are separated using harmonic/percussive decomposition and frequency-band filtering (vocals, bass, drums, guitar harmonic band, and guitar-cut backing track) for zero-latency playback.
          </p>
        </Notice>
      )}

      {/* Headliner Tracks: Guitar Track & Backing Track with direct inline player */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Guitar track card */}
        <div
          className={`card relative overflow-hidden p-4 transition ${
            stems?.guitar?.available ? 'ring-1 ring-amber-500/40 hover:border-amber-500/60' : 'pointer-events-none opacity-40'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  stems?.guitar?.url &&
                  togglePreview('guitar', stems.guitar.label ?? 'Guitar track', stems.guitar.url)
                }
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-md shadow-amber-900/30 transition hover:from-amber-300"
                title={previewTrack?.id === 'guitar' && previewPlaying ? 'Pause guitar' : 'Play guitar solo'}
              >
                {previewTrack?.id === 'guitar' && previewPlaying ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} className="ml-0.5" />
                )}
              </button>
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {stems?.guitar?.label ?? 'Guitar track'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {stems?.guitar?.is_isolated
                    ? 'Isolated guitar stem (Demucs)'
                    : 'Mid-range harmonic band (guitar approximation)'}
                </div>
              </div>
            </div>

            {stems?.guitar?.url && (
              <a
                href={stems.guitar.url}
                download={`${jobId}-guitar.wav`}
                className="rounded-lg border border-ink-600 p-2 text-slate-400 transition hover:border-amber-500/50 hover:text-amber-300"
                title="Download guitar track (.wav)"
              >
                <Download size={15} />
              </a>
            )}
          </div>

          {/* Inline scrubber when previewing guitar */}
          {previewTrack?.id === 'guitar' && (
            <div className="mt-3 flex items-center gap-2 border-t border-ink-700/60 pt-2.5">
              <span className="font-mono text-[11px] text-amber-300">
                {fmtTime(previewTime)} / {fmtTime(previewDuration)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(previewDuration, 0.01)}
                step={0.01}
                value={previewTime}
                onChange={(e) => seekPreview(parseFloat(e.target.value))}
                className="h-1.5 flex-1 accent-amber-500"
              />
            </div>
          )}
        </div>

        {/* Backing track card */}
        <div
          className={`card relative overflow-hidden p-4 transition ${
            stems?.backing?.available ? 'ring-1 ring-sky-500/40 hover:border-sky-500/60' : 'pointer-events-none opacity-40'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  stems?.backing?.url &&
                  togglePreview('backing', stems.backing.label ?? 'Backing track', stems.backing.url)
                }
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-ink-950 shadow-md shadow-sky-900/30 transition hover:from-sky-300"
                title={previewTrack?.id === 'backing' && previewPlaying ? 'Pause backing track' : 'Play backing track'}
              >
                {previewTrack?.id === 'backing' && previewPlaying ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} className="ml-0.5" />
                )}
              </button>
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {stems?.backing?.label ?? 'Backing track'}
                </div>
                <div className="text-[11px] text-slate-400">Play along: all instruments with guitar removed</div>
              </div>
            </div>

            {stems?.backing?.url && (
              <a
                href={stems.backing.url}
                download={`${jobId}-backing.wav`}
                className="rounded-lg border border-ink-600 p-2 text-slate-400 transition hover:border-sky-500/50 hover:text-sky-300"
                title="Download backing track (.wav)"
              >
                <Download size={15} />
              </a>
            )}
          </div>

          {/* Inline scrubber when previewing backing track */}
          {previewTrack?.id === 'backing' && (
            <div className="mt-3 flex items-center gap-2 border-t border-ink-700/60 pt-2.5">
              <span className="font-mono text-[11px] text-sky-300">
                {fmtTime(previewTime)} / {fmtTime(previewDuration)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(previewDuration, 0.01)}
                step={0.01}
                value={previewTime}
                onChange={(e) => seekPreview(parseFloat(e.target.value))}
                className="h-1.5 flex-1 accent-sky-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Multi-track master transport */}
      <div className="card space-y-2 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700/60 pb-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Headphones size={14} className="text-amber-400" /> Multi-Track Stem Mixer
          </div>
          <Badge tone={stems.is_true_separation ? 'emerald' : 'amber'}>
            Engine: {stems.engine}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={playing ? pauseAll : playAll}
            className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-md shadow-amber-900/30 transition hover:from-amber-300"
            title={playing ? 'Pause mixer' : 'Play all stems'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            onClick={() => seekAll(0)}
            className="rounded-lg border border-ink-600 p-2 text-slate-400 hover:text-slate-200"
            title="Rewind to start"
          >
            <RotateCcw size={14} />
          </button>
          <div className="font-mono text-xs text-slate-300">
            {fmtTime(time)} <span className="text-slate-500">/ {fmtTime(duration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={time}
            onChange={(e) => seekAll(parseFloat(e.target.value))}
            className="w-full flex-1 accent-amber-500 sm:w-auto"
          />
        </div>
      </div>

      {/* Mixer strips: each stem */}
      <div className="grid gap-2">
        {list.map((s) => {
          const isSolo = solo === s.stem
          const dim = anySolo && !isSolo
          const isSinglePreviewing = previewTrack?.id === s.stem && previewPlaying

          return (
            <div
              key={s.stem}
              className={`card flex flex-wrap items-center gap-3 p-3 transition ${
                dim ? 'opacity-40' : ''
              } ${s.is_guitar ? 'ring-1 ring-amber-500/40 bg-amber-500/5' : ''}`}
            >
              {/* Quick audition play/pause for this stem alone */}
              <button
                type="button"
                onClick={() => togglePreview(s.stem, s.label, s.url)}
                className={`grid h-8 w-8 place-items-center rounded-full transition ${
                  isSinglePreviewing
                    ? 'bg-amber-400 text-ink-950 ring-2 ring-amber-300'
                    : 'border border-ink-600 text-slate-300 hover:border-amber-500 hover:text-amber-300'
                }`}
                title={isSinglePreviewing ? `Pause ${s.label}` : `Audition ${s.label} solo`}
              >
                {isSinglePreviewing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
              </button>

              <div className="flex min-w-[130px] items-center gap-2">
                <Headphones
                  size={14}
                  className={s.is_guitar ? 'text-amber-400' : 'text-slate-500'}
                />
                <div>
                  <div className="text-xs font-medium text-slate-200">{s.label}</div>
                  <div className="font-mono text-[10px] text-slate-500">{s.stem}</div>
                </div>
              </div>

              {s.silent && (
                <Badge
                  tone="slate"
                  title="This stem is essentially silence — the model found no such instrument in this audio."
                >
                  no content
                </Badge>
              )}

              {/* Mute toggle */}
              <button
                onClick={() => setMuted((m) => ({ ...m, [s.stem]: !m[s.stem] }))}
                className={`rounded-md border p-1.5 transition ${
                  muted[s.stem]
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-ink-600 text-slate-400 hover:text-slate-200'
                }`}
                title={muted[s.stem] ? 'Unmute' : 'Mute'}
              >
                {muted[s.stem] ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>

              {/* Solo toggle */}
              <button
                onClick={() => setSolo(isSolo ? null : s.stem)}
                className={`rounded-md border px-2 py-1 text-[10px] font-bold transition ${
                  isSolo
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-sm'
                    : 'border-ink-600 text-slate-400 hover:text-slate-200'
                }`}
              >
                SOLO
              </button>

              {/* Volume Slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volumes[s.stem] ?? 0.85}
                onChange={(e) =>
                  setVolumes((v) => ({ ...v, [s.stem]: parseFloat(e.target.value) }))
                }
                className="min-w-[100px] flex-1 accent-amber-500"
                title={`Volume: ${Math.round((volumes[s.stem] ?? 0.85) * 100)}%`}
              />

              {/* Download */}
              <a
                href={s.url}
                download={`${jobId}-${s.stem}.wav`}
                className="rounded-md border border-ink-600 p-1.5 text-slate-400 transition hover:border-amber-500/50 hover:text-amber-300"
                title={`Download ${s.stem}.wav`}
              >
                <Download size={13} />
              </a>

              {/* Multi-track audio element */}
              <audio
                ref={(el) => {
                  refs.current[s.stem] = el
                }}
                crossOrigin="anonymous"
                src={s.url}
                preload="metadata"
                onLoadedMetadata={(e) =>
                  setDuration((d) => Math.max(d, e.currentTarget.duration || 0))
                }
                onEnded={() => setPlaying(false)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
