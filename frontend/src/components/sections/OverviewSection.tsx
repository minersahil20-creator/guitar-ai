import { BarChart3, Clock, Gauge, Key, Sparkles } from 'lucide-react'
import { Badge, ConfidenceBar, Notice, SectionTitle, Stat } from '../ui'
import AICoach from '../AICoach'
import type { AnalysisResult } from '../../types'
import { fmtTime } from '../../services/api'

interface Props {
  result: AnalysisResult
  time: number
  onSeek: (t: number) => void
}

const ENGINE_LABELS: Record<string, string> = {
  decoder: 'Audio decoder',
  key: 'Key detection',
  chords: 'Chord recognition',
  separation: 'Source separation',
  transcription: 'Transcription',
  tabs: 'Tablature',
  scales: 'Scale analysis',
}

export default function OverviewSection({ result, time, onSeek }: Props) {
  const ov = result?.overview || { duration: 0, bpm: 120, key: '—', key_confidence: 0, chord_count: 0, note_count: 0, beat_count: 0, time_signature: '4/4', alternative_keys: [] }
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duration" value={fmtTime(ov.duration || 0)} hint={`${ov.beat_count || 0} beats detected`} />
        <Stat label="Tempo" value={`${Math.round(ov.bpm || 120)} BPM`} accent="amber" hint={ov.time_signature || '4/4'} />
        <Stat label="Key" value={ov.key || '—'} accent="sky"
              hint={`confidence ${Math.round((ov.key_confidence ?? 0) * 100)}%`} />
        <Stat label="Detected" value={`${ov.chord_count || 0} chords · ${ov.note_count || 0} notes`} accent="violet" />
      </div>

      <AICoach ai={result.ai} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* key candidates */}
        <div className="card p-4">
          <SectionTitle title="Key candidates" icon={<Key size={15} />}
            subtitle="Ranked by profile correlation" />
          <div className="space-y-1.5">
            {(ov.alternative_keys ?? []).length ? (
              ov.alternative_keys.map((k, i) => {
                const keyName = typeof k === 'string' ? k : (k as any)?.key ?? String(k)
                const score = typeof k === 'object' && k && 'score' in k ? Number((k as any).score) || 0.5 : 0.5
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-slate-300">{keyName}</span>
                    <ConfidenceBar value={Math.max(0, Math.min(1, score * 2.6))} />
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-slate-500">—</p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            Relative major/minor pairs (C major ↔ A minor) share every note, so they always score
            similarly. If the top two are close, trust your ear over the number.
          </p>
        </div>

        {/* engines */}
        <div className="card p-4">
          <SectionTitle title="What produced this analysis" icon={<BarChart3 size={15} />}
            subtitle="Every result is traceable to a specific engine" />
          <div className="space-y-1.5">
            {Object.entries(result.engines ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-32 shrink-0 text-slate-500">{ENGINE_LABELS[k] ?? k}</span>
                <Badge tone={String(v).startsWith('demucs') ? 'emerald'
                  : String(v).includes('fallback') || String(v).includes('hpss') ? 'amber'
                  : 'sky'}>
                  {String(v)}
                </Badge>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={result.capabilities?.basic_pitch_installed ? 'emerald' : 'slate'}>
              Basic Pitch {result.capabilities?.basic_pitch_installed ? 'installed' : 'not installed'}
            </Badge>
            <Badge tone={result.capabilities?.demucs_installed ? 'emerald' : 'slate'}>
              Demucs {result.capabilities?.demucs_installed ? 'installed' : 'not installed'}
            </Badge>
            <Badge tone={result.capabilities?.gemini_configured ? 'violet' : 'slate'}>
              Gemini {result.capabilities?.gemini_configured ? 'connected' : 'local text'}
            </Badge>
          </div>
        </div>
      </div>

      {/* warnings */}
      {!!result.warnings?.length && (
        <div className="card p-4">
          <SectionTitle title="Honest limitations" icon={<Sparkles size={15} />}
            subtitle="What the analysis could not promise" />
          <div className="space-y-2">
            {result.warnings.map((w, i) => (
              <Notice key={i} kind="warn">{w}</Notice>
            ))}
          </div>
        </div>
      )}

      {/* processing meta */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1"><Clock size={11} />
          analysed in {result.processing_seconds?.toFixed(1)}s</span>
        <span>·</span>
        <span>{result.media.filename}</span>
        <span>·</span>
        <span>{result.media.sample_rate} Hz · {result.media.decoder}</span>
        {result.overview.tuning && (
          <>
            <span>·</span>
            <button onClick={() => onSeek(0)} className="underline decoration-dotted hover:text-slate-400">
              tuning {result.overview.tuning.join(' ')}{result.overview.capo ? ` · capo ${result.overview.capo}` : ''}
            </button>
          </>
        )}
        <span className="ml-auto">playhead: {time.toFixed(1)}s</span>
      </div>
    </div>
  )
}
