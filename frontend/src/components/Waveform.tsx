import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  peaks: number[]
  duration: number
  currentTime: number
  loopStart?: number
  loopEnd?: number
  beats?: number[]
  downbeats?: number[]
  height?: number
  onSeek?: (t: number) => void
  onLoopChange?: (a: number, b: number) => void
  showLoop?: boolean
}

type DragMode = 'seek' | 'a' | 'b' | null

/**
 * Waveform display + scrubber + A-B loop editor.
 * Drag anywhere to scrub; drag the amber handles to set the loop region.
 */
export default function Waveform({
  peaks, duration, currentTime, loopStart = 0, loopEnd = 0,
  beats = [], downbeats = [], height = 96, onSeek, onLoopChange, showLoop = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<DragMode>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth, H = c.clientHeight
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr; c.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const mid = H / 2
    const peakList = peaks && Array.isArray(peaks) ? peaks : []
    const n = peakList.length || 1
    const bw = W / n
    const safeDur = Math.max(duration || 0, 0.001)

    // loop region shading
    if (showLoop && loopEnd > loopStart) {
      const x1 = Math.max(0, Math.min(W, (loopStart / safeDur) * W))
      const x2 = Math.max(0, Math.min(W, (loopEnd / safeDur) * W))
      ctx.fillStyle = 'rgba(251,191,36,0.10)'
      ctx.fillRect(x1, 0, x2 - x1, H)
      ctx.strokeStyle = 'rgba(251,191,36,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, H); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, H); ctx.stroke()
    }

    // beat grid
    ctx.strokeStyle = 'rgba(148,163,184,0.10)'
    ctx.lineWidth = 1
    for (const b of beats) {
      const x = Math.max(0, Math.min(W, (b / safeDur) * W))
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.28)'
    for (const b of downbeats) {
      const x = Math.max(0, Math.min(W, (b / safeDur) * W))
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }

    // waveform
    for (let i = 0; i < n; i++) {
      const x = i * bw
      const t = (i / n) * safeDur
      const amp = Math.max(0.004, peakList[i] ?? 0)
      const h = Math.max(1, amp * (H / 2 - 4))
      const played = t <= currentTime
      ctx.fillStyle = played
        ? (showLoop && loopEnd > loopStart && t >= loopStart && t <= loopEnd ? '#fde68a' : '#fbbf24')
        : 'rgba(148,163,184,0.42)'
      ctx.fillRect(x, mid - h, Math.max(0.8, bw - 0.6), h * 2)
    }

    // centre line
    ctx.strokeStyle = 'rgba(226,232,240,0.12)'
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()

    // playhead
    const px = Math.max(0, Math.min(W, ((currentTime || 0) / safeDur) * W))
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(px, 7, 3.6, 0, Math.PI * 2); ctx.fill()

    // hover marker
    if (hoverX != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)'
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(hoverX, 0); ctx.lineTo(hoverX, H); ctx.stroke()
      ctx.setLineDash([])
    }
  }, [peaks, duration, currentTime, loopStart, loopEnd, beats, downbeats, hoverX, showLoop])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const ro = new ResizeObserver(() => draw())
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [draw])

  const timeAt = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return 0
    const safeDur = Math.max(duration || 0, 0.001)
    const r = el.getBoundingClientRect()
    const frac = r.width > 0 ? (clientX - r.left) / r.width : 0
    return Math.max(0, Math.min(safeDur, frac * safeDur))
  }

  const onDown = (e: React.MouseEvent) => {
    const safeDur = Math.max(duration || 0, 0.001)
    const t = timeAt(e.clientX)
    const W = wrapRef.current?.getBoundingClientRect().width ?? 1
    const pxA = (loopStart / safeDur) * W
    const pxB = (loopEnd / safeDur) * W
    const x = e.clientX - (wrapRef.current?.getBoundingClientRect().left ?? 0)
    if (showLoop && loopEnd > loopStart && Math.abs(x - pxA) < 8) { setDrag('a'); return }
    if (showLoop && loopEnd > loopStart && Math.abs(x - pxB) < 8) { setDrag('b'); return }
    if (e.shiftKey) { onLoopChange?.(t, Math.max(t + 0.5, loopEnd)); setDrag('b'); return }
    setDrag('seek')
    onSeek?.(t)
  }

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setHoverX(e.clientX - r.left)
    if (!drag) return
    const t = timeAt(e.clientX)
    if (drag === 'seek') onSeek?.(t)
    else if (drag === 'a') onLoopChange?.(Math.min(t, loopEnd - 0.3), loopEnd)
    else if (drag === 'b') onLoopChange?.(loopStart, Math.max(t, loopStart + 0.3))
  }

  const onUp = () => setDrag(null)

  return (
    <div ref={wrapRef}
         className="relative w-full cursor-crosshair select-none rounded-lg bg-ink-950/70 ring-1 ring-ink-700"
         style={{ height }}
         onMouseDown={onDown}
         onMouseMove={onMove}
         onMouseUp={onUp}
         onMouseLeave={() => { onUp(); setHoverX(null) }}>
      <canvas ref={canvasRef} className="h-full w-full" />
      {showLoop && loopEnd > loopStart && (
        <div className="pointer-events-none absolute left-2 top-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
          A–B {loopStart.toFixed(1)}s → {loopEnd.toFixed(1)}s
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1 right-2 font-mono text-[10px] text-slate-500">
        shift-drag to set loop
      </div>
    </div>
  )
}
