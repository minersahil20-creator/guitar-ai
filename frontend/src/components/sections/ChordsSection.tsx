import { useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, Guitar as GuitarIcon, Pause, Play,
  Pencil, Sparkles, Wand2, X,
} from 'lucide-react'
import ChordDiagram from '../ChordDiagram'
import ChordTimeline from '../ChordTimeline'
import Fretboard from '../Fretboard'
import { Badge, ConfidenceBar, Notice, SectionTitle } from '../ui'
import { api, fmtTime } from '../../services/api'
import type { AnalysisResult, ChordSegment } from '../../types'
import type { usePlayer } from '../../hooks/usePlayer'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const QUALITIES: [string, string][] = [
  ['maj', 'Major'], ['min', 'Minor'], ['7', 'Dominant 7'], ['maj7', 'Major 7'],
  ['min7', 'Minor 7'], ['sus2', 'Sus2'], ['sus4', 'Sus4'], ['dim', 'Diminished'],
  ['aug', 'Augmented'], ['m7b5', 'm7♭5'], ['dim7', 'Dim 7'], ['6', 'Major 6'],
  ['min6', 'Minor 6'], ['9', '9'], ['min9', 'Minor 9'], ['maj9', 'Major 9'],
  ['add9', 'Add 9'], ['5', 'Power chord'],
]

// Common guitar strumming patterns (Down / Up / Ghost)
const STRUM_PATTERNS: Record<string, { label: string; beats: { dir: 'D' | 'U' | '-'; sub: string }[] }> = {
  'pop_rock': {
    label: 'Island / Pop-Rock (D - D U - U D U)',
    beats: [
      { dir: 'D', sub: '1' }, { dir: '-', sub: '&' },
      { dir: 'D', sub: '2' }, { dir: 'U', sub: '&' },
      { dir: '-', sub: '3' }, { dir: 'U', sub: '&' },
      { dir: 'D', sub: '4' }, { dir: 'U', sub: '&' },
    ],
  },
  'driving': {
    label: 'Driving 8ths (D D D D D U D U)',
    beats: [
      { dir: 'D', sub: '1' }, { dir: 'D', sub: '&' },
      { dir: 'D', sub: '2' }, { dir: 'D', sub: '&' },
      { dir: 'D', sub: '3' }, { dir: 'U', sub: '&' },
      { dir: 'D', sub: '4' }, { dir: 'U', sub: '&' },
    ],
  },
  'ballad_waltz': {
    label: '3/4 Waltz / Ballad (D - D U D U)',
    beats: [
      { dir: 'D', sub: '1' }, { dir: '-', sub: '&' },
      { dir: 'D', sub: '2' }, { dir: 'U', sub: '&' },
      { dir: 'D', sub: '3' }, { dir: 'U', sub: '&' },
    ],
  },
}

interface Props {
  result: AnalysisResult
  time: number
  onSeek: (t: number) => void
  onResult: (r: AnalysisResult) => void
  player?: ReturnType<typeof usePlayer>
}

