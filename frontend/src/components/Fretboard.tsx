import { useEffect, useMemo, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { pluckNote } from '../lib/audio'
import type { ChordDiagram, Note } from '../types'

/* ── music helpers (kept local so the component is self-contained) ── */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function tuningToMidi(tuning?: string[] | string): number[] {
  if (!tuning || !Array.isArray(tuning)) return [40, 45, 50, 55, 59, 64]
  return tuning.map((t) => {
    if (typeof t !== 'string') return 40
    const m = t.match(/^([A-G]#?)(-?\d)$/)
    if (!m) return 40
    const pc = NAMES.indexOf(m[1])
    return (parseInt(m[2], 10) + 1) * 12 + pc
  })
}
const midiName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

export type FretboardMode = 'notes' | 'chords' | 'scales' | 'solo' | 'tabs'

interface Props {
  tuning?: string[]
  capo?: number
  frets?: number
  mode?: FretboardMode
  /** scale: pitch classes that belong, plus the root to highlight */
  scalePitchClasses?: number[]
  scaleRootPc?: number
  chord?: ChordDiagram | null
  soloNotes?: Note[]
  /** highlighted position while playing (string, fret) */
  activeNote?: { string: number; fret: number } | null
  showNoteNames?: boolean
  onFretClick?: (midi: number, string: number, fret: number) => void
  height?: number
}

const STRING_COLORS = ['#8b93a7', '#8b93a7', '#9aa2b6', '#9aa2b6', '#c9c2ad', '#d8c9a8']

export default function Fretboard({
  tuning = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  capo = 0,
  frets = 15,
  mode = 'notes',
  scalePitchClasses,
  scaleRootPc,
  chord,
  soloNotes,
  activeNote,
  showNoteNames = true,
  onFretClick,
  height,
}: Props) {
  const audioRef = useRef<AudioContext | null>(null)
  const [hover, setHover] = useState<{ s: number; f: number } | null>(null)

  const safeCapo = Number(capo) || 0
  const safeFrets = Math.max(5, Number(frets) || 15)
  const openMidi = useMemo(() => tuningToMidi(tuning).map((m) => m + safeCapo), [tuning, safeCapo])
  const nStrings = openMidi.length

  const getAudio = () => {
    if (!audioRef.current) {
      audioRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    return audioRef.current
  }
  useEffect(() => () => { audioRef.current?.close() }, [])

  // build the set of highlighted (string,fret) cells + their labels
  const marks = useMemo(() => {
    const map = new Map<string, { label: string; kind: 'root' | 'scale' | 'chord' | 'solo' | 'outside'; midi: number; conf?: number }>()
    const key = (s: number, f: number) => `${s}:${f}`

    const put = (s: number, f: number, v: { label: string; kind: 'root' | 'scale' | 'chord' | 'solo' | 'outside'; midi: number; conf?: number }) => {
      const k = key(s, f)
      const prev = map.get(k)
      // a chord/solo marker wins over a plain scale marker
      if (!prev || (prev.kind === 'scale' && v.kind !== 'scale')) map.set(k, v)
    }

    if (mode === 'chords' && chord) {
      chord.frets.forEach((f, s) => {
        if (f >= 0) {
          const midi = openMidi[s] + f
          put(s, f, { label: midiName(midi), kind: 'chord', midi })
        }
      })
    }

    if (mode === 'scales' && scalePitchClasses?.length) {
      const set = new Set(scalePitchClasses)
      for (let s = 0; s < nStrings; s++) {
        for (let f = 0; f <= frets; f++) {
          const midi = openMidi[s] + f
          if (set.has(((midi % 12) + 12) % 12)) {
            const isRoot = ((midi % 12) + 12) % 12 === ((scaleRootPc ?? 0) % 12)
            put(s, f, { label: midiName(midi), kind: isRoot ? 'root' : 'scale', midi })
          }
        }
      }
    }

    if ((mode === 'solo' || mode === 'tabs') && soloNotes?.length) {
      for (const n of soloNotes) {
        if (n.string != null && n.fret != null && n.string < nStrings) {
          put(n.string, n.fret, {
            label: n.name,
            kind: 'solo',
            midi: n.midi,
            conf: n.confidence,
          })
        }
      }
    }
    return map
  }, [mode, chord, scalePitchClasses, scaleRootPc, soloNotes, openMidi, frets, nStrings])

  // geometry
  const padL = 46, padR = 18, padT = 26, padB = 30
  const stringGap = 30
  const boardH = (nStrings - 1) * stringGap
  const fretW = 62
  const width = padL + frets * fretW + padR
  const h = height ?? padT + boardH + padB + 18
  const boardTop = padT + 18

  const fretX = (f: number) => padL + f * fretW
  const stringY = (s: number) => boardTop + (nStrings - 1 - s) * stringGap

  // which frets get inlay dots
  const inlays = [3, 5, 7, 9, 12, 15, 17, 19, 21]

  return (
    <div className="w-full overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${width} ${h}`} style={{ minWidth: Math.min(width, 900) }}>
        <defs>
          <linearGradient id="fbWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22160f" />
            <stop offset="45%" stopColor="#3a2418" />
            <stop offset="100%" stopColor="#1a110c" />
          </linearGradient>
          <linearGradient id="fbNut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8e2d2" />
            <stop offset="100%" stopColor="#a99f8a" />
          </linearGradient>
          <filter id="fbGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* fingerboard */}
        <rect x={padL} y={boardTop - 10} width={frets * fretW} height={boardH + 20}
              fill="url(#fbWood)" rx="3" />

        {/* inlays */}
        {inlays.filter((f) => f <= frets).map((f) => (
          <g key={`in${f}`}>
            {f % 12 === 0 ? (
              <>
                <circle cx={fretX(f) - fretW / 2} cy={boardTop + boardH * 0.28} r="4.5" fill="#5b5348" opacity=".55" />
                <circle cx={fretX(f) - fretW / 2} cy={boardTop + boardH * 0.72} r="4.5" fill="#5b5348" opacity=".55" />
              </>
            ) : (
              <circle cx={fretX(f) - fretW / 2} cy={boardTop + boardH / 2} r="5" fill="#5b5348" opacity=".5" />
            )}
          </g>
        ))}

        {/* frets */}
        {Array.from({ length: frets + 1 }, (_, f) => (
          <line key={`fr${f}`} x1={fretX(f)} y1={boardTop - 10} x2={fretX(f)} y2={boardTop + boardH + 10}
                stroke={f === 0 ? '#d8d2c0' : '#7c8798'} strokeWidth={f === 0 ? 6 : 1.6} opacity={f === 0 ? 1 : 0.75} />
        ))}
        {/* nut cap */}
        <rect x={padL - 6} y={boardTop - 12} width="6" height={boardH + 24} fill="url(#fbNut)" rx="2" />

        {/* fret numbers */}
        {Array.from({ length: frets }, (_, i) => i + 1).map((f) => (
          <text key={`fn${f}`} x={fretX(f) - fretW / 2} y={boardTop + boardH + 30}
                textAnchor="middle" fontSize="10" fill="#5c6478" fontFamily="ui-monospace">
            {f}
          </text>
        ))}

        {/* strings */}
        {openMidi.map((_, s) => (
          <line key={`st${s}`} x1={padL} y1={stringY(s)} x2={padL + frets * fretW} y2={stringY(s)}
                stroke={STRING_COLORS[s] ?? '#9aa2b6'}
                strokeWidth={1.1 + (nStrings - 1 - s) * 0.28} opacity="0.85" />
        ))}

        {/* open-string labels */}
        {openMidi.map((m, s) => (
          <text key={`op${s}`} x={padL - 14} y={stringY(s) + 4} textAnchor="middle"
                fontSize="11" fill="#8b93a7" fontFamily="ui-monospace">
            {midiName(m).replace(/\d/g, '')}
          </text>
        ))}

        {/* capo bar */}
        {capo > 0 && (
          <rect x={fretX(capo) - 5} y={boardTop - 14} width="10" height={boardH + 28}
                rx="4" fill="#fbbf24" opacity="0.85" />
        )}

        {/* hover cell */}
        {hover && (
          <circle cx={fretX(hover.f) - fretW / 2} cy={stringY(hover.s)} r="11"
                  fill="#ffffff" opacity="0.06" />
        )}

        {/* markers */}
        {[...marks.entries()].map(([k, v]) => {
          const [s, f] = k.split(':').map(Number)
          const cx = f === 0 ? padL - 0 : fretX(f) - fretW / 2
          const cy = stringY(s)
          const isActive = activeNote && activeNote.string === s && activeNote.fret === f
          const colors: Record<string, string> = {
            root: '#f87171', scale: '#38bdf8', chord: '#fbbf24',
            solo: '#a78bfa', outside: '#64748b',
          }
          const color = colors[v.kind] ?? '#94a3b8'
          return (
            <g key={k} className="cursor-pointer" onClick={() => {
              getAudio().resume()
              pluckNote(getAudio(), v.midi)
              onFretClick?.(v.midi, s, f)
            }}>
              <circle cx={cx} cy={cy} r={isActive ? 14 : 11.5} fill={color}
                      stroke={isActive ? '#fff' : '#0b0d13'} strokeWidth={isActive ? 2.5 : 1.5}
                      filter={isActive ? 'url(#fbGlow)' : undefined} />
              {showNoteNames && (
                <text x={cx} y={cy + (isActive ? 4.5 : 3.8)} textAnchor="middle"
                      fontSize={isActive ? 11.5 : 9.5} fontWeight="700" fill="#0b0d13"
                      fontFamily="ui-sans-serif" pointerEvents="none">
                  {v.label.replace(/\d/g, '')}
                </text>
              )}
              {v.conf != null && v.conf < 0.45 && (
                <text x={cx} y={cy - 15} textAnchor="middle" fontSize="8" fill="#fbbf24">?</text>
              )}
            </g>
          )
        })}

        {/* muted / open string markers for chord diagrams */}
        {mode === 'chords' && chord && (
          <>
            {chord.frets.map((f, s) => (
              <text key={`mk${s}`} x={padL - 30} y={stringY(s) + 4} textAnchor="middle"
                    fontSize="13" fontWeight="700" fill={f < 0 ? '#ef4444' : '#4ade80'}
                    fontFamily="ui-monospace">
                {f < 0 ? '×' : f === 0 ? '○' : ''}
              </text>
            ))}
          </>
        )}

        {/* invisible hover targets */}
        {openMidi.map((_, s) =>
          Array.from({ length: frets + 1 }, (_, f) => (
            <rect key={`ht${s}-${f}`}
                  x={f === 0 ? padL - 14 : fretX(f) - fretW} y={stringY(s) - 13}
                  width={f === 0 ? 14 : fretW} height="26" fill="transparent"
                  onMouseEnter={() => setHover({ s, f })} onMouseLeave={() => setHover(null)}
                  className="cursor-pointer" />
          )),
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-400">
        <Legend color="#f87171" label="Root" />
        <Legend color="#38bdf8" label="Scale tone" />
        <Legend color="#fbbf24" label="Chord tone" />
        <Legend color="#a78bfa" label="Solo note" />
        <span className="ml-auto inline-flex items-center gap-1">
          <Volume2 size={12} /> click any fret to hear it
        </span>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
