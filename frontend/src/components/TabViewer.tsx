import { memo, useEffect, useRef } from 'react'
import { Download } from 'lucide-react'
import type { TabBar, TabResult } from '../types'

interface Props {
  tabs: TabResult
  currentTime?: number
  onSeek?: (t: number) => void
  exportUrl?: string
}

interface BarProps {
  bar: TabBar
  labels: string[]
  active: boolean
  currentTime: number
  cellSeconds: number
  onSeek?: (t: number) => void
}

const MemoizedBar = memo(function MemoizedBar({
  bar,
  labels,
  active,
  currentTime,
  cellSeconds,
  onSeek,
}: BarProps) {
  return (
    <div
      data-bar={bar.index}
      className={`mb-4 rounded-md px-2 py-1 transition-colors ${active ? 'bg-amber-500/10 ring-1 ring-amber-500/30' : ''}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[10px] text-slate-500">bar {bar.index}</span>
        <span className="font-mono text-[10px] text-slate-600">{bar.start.toFixed(1)}s</span>
      </div>
      <div className="tab-line text-[13px] leading-[1.55]">
        {bar.rows.map((row, r) => (
          <div key={r} className="whitespace-pre">
            {active ? (
              row.split('').map((ch, ci) => {
                const colIdx = ci - (labels[r]?.length ?? 1) - 1
                const col = bar.columns?.[colIdx]
                const isPlayhead =
                  col && currentTime >= col.time && currentTime < col.time + cellSeconds
                return (
                  <span
                    key={ci}
                    onClick={() => col && onSeek?.(col.time)}
                    className={`${isPlayhead ? 'bg-amber-400/30 text-amber-100' : ''} ${
                      /[0-9]/.test(ch) ? 'cursor-pointer font-semibold text-amber-200' : 'text-slate-500'
                    }`}
                  >
                    {ch}
                  </span>
                )
              })
            ) : (
              row.split('').map((ch, ci) => {
                const isDigit = /[0-9]/.test(ch)
                if (!isDigit) {
                  return (
                    <span key={ci} className="text-slate-500">
                      {ch}
                    </span>
                  )
                }
                const colIdx = ci - (labels[r]?.length ?? 1) - 1
                const col = bar.columns?.[colIdx]
                return (
                  <span
                    key={ci}
                    onClick={() => col && onSeek?.(col.time)}
                    className="cursor-pointer font-semibold text-amber-200"
                  >
                    {ch}
                  </span>
                )
              })
            )}
          </div>
        ))}
      </div>
    </div>
  )
}, (prev, next) => {
  // If neither was active and neither is active now, skip re-render completely!
  if (!prev.active && !next.active) {
    return true
  }
  // If active state changed, must re-render
  if (prev.active !== next.active) {
    return false
  }
  // If currently active, re-render to update playhead position
  return prev.currentTime === next.currentTime
})

/** Renders the generated ASCII tablature with a live playhead. */
export default function TabViewer({ tabs, currentTime = 0, onSeek, exportUrl }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const bars = tabs?.tab?.bars ?? []
  const labels = tabs?.tab?.labels ?? ['E', 'A', 'D', 'G', 'B', 'e']
  const cellSeconds = tabs?.tab?.cell_seconds || 0.1

  const activeBarIdx = bars.findIndex((b) => currentTime >= b.start && currentTime < b.end)

  // auto-scroll only when bar index transitions and only if out of container viewport
  useEffect(() => {
    if (activeBarIdx < 0 || !scroller.current) return
    const c = scroller.current
    const el = c.querySelector<HTMLElement>(`[data-bar="${activeBarIdx}"]`)
    if (el) {
      const cRect = c.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const topDiff = elRect.top - cRect.top
      const bottomDiff = elRect.bottom - cRect.bottom

      if (topDiff < 0 || bottomDiff > 0) {
        c.scrollTo({
          top: c.scrollTop + topDiff - 16,
          behavior: 'auto',
        })
      }
    }
  }, [activeBarIdx])

  if (!bars.length) {
    return (
      <div className="card p-6 text-center text-sm text-slate-400">
        No tablature yet — run a transcription on audio that contains a guitar part.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded bg-ink-800 px-2 py-1 font-mono">
            {(tabs.tuning || []).join(' ')}
          </span>
          {!!tabs.capo && (
            <span className="rounded bg-amber-500/15 px-2 py-1 text-amber-300">capo {tabs.capo}</span>
          )}
          <span>{tabs.stats?.notes ?? 0} notes</span>
          <span>·</span>
          <span>avg confidence {((Number(tabs.stats?.mean_confidence) || 0.8) * 100).toFixed(0)}%</span>
          {tabs.stats?.techniques && Object.keys(tabs.stats.techniques).length > 0 && (
            <span className="text-slate-500">
              · {Object.entries(tabs.stats.techniques).map(([k, v]) => `${k}×${v}`).join(' ')}
            </span>
          )}
        </div>
        {exportUrl && (
          <a
            href={exportUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300"
          >
            <Download size={12} /> .txt
          </a>
        )}
      </div>

      <div ref={scroller} className="max-h-[420px] overflow-auto rounded-lg bg-ink-950/70 p-3 ring-1 ring-ink-700">
        {bars.map((bar, i) => {
          const active = i === activeBarIdx
          return (
            <MemoizedBar
              key={bar.index}
              bar={bar}
              labels={labels}
              active={active}
              currentTime={currentTime}
              cellSeconds={cellSeconds}
              onSeek={onSeek}
            />
          )
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        <span className="text-slate-400">Legend:</span> h hammer-on · p pull-off · / slide up · \ slide
        down · b bend · ~ vibrato. Numbers are frets; the left-most column is the lowest string.
        Click a fret number to jump there.
      </p>
    </div>
  )
}
