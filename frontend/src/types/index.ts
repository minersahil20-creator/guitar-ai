// Types mirroring the FastAPI responses (see backend/app/services/pipeline.py)

export interface Engine {
  id: string
  name: string
  installed: boolean
  required: boolean
  note: string
}

export interface Capabilities {
  engines: Engine[]
  limits: {
    max_upload_mb: number
    max_duration_seconds: number
    allowed_extensions: string[]
  }
  gemini: { configured: boolean; models: string[]; note: string }
  url_fetch_enabled: boolean
  url_fetch: {
    enabled: boolean
    yt_dlp: string | null
    ffmpeg: string | null
    cookies_file: string | null
    cookies: {
      loaded: boolean
      entries: number
      domains: string[]
      youtube: boolean
      instagram: boolean
      expires_at: number | null
      expires_in_days: number | null
    }
    max_duration_sec: number
    ready: boolean
    why_not: string | null
  }
}

export interface JobStatus {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  stage: string
  message: string
  created_at: number
  updated_at: number
  error?: string | null
  result_url?: string
}

export interface ChordSegment {
  start: number
  end: number
  duration: number
  root_pc: number
  quality: string
  bass_pc: number
  name: string
  confidence: number
  beat_index: number
  bar: number
  user_corrected?: boolean
  diagrams?: ChordDiagram[]
}

export interface ChordDiagram {
  name: string
  frets: number[]      // -1 = muted, 0 = open
  fingers: number[]
  barre: number
  position: number
  source: string
}

export interface ProgressionItem {
  name: string
  root_pc: number
  quality: string
  count: number
  confidence: number
}

export interface ChordResult {
  engine: string
  chords: ChordSegment[]
  timeline: { time: number; beat: number; bar: number; beat_in_bar: number;
              chord: string; root_pc: number; quality: string; confidence: number }[]
  beats_per_bar: number
  progression: ProgressionItem[]
  key_pc: number
  key_is_minor: boolean
  roman_numerals: string[]
  note?: string
}

export interface Note {
  start: number
  end: number
  duration: number
  midi: number
  name: string
  confidence: number
  velocity?: number
  bend_semitones?: number
  vibrato?: boolean
  vibrato_rate_hz?: number
  vibrato_depth_cents?: number
  slide_from?: number | null
  legato?: string | null
  string?: number | null
  fret?: number | null
  techniques?: string[]
  user_corrected?: boolean
  in_scale?: boolean
  degree?: string
}

export interface Phrase {
  length_notes: number
  occurrences: number
  starts: number[]
  note_names: string[]
  pitches?: number[][]
}

export interface SoloResult {
  engine: string
  notes: Note[]
  phrases: Phrase[]
  range?: { lowest: string; highest: string } | null
  source?: string
  note?: string
}

export interface TabBar {
  index: number
  start: number
  end: number
  rows: string[]
  columns: { index: number; time: number; width: number; tokens: string[] }[]
  cells: number
}

export interface TabResult {
  placed: Note[]
  tab: {
    tuning: string[]
    labels: string[]
    capo: number
    bars: TabBar[]
    lines: string[]
    cell_time: number[]
    cell_seconds: number
    cells_per_bar: number
  }
  tuning: string[]
  capo: number
  stats: { notes: number; mean_confidence: number; highest_fret: number; techniques: Record<string, number> }
}

export interface ScaleBox {
  start_fret: number
  end_fret: number
  strings: { string: number; frets: { fret: number; note: string; degree: string; is_root: boolean; midi: number }[] }[]
}

