/**
 * audio.ts — the practice-studio audio engine (Web Audio).
 *
 * WHY THIS FILE IS BIGGER THAN YOU'D EXPECT:
 * A normal <audio> element can change speed, but speeding it up also raises
 * the pitch (like a tape machine). Guitarists need the opposite: slow a solo
 * down to 50% and hear it in the SAME key. That needs time-stretching, which
 * the browser does not give you for free — so we implement SOLA/WSOLA
 * (Synchronous Overlap-Add, with a waveform-similarity search) below.
 *
 * How tempo + pitch are combined:
 *   - time-stretch the buffer by  S = P / T      (P = pitch ratio, T = tempo ratio)
 *   - play it back with           playbackRate = P
 *   => final tempo = P / S = T, final pitch = P. Independent control.
 */

export type StretchProgress = (pct: number) => void

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const midiToName = (m: number) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/* ─────────────────────────────────────────────────────────────
   SOLA time-stretch (pitch-preserving)
   ───────────────────────────────────────────────────────────── */

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/**
 * Change the SPEED of `input` without changing its pitch.
 *
 * `factor` is a SPEED ratio:
 *     0.5 = half speed  -> output is twice as long
 *     2.0 = double speed -> output is half as long
 * (This is the opposite of a duration multiplier — easy to get backwards.)
 *
 * Processes in slices and reports progress so the UI stays responsive.
 */
export async function timeStretch(
  input: Float32Array,
  factor: number,
  sampleRate: number,
  onProgress?: StretchProgress,
): Promise<Float32Array> {
  if (Math.abs(factor - 1) < 0.005) return input

  const win = 1024
  const Ha = Math.round(win / 4)                    // 75% overlap
  const search = 192
  const Hs = Ha                                     // synthesis hop (fixed)
  const Hi = Math.max(1, Math.round(Ha * factor))   // analysis hop (scaled)
  const n = input.length

  const outLen = Math.max(win, Math.ceil((n - win) / factor) + win + Hs * 2)
  const out = new Float32Array(outLen)
  const norm = new Float32Array(outLen)
  const window = hann(win)

  // first frame, no search
  for (let i = 0; i < win; i++) {
    const s = input[i] || 0
    out[i] += s * window[i]
    norm[i] += window[i]
  }

  let inPos = 0
  let outPos = Hs
  const sliceFrames = 3000
  let framesDone = 0
  const totalFrames = Math.max(1, Math.ceil((n - win - search) / Hi))

  const processSlice = (frames: number) => {
    for (let f = 0; f < frames; f++) {
      if (inPos + Hi + win + search >= n) break

      inPos += Hi

      // coarse + fine similarity search: find the offset whose waveform best
      // matches what is already in the output (this is what stops "warbling")
      let bestDelta = 0
      let bestScore = -Infinity
      const outIdx = outPos
      const dMin = Math.max(-search, -inPos)
      const dMax = Math.min(search, n - win - inPos)

      for (let d = dMin; d <= dMax; d += 16) {
        let score = 0
        for (let i = 0; i < win; i += 16) {
          const inIdx = inPos + d + i
          if (inIdx >= 0 && inIdx < n) {
            score += input[inIdx] * (out[outIdx + i] || 0)
          }
        }
        if (score > bestScore) { bestScore = score; bestDelta = d }
      }
      const lo = Math.max(dMin, bestDelta - 16)
      const hi = Math.min(dMax, bestDelta + 16)
      bestScore = -Infinity
      for (let d = lo; d <= hi; d += 4) {
        let score = 0
        for (let i = 0; i < win; i += 16) {
          const inIdx = inPos + d + i
          if (inIdx >= 0 && inIdx < n) {
            score += input[inIdx] * (out[outIdx + i] || 0)
          }
        }
        if (score > bestScore) { bestScore = score; bestDelta = d }
      }

      const src = inPos + bestDelta
      for (let i = 0; i < win; i++) {
        const inIdx = src + i
        const sample = inIdx >= 0 && inIdx < n ? (input[inIdx] || 0) : 0
        out[outIdx + i] += sample * window[i]
        norm[outIdx + i] += window[i]
      }
      outPos += Hs
      framesDone++
    }
  }

  // run in slices, yielding to the event loop so the UI never freezes
  while (inPos + Hi + win + search < n) {
    processSlice(sliceFrames)
    onProgress?.(Math.min(99, Math.round((framesDone / totalFrames) * 100)))
    await new Promise((r) => setTimeout(r, 0))
  }

  // normalise by the accumulated window energy (removes OLA amplitude drift)
  const used = Math.min(outLen, outPos + win)
  for (let i = 0; i < used; i++) {
    if (norm[i] > 1e-4) out[i] /= norm[i]
    if (!Number.isFinite(out[i])) out[i] = 0
  }
  onProgress?.(100)
  return out.subarray(0, used)
}

