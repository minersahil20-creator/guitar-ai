import { useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { pluckNote } from '../lib/audio'
import type { ChordDiagram as Diagram } from '../types'

interface Props {
  diagram: Diagram
  name?: string
  compact?: boolean
}

const ROMAN_FINGERS = ['', '1', '2', '3', '4']

/** A chord "box": vertical = strings (low E on the left), horizontal = frets. */
export default function ChordDiagram({ diagram, name, compact = false }: Props) {
  const audio = useRef<AudioContext | null>(null)
  const [strumming, setStrumming] = useState(false)

  const strings = diagram.frets.length
  const maxFret = Math.max(...diagram.frets.filter((f) => f > 0), 4)
  const minFret = Math.min(...diagram.frets.filter((f) => f > 0), 1)
  const startFret = maxFret <= 4 ? 1 : minFret
  const rows = Math.max(4, maxFret <= 4 ? 4 : 5)

  const w = compact ? 92 : 126
  const h = compact ? 108 : 150
  const padX = compact ? 16 : 22
  const padTop = compact ? 20 : 28
  const padBottom = compact ? 18 : 22
  const gridW = w - padX * 2
  const gridH = h - padTop - padBottom
  const colW = gridW / (strings - 1)
  const rowH = gridH / (rows - 1)

  const strum = () => {
    if (!audio.current) {
      audio.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    const ctx = audio.current
    ctx.resume()
    setStrumming(true)
    setTimeout(() => setStrumming(false), 420)
    // open-string base so we can sound any fret without knowing the tuning
    const BASE = [40, 45, 50, 55, 59, 64, 35]
    diagram.frets.forEach((f, i) => {
      if (f < 0) return
      const open = BASE[i] ?? 64
      pluckNote(ctx, open + f, i * 0.035, 0.28)
    })
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="text-sm font-semibold tracking-wide text-amber-300">
        {name ?? diagram.name}
      </div>
      <svg width={w} height={h} className={strumming ? 'scale-[1.04] transition-transform' : 'transition-transform'}>
        {/* nut (open position) or fret position label */}
        {startFret === 1 ? (
          <rect x={padX - 3} y={padTop - 5} width={gridW + 6} height={4} rx="2" fill="#e8e2d2" />
        ) : (
          <text x={padX - 8} y={padTop + gridH / 2} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="ui-monospace">
            {startFret}fr
          </text>
        )}

        {/* fret lines */}
        {Array.from({ length: rows }, (_, r) => (
          <line key={r} x1={padX} y1={padTop + r * rowH} x2={padX + gridW} y2={padTop + r * rowH}
                stroke="#3b4256" strokeWidth={startFret === 1 && r === 0 ? 0 : 1} />
        ))}
        {/* string lines */}
        {Array.from({ length: strings }, (_, s) => (
          <line key={s} x1={padX + s * colW} y1={padTop} x2={padX + s * colW} y2={padTop + gridH}
                stroke="#6b7385" strokeWidth="1.1" />
        ))}

        {/* barre */}
        {diagram.barre > 0 && (() => {
          const first = diagram.frets.findIndex((f) => f >= diagram.barre && f > 0)
          const last = diagram.frets.reduce((acc, f, i) => (f >= diagram.barre && f > 0 ? i : acc), -1)
          if (first < 0 || last < 0) return null
          const row = diagram.frets[first] - startFret
          if (row < 0 || row > rows - 1) return null
          return (
            <rect x={padX + first * colW - 7} y={padTop + row * rowH - 6}
                  width={(last - first) * colW + 14} height="12" rx="6"
                  fill="#fbbf24" opacity="0.9" />
          )
        })()}

        {/* finger dots + string markers */}
        {diagram.frets.map((f, s) => {
          const x = padX + s * colW
          if (f < 0) {
            return (
              <g key={s}>
                <text x={x} y={padTop - 9} textAnchor="middle" fontSize="11" fill="#ef4444">×</text>
              </g>
            )
          }
          if (f === 0) {
            return (
              <circle key={s} cx={x} cy={padTop - 11} r="4.6"
                      fill="none" stroke="#4ade80" strokeWidth="1.6" />
            )
          }
          const row = f - startFret
          if (row < 0 || row > rows - 1) return <g key={s} />
          const finger = diagram.fingers?.[s] ?? 0
          return (
            <g key={s}>
              <circle cx={x} cy={padTop + row * rowH} r={compact ? 6.5 : 8}
                      fill={diagram.barre && f === diagram.barre ? '#f59e0b' : '#fbbf24'}
                      stroke="#0b0d13" strokeWidth="1.2" />
              {finger > 0 && (
                <text x={x} y={padTop + row * rowH + 3.2} textAnchor="middle" fontSize="8.5"
                      fontWeight="700" fill="#0b0d13" fontFamily="ui-sans-serif">
                  {ROMAN_FINGERS[finger] ?? finger}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <button onClick={strum}
              className="inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-800/60 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
        <RotateCcw size={10} /> strum
      </button>
    </div>
  )
}