export interface ScaleResult {
  song_key: string
  song_key_pc: number
  song_key_is_minor: boolean
  solo_scale: {
    scale_id: string
    scale_label: string
    root_pc: number
    name: string
    label?: string
    pitch_classes: number[]
    coverage: number
    outside: number
    score: number
    confidence: number
    description: string
  } | null
  alternatives: { name: string; scale_id: string; root_pc: number; coverage: number; confidence: number }[]
  out_of_scale: {
    in_scale_count: number
    chromatic_passing: { time: number; name: string; midi: number; reason: string }[]
    chromatic_count: number
    out_of_scale: { time: number; name: string; midi: number; interval_from_root: string; confidence: number }[]
    out_of_scale_count: number
    blue_notes: { time: number; name: string }[]
  } | null
  fretboard: {
    root_pc: number
    scale_id: string
    scale_label: string
    name: string
    pitch_classes: number[]
    intervals: number[]
    boxes: ScaleBox[]
    blurb: string
  } | null
  histogram: number[]
  per_note: { time: number; midi: number; name: string; in_scale: boolean; degree: string; confidence: number }[]
  relationship: { kind: string; text: string; semitones: number } | null
  engine: string
  note?: string
}

export interface StemInfo {
  stem: string
  label: string
  url: string
  is_guitar: boolean
  rms?: number
  silent?: boolean
}

export interface StemsResult {
  engine: string
  is_true_separation: boolean
  stems: StemInfo[]
  guitar: { available: boolean; is_isolated: boolean; url: string | null; label: string }
  rhythm_guitar?: { available: boolean; url: string | null; label: string }
  backing: { available: boolean; url: string | null; label: string; solo_only?: boolean; strength?: number }
  warnings: string[]
}

export interface AIContent {
  headline: string
  overview: string
  chord_explanation: string
  scale_explanation: string
  solo_explanation: string
  chord_scale_relationship: string
  practice_plan: string[]
  things_to_double_check: string[]
  confidence_comment: string
}

export interface AIResult {
  provider: 'gemini' | 'local'
  model: string
  content: AIContent
  fallback_reason?: string
}

export interface Overview {
  duration: number
  bpm: number
  key: string
  key_confidence: number
  alternative_keys: { key: string; root_pc: number; is_minor: boolean; score: number }[]
  beats_per_bar: number
  time_signature: string
  beat_count: number
  beat_times: number[]
  downbeat_times: number[]
  chord_count: number
  note_count: number
  tuning: string[]
  capo: number
}

export interface AnalysisResult {
  job_id: string
  status: string
  created_at: number
  processing_seconds?: number
  options?: Record<string, unknown>
  media: { filename: string; duration: number; sample_rate: number; decoder: string;
           waveform: number[]; url: string }
  overview: Overview
  chords: ChordResult
  solo: SoloResult
  tabs: TabResult
  scales: ScaleResult
  stems: StemsResult | null
  backing?: { available: boolean; url: string | null; label: string; solo_only?: boolean; strength?: number }
  guitar?: { available: boolean; is_isolated?: boolean; url: string | null; label: string }
  rhythm_guitar?: { available: boolean; url: string | null; label: string }
  ai: AIResult
  warnings: string[]
  engines: Record<string, string>
  capabilities: { basic_pitch_installed: boolean; demucs_installed: boolean;
                  crepe_installed: boolean; gemini_configured: boolean }
}

export interface Project {
  id: string
  name: string
  created_at: number
  updated_at: number
  job_id?: string
  duration?: number
  bpm?: number
  key?: string
  solo_scale?: string
  chord_count?: number
  note_count?: number
  source_name?: string
  source_type?: string
  engines?: Record<string, string>
  has_stems?: boolean
  starred?: boolean
}

export interface UrlInfo {
  ok: boolean
  kind: string
  name: string
  /** Short caveat about this platform (shown before we even contact it). */
  note?: string
  why_blocked?: string
  what_to_do?: string
  can_fetch: boolean
  message: string
  /** Machine-readable failure: bot_check, private, age_restricted, too_long … */
  error_kind?: string
  /** Filled in by the probe (metadata read without downloading). */
  title?: string
  duration?: number
  duration_label?: string
  uploader?: string
  thumbnail?: string
  extractor?: string
}

export interface UrlDiagnosis {
  capabilities: {
    enabled: boolean
    yt_dlp: string | null
    ffmpeg: string | null
    cookies_file: string | null
    max_duration_sec: number
    ready: boolean
    why_not: string | null
  }
  info: UrlInfo
  probe: { ok: boolean; title?: string; duration?: number; uploader?: string;
           extractor?: string; is_live?: boolean } | null
  error: { kind: string; message: string; hint?: string } | null
}