export default function ChordsSection({ result, time, onSeek, onResult, player }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [capoFret, setCapoFret] = useState<number>(0)

  const chords = result.chords?.chords ?? []
  const sel: ChordSegment | null = selected != null ? chords[selected] : null
  const activeIdx = chords.findIndex((c) => time >= c.start && time < c.end)
  const nextIdx = activeIdx >= 0 && activeIdx + 1 < chords.length ? activeIdx + 1 : -1
  const shown = sel ?? (activeIdx >= 0 ? chords[activeIdx] : chords[0])
  const nextChord = nextIdx >= 0 ? chords[nextIdx] : null

  // Capo suggestions for campfire/open chords
  const capoSuggestions = useMemo(() => {
    const key = result.overview?.key || ''
    const suggestions: { fret: number; label: string; easyKey: string }[] = []
    if (key.includes('B major') || key.includes('B ') || key.includes('B')) {
      suggestions.push({ fret: 4, label: 'Capo 4', easyKey: 'G shapes (G, C, D, Em)' })
      suggestions.push({ fret: 2, label: 'Capo 2', easyKey: 'A shapes (A, D, E, F#m)' })
    } else if (key.includes('F#') || key.includes('Gb')) {
      suggestions.push({ fret: 2, label: 'Capo 2', easyKey: 'E shapes (E, A, B, C#m)' })
      suggestions.push({ fret: 4, label: 'Capo 4', easyKey: 'D shapes (D, G, A, Bm)' })
    } else if (key.includes('Ab') || key.includes('G#')) {
      suggestions.push({ fret: 1, label: 'Capo 1', easyKey: 'G shapes (G, C, D, Em)' })
      suggestions.push({ fret: 4, label: 'Capo 4', easyKey: 'E shapes (E, A, B, C#m)' })
    } else if (key.includes('Eb') || key.includes('D#')) {
      suggestions.push({ fret: 1, label: 'Capo 1', easyKey: 'D shapes (D, G, A, Bm)' })
      suggestions.push({ fret: 3, label: 'Capo 3', easyKey: 'C shapes (C, F, G, Am)' })
    } else if (key.includes('F major')) {
      suggestions.push({ fret: 1, label: 'Capo 1', easyKey: 'E shapes (E, A, B7)' })
    }
    return suggestions
  }, [result.overview?.key])

  // Select strumming pattern based on meter and BPM
  const strumPattern = useMemo(() => {
    const bpb = result.overview?.beats_per_bar || 4
    if (bpb === 3) return STRUM_PATTERNS['ballad_waltz']
    if ((result.overview?.bpm || 0) > 125) return STRUM_PATTERNS['driving']
    return STRUM_PATTERNS['pop_rock'] || { label: '4/4 Strum', beats: [] }
  }, [result.overview?.beats_per_bar, result.overview?.bpm])

  // Current beat within 8-step subdivision
  const currentSubBeat = useMemo(() => {
    const bpm = result.overview?.bpm || 100
    const spb = 60 / bpm
    const beatIndex = Math.floor(time / (spb / 2))
    const len = strumPattern?.beats?.length || 8
    return beatIndex % len
  }, [time, result.overview?.bpm, strumPattern])

  const save = async (root: number, quality: string) => {
    if (selected == null) return
    setBusy(true); setErr(null)
    try {
      await api.correctChord(result.job_id, selected, { root_pc: root, quality })
      const r = await api.result(result.job_id)
      onResult(r)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  if (!chords.length) {
    return (
      <Notice kind="info" title="No chords detected">
        The audio may be monophonic (a single-line melody), very noisy, or the harmony may be
        too blurred for template matching. Try re-running chord detection with stem separation
        first, or correct the key manually.
      </Notice>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Strum-style Live Play & Transport Bar ── */}
      {player && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-3.5 bg-gradient-to-r from-ink-850 to-ink-900 border-amber-500/20">
          <div className="flex items-center gap-3">
            <button
              onClick={player.toggle}
              disabled={!player.ready}
              className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-md shadow-amber-900/30 transition hover:from-amber-300 disabled:opacity-40">
              {player.playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <div className="font-mono text-xs text-slate-300">
              {fmtTime(time)} <span className="text-slate-600">/ {fmtTime(player.duration || result.overview?.duration || 0)}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
              <span className="font-semibold text-slate-200">{Math.round(result.overview?.bpm || 120)} BPM</span>
              <span>·</span>
              <span className="text-amber-300 font-medium">{result.overview?.key || '—'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider hidden sm:inline">Speed:</span>
            {[0.5, 0.75, 1].map((s) => (
              <button
                key={s}
                onClick={() => player.setTempo(s)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] transition ${
                  Math.abs(player.tempo - s) < 0.01
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200 bg-ink-800'
                }`}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Strum HUD: Current Chord & Next Chord Transition + Strumming Pattern ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Current Active Chord */}
        <div className="card p-3 flex flex-col justify-between border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">Current Chord</span>
            {shown && <span className="text-[10px] font-mono text-slate-400">Bar {shown.bar}</span>}
          </div>
          <div className="my-1.5 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-200 tracking-tight">
              {shown?.name ?? '—'}
            </span>
            {shown && (
              <span className="text-xs text-slate-400 font-mono">
                {((shown.duration ?? (shown.end - shown.start)) || 0).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {shown ? `${(shown.start || 0).toFixed(1)}s – ${(shown.end || 0).toFixed(1)}s` : 'Ready to play'}
          </div>
        </div>

        {/* Upcoming Next Chord */}
        <div className="card p-3 flex flex-col justify-between border-ink-700 bg-ink-850/60">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Up Next</span>
            {nextChord && (
              <span className="text-[10px] font-mono text-sky-400">
                in {Math.max(0, (nextChord.start || 0) - time).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="my-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-200">
              {nextChord?.name ?? '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {nextChord ? `Bar ${nextChord.bar || 1} · prepares hand transition` : 'Song ending'}
          </div>
        </div>

        {/* Strumming Pattern Indicator */}
        <div className="card p-3 flex flex-col justify-between border-ink-700 bg-ink-850/60">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Strumming Pattern</span>
            <span className="text-[10px] text-slate-500 font-mono">4/4 Rhythm</span>
          </div>
          <div className="my-1 flex items-center justify-between gap-1">
            {strumPattern.beats.map((b, i) => {
              const isActiveBeat = player?.playing && currentSubBeat === i
              return (
                <div
                  key={i}
                  className={`flex flex-col items-center flex-1 py-1 rounded transition-all ${
                    isActiveBeat
                      ? 'bg-amber-400 text-ink-950 font-bold scale-110 shadow-sm'
                      : 'bg-ink-800/80 text-slate-400'
                  }`}>
                  {b.dir === 'D' ? (
                    <ArrowDown size={14} className={isActiveBeat ? 'stroke-[2.5]' : ''} />
                  ) : b.dir === 'U' ? (
                    <ArrowUp size={14} className={isActiveBeat ? 'stroke-[2.5]' : ''} />
                  ) : (
                    <span className="h-3.5 flex items-center text-[10px] font-mono text-slate-600">—</span>
                  )}
                  <span className={`text-[8.5px] font-mono ${isActiveBeat ? 'text-ink-950' : 'text-slate-500'}`}>
                    {b.sub}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="text-[10.5px] text-slate-500 truncate">
            {strumPattern.label}
          </div>
        </div>
      </div>

      {/* ── Capo & Easy Chords Assistant (Strum Hallmark Feature) ── */}
      {capoSuggestions.length > 0 && (
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-r from-ink-800/80 to-ink-850 border-ink-700">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/15 text-amber-300">
              <Sparkles size={14} />
            </span>
            <div>
              <div className="text-xs font-semibold text-slate-200">Capo Assistant (Easy Shapes)</div>
              <div className="text-[11px] text-slate-400">
                Playing in {result.overview.key}? Switch to open campfire shapes:
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {capoSuggestions.map((c) => (
              <button
                key={c.fret}
                onClick={() => setCapoFret(capoFret === c.fret ? 0 : c.fret)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                  capoFret === c.fret
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200 font-semibold'
                    : 'border-ink-600 bg-ink-800 text-slate-300 hover:border-amber-500/40 hover:text-amber-200'
                }`}>
                <span className="font-bold">{c.label}:</span> {c.easyKey}
              </button>
            ))}
            {capoFret > 0 && (
              <button
                onClick={() => setCapoFret(0)}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline">
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Chord Timeline (with auto-scrolling playhead) ── */}
      <div>
        <SectionTitle
          title="Chord timeline" icon={<GuitarIcon size={15} />}
          subtitle={`${chords.length} segments · Click any block to seek · Engine: ${result.chords.engine}`}
          right={
            <div className="text-[11px] text-slate-500">
              {capoFret > 0 ? `Transposed for Capo ${capoFret}` : 'Concert Pitch'}
            </div>
          }
        />
        <ChordTimeline
          chords={chords}
          duration={result.overview?.duration || 0}
          currentTime={time}
          beats={result.overview?.beat_times}
          onSeek={onSeek}
          onSelect={(i) => { setSelected(i); setEditing(false) }}
          selected={selected}
        />
      </div>

      {/* progression */}
      <div className="card p-4">
        <SectionTitle title="Progression" subtitle="Repeats collapsed" />
        <div className="flex flex-wrap items-center gap-2">
          {(result.chords.progression ?? []).map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-600">→</span>}
              <span className="rounded-lg border border-ink-600 bg-ink-800/70 px-2.5 py-1 text-sm font-semibold text-amber-200">
                {p.name}
              </span>
              {p.count > 1 && <span className="font-mono text-[10px] text-slate-500">×{p.count}</span>}
            </span>
          ))}
        </div>
        {!!result.chords.roman_numerals?.length && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">In {result.overview.key}:</span>
            {result.chords.roman_numerals.map((r, i) => (
              <span key={i} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">{r}</span>
            ))}
          </div>
        )}
      </div>

      {/* selected chord: diagrams + fretboard + editor */}
      {shown && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <SectionTitle
              title={shown.name}
              subtitle={`${shown.start.toFixed(1)}s – ${shown.end.toFixed(1)}s · bar ${shown.bar}`}
              right={
                <div className="flex items-center gap-2">
                  <ConfidenceBar value={shown.confidence} className="w-28" />
                  {selected != null && (
                    <button onClick={() => setEditing((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
                      <Pencil size={11} /> correct
                    </button>
                  )}
                </div>
              }
            />

            {editing && selected != null ? (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                  <Wand2 size={12} /> Fix this chord
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROOTS.map((r, i) => (
                    <button key={r} onClick={() => save(i, shown.quality)} disabled={busy}
                      className={`rounded-md border px-2 py-1 font-mono text-xs transition ${
                        i === shown.root_pc
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUALITIES.map(([q, label]) => (
                    <button key={q} onClick={() => save(shown.root_pc, q)} disabled={busy}
                      className={`rounded-md border px-2 py-1 text-[11px] transition ${
                        q === shown.quality
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={() => setEditing(false)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300">
                  <X size={11} /> cancel
                </button>
                {err && <p className="mt-1 text-[11px] text-red-300">{err}</p>}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-center gap-2">
              {(shown.diagrams ?? []).length ? (
                shown.diagrams!.map((d, i) => <ChordDiagram key={i} diagram={d} name={shown.name} />)
              ) : (
                <p className="py-6 text-xs text-slate-500">
                  No standard voicing in the library for {shown.name} — the fretboard shows the notes.
                </p>
              )}
            </div>
          </div>

          <div className="card p-4">
            <SectionTitle title="On the fretboard" subtitle="Chord tones" />
            <Fretboard
              mode="chords"
              tuning={result.overview.tuning}
              capo={result.overview.capo || capoFret}
              chord={shown.diagrams?.[0] ?? null}
              frets={12}
            />
          </div>
        </div>
      )}

      {/* chord list table */}
      <div className="card overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-ink-700 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Chord</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Bar</th>
              <th className="px-3 py-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {chords.map((c, i) => (
              <tr key={i}
                onClick={() => { setSelected(i); onSeek(c.start) }}
                className={`cursor-pointer border-b border-ink-800/70 transition ${
                  i === activeIdx ? 'bg-amber-500/10' : 'hover:bg-ink-800/50'}`}>
                <td className="px-3 py-1.5 font-mono text-slate-600">{i + 1}</td>
                <td className="px-3 py-1.5 font-mono text-slate-400">{c.start.toFixed(2)}s</td>
                <td className="px-3 py-1.5 font-semibold text-slate-200">
                  {c.name}{' '}
                  {c.user_corrected && <Badge tone="emerald">edited</Badge>}
                </td>
                <td className="px-3 py-1.5 font-mono text-slate-400">{((c.duration ?? (c.end - c.start)) || 0).toFixed(2)}s</td>
                <td className="px-3 py-1.5 font-mono text-slate-500">{c.bar}</td>
                <td className="px-3 py-1.5"><ConfidenceBar value={c.confidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
