import { useCallback, useEffect, useRef, useState } from 'react'
import { Metronome, PracticeEngine } from '../lib/audio'

/**
 * React wrapper around the Web Audio practice engine.
 * Gives you a live `time` (updated every frame) for syncing chords, tab and
 * fretboard highlights, plus tempo / pitch / loop / metronome controls.
 */
export function usePlayer(url?: string) {
  const engineRef = useRef<PracticeEngine | null>(null)
  const metroRef = useRef<Metronome | null>(null)
  const rafRef = useRef<number | null>(null)

  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [preparing, setPreparing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tempo, setTempoState] = useState(1)
  const [semitones, setSemitonesState] = useState(0)
  const [keepPitch, setKeepPitchState] = useState(true)
  const [volume, setVolumeState] = useState(0.9)
  const [loop, setLoopState] = useState(false)
  const [loopStart, setLoopStartState] = useState(0)
  const [loopEnd, setLoopEndState] = useState(0)
  const [metroOn, setMetroOn] = useState(false)
  const [metroBpm, setMetroBpm] = useState(100)

  // one engine for the lifetime of the hook
  useEffect(() => {
    const engine = new PracticeEngine()
    engineRef.current = engine
    engine.onStateChange = (p) => setPlaying(p)
    engine.onPrepare = (pct) => setPreparing(pct)
    metroRef.current = new Metronome(engine.ctx)
    return () => {
      metroRef.current?.stop()
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // load a new audio source
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !url) { setReady(false); return }
    let cancelled = false
    setLoading(true); setError(null); setReady(false)
    engine.load(url)
      .then((d) => {
        if (cancelled) return
        setDuration(d)
        setLoopStartState(0)
        setLoopEndState(d)
        setTime(0)
        setReady(true)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true; engine.stop() }
  }, [url])

  // keep `time` fresh while playing
  useEffect(() => {
    let lastTime = -1
    const tick = () => {
      const e = engineRef.current
      if (e?.isPlaying) {
        const ct = e.currentTime
        if (Math.abs(ct - lastTime) >= 0.035) {
          lastTime = ct
          setTime(ct)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const play = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    await e.play(undefined, (pct) => setPreparing(pct))
  }, [])

  const pause = useCallback(() => engineRef.current?.pause(), [])
  const toggle = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    if (e.isPlaying) e.pause()
    else await play()
  }, [play])

  const seek = useCallback(async (t: number) => {
    await engineRef.current?.seek(t)
    setTime(t)
  }, [])

  const setTempo = useCallback(async (v: number) => {
    setTempoState(v)
    await engineRef.current?.setTempo(v, (pct) => setPreparing(pct))
  }, [])

  const setSemitones = useCallback(async (v: number) => {
    setSemitonesState(v)
    await engineRef.current?.setSemitones(v, (pct) => setPreparing(pct))
  }, [])

  const setKeepPitch = useCallback(async (v: boolean) => {
    setKeepPitchState(v)
    await engineRef.current?.setKeepPitch(v, (pct) => setPreparing(pct))
  }, [])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    engineRef.current?.setVolume(v)
  }, [])

  const setLoopRegion = useCallback(async (a: number, b: number) => {
    setLoopStartState(a); setLoopEndState(b)
    await engineRef.current?.setLoop(true, a, b)
    setLoopState(true)
  }, [])

  const toggleLoop = useCallback(async () => {
    const next = !loop
    setLoopState(next)
    await engineRef.current?.setLoop(next, loopStart, loopEnd)
  }, [loop, loopStart, loopEnd])

  const clearLoop = useCallback(async () => {
    setLoopState(false)
    await engineRef.current?.setLoop(false)
  }, [])

  // metronome
  useEffect(() => {
    const m = metroRef.current
    if (!m) return
    m.bpm = metroBpm
    if (metroOn) m.start()
    else m.stop()
    return () => m?.stop()
  }, [metroOn, metroBpm])

  useEffect(() => {
    const e = engineRef.current
    if (e) e.onEnded = undefined
  }, [])

  return {
    ready, loading, playing, time, duration, error, preparing,
    tempo, semitones, keepPitch, volume, loop, loopStart, loopEnd,
    metroOn, setMetroOn, metroBpm, setMetroBpm,
    play, pause, toggle, seek, setTempo, setSemitones, setKeepPitch, setVolume,
    setLoopRegion, toggleLoop, clearLoop,
    engine: engineRef,
  }
}