/** Resample by an arbitrary ratio (linear interpolation) — used for pitch shifts. */
export function resample(input: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-6) return input
  const outLen = Math.max(1, Math.floor(input.length * ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = src - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/* ─────────────────────────────────────────────────────────────
   Practice engine
   ───────────────────────────────────────────────────────────── */

export interface EngineOptions {
  tempo?: number          // 0.25 .. 2
  semitones?: number      // -12 .. +12
  keepPitch?: boolean     // true = time-stretch (pitch preserved)
  volume?: number         // 0 .. 1
  loop?: boolean
  loopStart?: number
  loopEnd?: number
}

export class PracticeEngine {
  ctx: AudioContext
  private raw: AudioBuffer | null = null
  private stretched: AudioBuffer | null = null
  private stretchKey = ''
  private source: AudioBufferSourceNode | null = null
  private gainNode: GainNode
  private startedAt = 0          // ctx time when current source started
  private startOffset = 0        // buffer offset (seconds, stretched domain)
  private playing = false
  private preparing = false

  tempo = 1
  semitones = 0
  keepPitch = true
  volume = 0.9
  loop = false
  loopStart = 0
  loopEnd = 0
  duration = 0

  onEnded?: () => void
  onStateChange?: (playing: boolean) => void
  onPrepare?: (pct: number | null) => void

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    this.gainNode = this.ctx.createGain()
    this.gainNode.gain.value = this.volume
    this.gainNode.connect(this.ctx.destination)
  }

  get isPlaying() { return this.playing }
  get isPreparing() { return this.preparing }
  /**
   * The SPEED ratio handed to timeStretch().
   *   stretched length = n / S ; playing that at rate P lasts n / (S*P)
   *   we want n / T  =>  S = T / P
   */
  get stretchFactor() {
    const P = Math.pow(2, this.semitones / 12)
    const T = this.tempo || 1
    return this.keepPitch ? T / P : 1
  }
  get playbackRate() {
    return this.keepPitch ? Math.pow(2, this.semitones / 12) : (this.tempo || 1)
  }

  async load(url: string) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not load audio (HTTP ${res.status})`)
    const bytes = await res.arrayBuffer()
    this.raw = await this.ctx.decodeAudioData(bytes)
    if (!this.raw) throw new Error('Failed to decode audio data')
    this.duration = this.raw.duration || 0
    this.stretched = null
    this.stretchKey = ''
    this.loopEnd = this.raw.duration || 0
    return this.duration
  }

  /** Ensure the right stretched buffer exists for the current tempo/pitch. */
  private async ensureBuffer(onProgress?: StretchProgress) {
    if (!this.raw) throw new Error('No audio loaded')
    const S = this.stretchFactor
    const key = S.toFixed(3)
    if (this.stretched && this.stretchKey === key) return this.stretched

    this.preparing = true
    this.onPrepare?.(0)
    try {
      // work on a mono mixdown of all channels — preserves guitar and backing balance
      const ch0 = this.raw.getChannelData(0)
      let ch: Float32Array = ch0
      if (this.raw.numberOfChannels > 1) {
        const ch1 = this.raw.getChannelData(1)
        ch = new Float32Array(ch0.length)
        for (let i = 0; i < ch0.length; i++) ch[i] = (ch0[i] + ch1[i]) * 0.5
      }
      const data = S === 1 ? ch : await timeStretch(ch, S, this.raw.sampleRate, onProgress)
      const cleanData = new Float32Array(data.length)
      for (let i = 0; i < data.length; i++) {
        cleanData[i] = Number.isFinite(data[i]) ? data[i] : 0
      }
      const buf = this.ctx.createBuffer(1, cleanData.length, this.raw.sampleRate)
      buf.copyToChannel(cleanData, 0)
      this.stretched = buf
      this.stretchKey = key
      return buf
    } finally {
      this.preparing = false
      this.onPrepare?.(null)
    }
  }

  async play(offset?: number, onStretch?: StretchProgress) {
    if (!this.raw) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    const buf = await this.ensureBuffer(onStretch)
    this.stopSource()

    const S = this.stretchFactor
    // buffer time = original time / speed  (half speed => twice the samples)
    let offStretched = ((offset ?? this.currentTime) / S)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = this.playbackRate
    if (this.loop && this.loopEnd > this.loopStart) {
      src.loop = true
      src.loopStart = this.loopStart / S
      src.loopEnd = Math.min(this.loopEnd / S, buf.duration)
      if (offStretched >= src.loopEnd) offStretched = (this.loopStart / S)
    }
    src.onended = () => {
      if (this.source === src) {
        this.playing = false
        this.onStateChange?.(false)
        this.onEnded?.()
      }
    }
    src.connect(this.gainNode)
    src.start(0, Math.max(0, Math.min(offStretched, buf.duration - 0.01)))
    this.source = src
    this.startedAt = this.ctx.currentTime
    this.startOffset = Math.max(0, Math.min(offStretched, buf.duration - 0.01))
    this.playing = true
    this.onStateChange?.(true)
  }

  pause() {
    if (!this.playing) return
    const t = this.currentTime
    this.stopSource()
    this.playing = false
    this.onStateChange?.(false)
    this.pausedAt = t
  }

  private pausedAt = 0

  stop() {
    this.stopSource()
    this.playing = false
    this.pausedAt = 0
    this.onStateChange?.(false)
  }

  private stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop() } catch { /* already stopped */ }
      this.source.disconnect()
      this.source = null
    }
  }

  /** Current playback position expressed in ORIGINAL (unstretched) seconds. */
  get currentTime(): number {
    if (!this.playing || !this.source) return this.pausedAt
    const S = this.stretchFactor
    const elapsed = (this.ctx.currentTime - this.startedAt) * this.playbackRate
    let posStretched = this.startOffset + elapsed
    if (this.loop && this.loopEnd > this.loopStart) {
      const lStartS = this.loopStart / S
      const lEndS = this.loopEnd / S
      const loopLenS = lEndS - lStartS
      if (loopLenS > 0 && posStretched >= lStartS) {
        posStretched = lStartS + ((posStretched - lStartS) % loopLenS)
      }
    }
    return Math.min(this.duration, Math.max(0, posStretched * S))
  }

  async seek(t: number) {
    const wasPlaying = this.playing
    const maxDur = this.duration > 0 ? this.duration : Infinity
    this.pausedAt = Math.max(0, Math.min(t, maxDur))
    if (wasPlaying) await this.play(this.pausedAt)
    else this.stopSource()
  }

  async setTempo(t: number, onStretch?: StretchProgress) {
    t = Math.max(0.25, Math.min(2, t))
    const wasPlaying = this.playing
    const at = this.currentTime
    this.tempo = t
    if (wasPlaying) await this.play(at, onStretch)
  }

  async setSemitones(s: number, onStretch?: StretchProgress) {
    const wasPlaying = this.playing
    const at = this.currentTime
    this.semitones = Math.max(-12, Math.min(12, Math.round(s)))
    if (wasPlaying) await this.play(at, onStretch)
  }

  async setKeepPitch(v: boolean, onStretch?: StretchProgress) {
    const wasPlaying = this.playing
    const at = this.currentTime
    this.keepPitch = v
    if (wasPlaying) await this.play(at, onStretch)
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v))
    this.gainNode.gain.value = this.volume
  }

  async setLoop(on: boolean, a?: number, b?: number) {
    if (a !== undefined) this.loopStart = Math.max(0, a)
    if (b !== undefined) this.loopEnd = b ?? this.duration
    this.loop = on && this.loopEnd > this.loopStart
    if (this.playing) await this.play(this.currentTime)
  }

  dispose() {
    this.stop()
    this.ctx.close()
  }
}

/* ─────────────────────────────────────────────────────────────
   Metronome + note preview (tiny synth, no audio files needed)
   ───────────────────────────────────────────────────────────── */

export class Metronome {
  private ctx: AudioContext
  private timer: number | null = null
  private nextTime = 0
  bpm = 100
  beatsPerBar = 4
  volume = 0.5
  private beat = 0
  onBeat?: (beat: number) => void

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  private click(time: number, accent: boolean) {
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.frequency.value = accent ? 1600 : 1050
    osc.type = 'square'
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(this.volume * (accent ? 0.5 : 0.3), time + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
    osc.connect(g)
    g.connect(this.ctx.destination)
    osc.start(time)
    osc.stop(time + 0.06)
  }

  start() {
    if (this.timer) return
    this.nextTime = this.ctx.currentTime + 0.1
    this.beat = 0
    const schedule = () => {
      const spb = 60 / Math.max(20, this.bpm)
      while (this.nextTime < this.ctx.currentTime + 0.2) {
        const accent = this.beat % this.beatsPerBar === 0
        this.click(this.nextTime, accent)
        const b = this.beat
        setTimeout(() => this.onBeat?.(b), Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000))
        this.nextTime += spb
        this.beat = (this.beat + 1) % this.beatsPerBar
      }
      this.timer = window.setTimeout(schedule, 25)
    }
    schedule()
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  get running() { return this.timer !== null }
}

/** Pluck a single note (used by the fretboard + chord diagrams). */
export function pluckNote(ctx: AudioContext, midi: number, when = 0, gain = 0.35) {
  const freq = midiToFreq(midi)
  const dur = 1.6
  const osc = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const g = ctx.createGain()
  const filt = ctx.createBiquadFilter()

  osc.type = 'triangle'
  osc.frequency.value = freq
  osc2.type = 'sawtooth'
  osc2.frequency.value = freq * 1.005
  filt.type = 'lowpass'
  filt.frequency.setValueAtTime(freq * 8, ctx.currentTime + when)
  filt.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 2), ctx.currentTime + when + dur * 0.6)

  g.gain.setValueAtTime(0, ctx.currentTime + when)
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + when + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur)

  osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(ctx.destination)
  osc.start(ctx.currentTime + when); osc2.start(ctx.currentTime + when)
  osc.stop(ctx.currentTime + when + dur + 0.05); osc2.stop(ctx.currentTime + when + dur + 0.05)
}
