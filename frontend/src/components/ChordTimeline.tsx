import { useEffect, useRef } from 'react'
import type { ChordSegment } from '../types'

interface Props {
  chords: ChordSegment[]
  duration: number
  currentTime: number
  beats?: number[]
  onSeek?: (t: number) => void
  onSelect?: (index: number) => void
  selected?: number | null
}

/**
 * A proportional chord timeline. Each block's width is the chord's real
 * duration, so you can see the harmonic rhythm at a glance. The block under
 * the playhead lights up during playback.
 */
export default function ChordTimeline({
  chords, duration, currentTime, beats = [], onSeek, onSelect, selected,
}: Props) {
  const activeRef = useRef<HTMLButtonElement>(null)
  const activeIdx = chords.findIndex((c) => currentTime >= c.start && currentTime < c.end)

  useEffect(() => {
    if (activeIdx >= 0) {
      activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }, [activeIdx])

  if (!chords.length) {
    return <div className="card p-5 text-sm text-slate-400">No chords detected.</div>
  }

  return (
    <div className="relative">
      <div className="flex h-20 items-stretch gap-[3px] overflow-x-auto pb-2">
        {chords.map((c, i) => {
          const dur = c.duration ?? (c.end != null && c.start != null ? c.end - c.start : 0)
          const w = Math.max(2.2, (dur / Math.max(duration, 0.01)) * 100)
          const active = i === activeIdx
          const isSel = selected === i
          const conf = c.confidence ?? 0
          const startSec = (c.start ?? 0).toFixed(1)
          const endSec = (c.end ?? 0).toFixed(1)
          return (
            <button
              key={i}
              ref={active ? activeRef : null}
              onClick={() => { onSelect?.(i); onSeek?.(c.start ?? 0) }}
              title={`${c.name} — ${startSec}s to ${endSec}s (${(conf * 100).toFixed(0)}% confidence)`}
              style={{ flex: `0 0 ${w}%`, minWidth: 44 }}
              className={`group relative flex flex-col justify-center overflow-hidden rounded-md border px-1 transition-all ${
                active
                  ? 'border-amber-400 bg-amber-500/25 shadow-[0_0_18px_-4px_rgba(251,191,36,0.7)]'
                  : isSel
                    ? 'border-amber-500/60 bg-amber-500/10'
                    : 'border-ink-600 bg-ink-800/60 hover:border-ink-500 hover:bg-ink-700/60'
              }`}
            >
              {c.user_corrected && (
                <span className="absolute right-1 top-0.5 text-[8px] text-emerald-400">✎</span>
              )}
              <span className={`truncate px-1 text-center font-semibold ${
                active ? 'text-amber-100' : 'text-slate-200'}`}>
                {c.name}
              </span>
              <span className="truncate text-center font-mono text-[9px] text-slate-500">
                {dur.toFixed(1)}s
              </span>
              {/* confidence bar */}
              <span className="absolute bottom-0 left-0 h-[3px] bg-current opacity-60"
                    style={{
                      width: `${Math.round(conf * 100)}%`,
                      color: conf > 0.7 ? '#4ade80' : conf > 0.45 ? '#fbbf24' : '#f87171',
                    }} />
            </button>
          )
        })}
      </div>
      {beats.length > 0 && (
        <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-ink-800/60">
          {beats.map((b, i) => (
            <span key={i}
                  className="absolute top-0 h-full w-px bg-slate-600/60"
                  style={{ left: `${(b / Math.max(duration, 0.01)) * 100}%` }} />
          ))}
          <span className="absolute top-0 h-full w-0.5 bg-white"
                style={{ left: `${(currentTime / Math.max(duration, 0.01)) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
