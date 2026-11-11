import { useEffect, useMemo } from 'react'
import {
  Gauge, Music2, Pause, Play, Repeat, SkipBack, Timer as MetronomeIcon, Volume2, Zap,
} from 'lucide-react'
import Waveform from '../Waveform'
import ChordTimeline from '../ChordTimeline'
import Fretboard from '../Fretboard'
import { Badge, Notice, SectionTitle } from '../ui'
import type { AnalysisResult } from '../../types'
import type { usePlayer } from '../../hooks/usePlayer'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

interface Props {
  result: AnalysisResult
  player: ReturnType<typeof usePlayer>
}

export default function PracticeSection({ result, player }: Props) {
  const {
    ready, loading, playing, time, duration, preparing, tempo, semitones, keepPitch,
    volume, loop, loopStart, loopEnd, metroOn, setMetroOn, metroBpm, setMetroBpm,
    toggle, seek, setTempo, setSemitones, setKeepPitch, setVolume, setLoopRegion,
    toggleLoop, clearLoop, error,
  } = player

  // keep the metronome locked to the detected tempo by default
  useEffect(() => {
    if (result.overview?.bpm) setMetroBpm(Math.round(result.overview.bpm * tempo))
  }, [result.overview?.bpm, tempo, setMetroBpm])

  const activeChord = useMemo(
    () => result.chords?.chords?.find((c) => time >= c.start && time < c.end),
    [result.chords?.chords, time],
  )
  const activeNote = useMemo(
    () => result.solo?.notes?.find((n) => time >= n.start && time < n.end
      && n.string != null && n.fret != null),
    [result.solo?.notes, time],
  )

  const loopCurrentBar = () => {
    const dbs = result.overview?.downbeat_times ?? []
    if (dbs.length >= 2) {
      const idx = dbs.findIndex((db, i) => time >= db && (i === dbs.length - 1 || time < dbs[i + 1]))
      if (idx >= 0) {
        const start = dbs[idx]
        const end = idx + 1 < dbs.length ? dbs[idx + 1] : Math.min(start + (60 / (result.overview?.bpm || 100)) * 4, result.overview?.duration || duration || 0)
        setLoopRegion(start, end)
        return
      }
    }
    const spb = 60 / Math.max(result.overview?.bpm || 100, 1)
    const barLen = spb * (result.overview?.beats_per_bar || 4)
    const start = Math.floor(time / barLen) * barLen
    setLoopRegion(start, Math.min(start + barLen, result.overview?.duration || duration || 0))
  }

  const loopCurrentChord = () => {
    if (!activeChord) return
    setLoopRegion(activeChord.start, activeChord.end)
  }

  return (
    <div className="space-y-4">
      {/* transport */}
      <div className="card p-4">
        <SectionTitle
          title="Practice studio" icon={<Gauge size={15} />}
          subtitle="Slow it down without changing key, loop the hard bit, play along"
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={keepPitch ? 'emerald' : 'amber'}>
                {keepPitch ? 'pitch preserved' : 'tape mode'}
              </Badge>
              <Badge tone="slate">{tempo.toFixed(2)}×</Badge>
              {semitones !== 0 && (
                <Badge tone="violet">{semitones > 0 ? `+${semitones}` : semitones} st</Badge>
              )}
            </div>
          }
        />

        <Waveform
          peaks={result.media?.waveform || []}
          duration={result.overview?.duration || duration || 0}
          currentTime={time}
          loopStart={loopStart}
          loopEnd={loopEnd}
          beats={result.overview?.beat_times}
          downbeats={result.overview?.downbeat_times}
          onSeek={seek}
          onLoopChange={setLoopRegion}
          height={104}
        />

        {preparing != null && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300">
            <Zap size={12} className="animate-pulse" />
            Time-stretching audio… {preparing}%
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={toggle} disabled={!ready}
            className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-lg shadow-amber-900/30 transition hover:from-amber-300 disabled:opacity-40">
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <button onClick={() => seek(Math.max(0, time - 2))}
            className="rounded-lg border border-ink-600 p-2 text-slate-400 transition hover:text-slate-100">
            <SkipBack size={14} />
          </button>

          <div className="font-mono text-sm text-slate-300">
            {time.toFixed(1)} <span className="text-slate-600">/ {duration.toFixed(1)}s</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Volume2 size={14} className="text-slate-500" />
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-24" />
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button onClick={loopCurrentBar}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-600 px-2 py-1 text-[11px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
              <Repeat size={12} /> loop bar
            </button>
            <button onClick={loopCurrentChord} disabled={!activeChord}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-600 px-2 py-1 text-[11px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40">
              <Repeat size={12} /> loop chord
            </button>
            <button onClick={toggleLoop}
              className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                loop ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-ink-600 text-slate-300 hover:border-amber-500/50'}`}>
              A–B {loop ? 'on' : 'off'}
            </button>
            <button onClick={clearLoop}
              className="rounded-lg border border-ink-600 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200">
              clear
            </button>
          </div>
        </div>

        {/* speed */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
              <Gauge size={12} /> Speed
            </div>
            <div className="flex flex-wrap gap-1">
              {SPEEDS.map((s) => (
                <button key={s} onClick={() => setTempo(s)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition ${
                    Math.abs(tempo - s) < 0.001
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-ink-600 text-slate-400 hover:border-ink-500 hover:text-slate-200'}`}>
                  {s}×
                </button>
              ))}
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-[11.5px] text-slate-400">
              <input type="checkbox" checked={keepPitch}
                onChange={(e) => setKeepPitch(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-500" />
              Keep the pitch when changing speed
              <span className="text-slate-600">(uncheck for tape-style)</span>
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
              <Music2 size={12} /> Pitch shift
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min={-12} max={12} step={1} value={semitones}
                onChange={(e) => setSemitones(parseInt(e.target.value, 10))} className="flex-1" />
              <span className="w-14 shrink-0 text-center font-mono text-xs text-slate-300">
                {semitones > 0 ? `+${semitones}` : semitones} st
              </span>
            </div>
            <p className="mt-1.5 text-[10.5px] text-slate-600">
              Useful for playing along in a different key without retuning.
            </p>
            <button onClick={() => setSemitones(0)}
              className="mt-1.5 text-[10.5px] text-slate-500 underline decoration-dotted hover:text-slate-300">
              reset to original key
            </button>
          </div>
        </div>

        {/* metronome */}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-3">
          <button onClick={() => setMetroOn(!metroOn)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition ${
              metroOn ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-ink-600 text-slate-300 hover:border-amber-500/50'}`}>
            <MetronomeIcon size={13} /> {metroOn ? 'Metronome on' : 'Metronome'}
          </button>
          <div className="flex items-center gap-2">
            <input type="range" min={40} max={240} step={1} value={metroBpm}
              onChange={(e) => setMetroBpm(parseInt(e.target.value, 10))} className="w-36" />
            <span className="font-mono text-xs text-slate-300">{metroBpm} BPM</span>
          </div>
          <button onClick={() => setMetroBpm(Math.round((result.overview?.bpm || 100) * tempo))}
            className="text-[10.5px] text-slate-500 underline decoration-dotted hover:text-slate-300">
            match song ({Math.round((result.overview?.bpm || 100) * tempo)} BPM at {tempo}×)
          </button>
        </div>

        {loading && <p className="mt-2 text-[11px] text-slate-500">Loading audio…</p>}
        {error && <Notice kind="error">{error}</Notice>}
        {!ready && !loading && (
          <Notice kind="info">Press play to load the audio (browsers require a click before sound).</Notice>
        )}
      </div>

      {/* live sync */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <SectionTitle title="Live chord track" subtitle="Highlights as you play" />
          <ChordTimeline
            chords={result.chords?.chords ?? []}
            duration={result.overview?.duration || duration || 0}
            currentTime={time}
            onSeek={seek}
          />
          <div className="mt-3 flex items-center gap-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Now</div>
            <div className="text-2xl font-bold text-amber-300">{activeChord?.name ?? '—'}</div>
            {activeChord && (
              <div className="text-[11px] text-slate-500">
                {(activeChord.confidence * 100).toFixed(0)}% confidence
              </div>
            )}
          </div>
        </div>

        <div className="card p-4">
          <SectionTitle title="Now playing" icon={<Music2 size={15} />} />
          <div className="text-3xl font-bold text-violet-300">
            {activeNote?.name ?? '—'}
          </div>
          {activeNote?.string != null && activeNote.fret != null && (
            <div className="mt-1 font-mono text-xs text-slate-500">
              string {activeNote.string + 1}, fret {activeNote.fret}
            </div>
          )}
          <div className="mt-3">
            <Fretboard
              mode="solo"
              tuning={result.overview?.tuning}
              capo={result.overview?.capo}
              soloNotes={result.solo?.notes ?? []}
              activeNote={activeNote && activeNote.string != null && activeNote.fret != null
                ? { string: activeNote.string, fret: activeNote.fret } : null}
              frets={12}
              showNoteNames={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
