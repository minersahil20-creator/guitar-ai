import { useState } from 'react'
import { Music, Scale as ScaleIcon } from 'lucide-react'
import Fretboard from '../Fretboard'
import { Badge, ConfidenceBar, Notice, SectionTitle, Stat } from '../ui'
import type { AnalysisResult } from '../../types'

interface Props {
  result: AnalysisResult
  onSeek?: (t: number) => void
}

/** Simple bar visualisation of how much each pitch class is used. */
function PitchHistogram({ hist, rootPc }: { hist: number[]; rootPc: number }) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const max = Math.max(...hist, 0.0001)
  return (
    <div className="flex h-28 items-end gap-1">
      {hist.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-20 w-full items-end">
            <div className={`w-full rounded-t ${i === rootPc ? 'bg-red-400' : 'bg-sky-500/70'}`}
                 style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
          <span className={`font-mono text-[9px] ${i === rootPc ? 'text-red-300' : 'text-slate-500'}`}>
            {names[i]}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ScalesSection({ result, onSeek }: Props) {
  const sc = result.scales
  const [altIdx, setAltIdx] = useState<number | null>(null)
  const [boxIdx, setBoxIdx] = useState(0)

  if (!sc) return <Notice kind="info">No scale analysis available.</Notice>

  const solo = sc.solo_scale
  const shownBox = (idx: number) => sc.fretboard?.boxes?.[idx] ?? null

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Song key" value={sc.song_key} accent="amber"
              hint={`confidence ${Math.round((result.overview.key_confidence ?? 0) * 100)}%`} />
        <Stat label="Solo scale" value={solo?.name ?? '—'} accent="violet"
              hint={solo ? `${Math.round(solo.coverage * 100)}% of notes fit` : undefined} />
        <Stat label="Out of scale" value={sc.out_of_scale?.out_of_scale_count ?? 0} accent="sky"
              hint={`${sc.out_of_scale?.chromatic_count ?? 0} chromatic passing`} />
        <Stat label="Relationship" value={<span className="text-[13px]">{sc.relationship?.kind ?? '—'}</span>} />
      </div>

      {solo && sc.relationship && (
        <Notice kind={sc.relationship.kind === 'conflicting' ? 'warn' : 'info'}>
          <p className="font-medium text-slate-200">{sc.relationship.kind}</p>
          <p>{sc.relationship.text}</p>
        </Notice>
      )}

      {!solo && (
        <Notice kind="info" title="Not enough notes">
          Scale analysis needs detected lead notes. Run a transcription first.
        </Notice>
      )}

      {solo && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* scale summary */}
            <div className="card p-4">
              <SectionTitle title={solo.name} icon={<ScaleIcon size={15} />}
                subtitle={`${solo.scale_label ?? ''} · ${(solo.pitch_classes?.length ?? 0)} notes`}
                right={<ConfidenceBar value={solo.confidence ?? solo.score ?? 0.8} className="w-28" />} />
              <p className="mb-3 text-[12.5px] leading-relaxed text-slate-400">{solo.description}</p>

              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                Notes in this scale
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {(solo.pitch_classes || []).map((pc) => {
                  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
                  const isRoot = pc === solo.root_pc
                  return (
                    <span key={pc}
                      className={`rounded-md px-2 py-1 font-mono text-xs ${
                        isRoot ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30' : 'bg-sky-500/15 text-sky-300'}`}>
                      {names[pc]}
                    </span>
                  )
                })}
              </div>

              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                Alternative interpretations
              </div>
              <div className="space-y-1">
                {(sc.alternatives ?? []).slice(0, 5).map((a, i) => (
                  <button key={i}
                    onClick={() => setAltIdx(i)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-[11.5px] transition ${
                      altIdx === i ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-ink-700 text-slate-400 hover:border-ink-600'}`}>
                    <span className="flex-1">{a.name}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {typeof a.coverage === 'number' ? `${Math.round(a.coverage * 100)}%` : '—'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* histogram + out of scale */}
            <div className="space-y-4">
              <div className="card p-4">
                <SectionTitle title="Pitch usage" icon={<Music size={15} />}
                  subtitle="How often each note class appears, weighted by duration" />
                <PitchHistogram hist={sc.histogram ?? []} rootPc={solo.root_pc} />
              </div>

              {sc.out_of_scale && (
                <div className="card p-4">
                  <SectionTitle title="Notes outside the scale"
                    subtitle={`${sc.out_of_scale.out_of_scale_count ?? 0} outside · ${sc.out_of_scale.chromatic_count ?? 0} chromatic passing`} />
                  {(sc.out_of_scale.out_of_scale || []).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(sc.out_of_scale.out_of_scale || []).slice(0, 24).map((n, i) => (
                        <button key={i} onClick={() => onSeek?.(n.time)}
                          className="rounded-md border border-ink-600 bg-ink-800/60 px-2 py-0.5 font-mono text-[11px] text-orange-300 transition hover:border-orange-500/50"
                          title={`${n.interval_from_root ?? ''} · ${(Number(n.confidence || 0) * 100).toFixed(0)}% confidence`}>
                          {n.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Every detected note sits inside {solo.name}.
                    </p>
                  )}
                  {!!sc.out_of_scale.blue_notes?.length && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Blue notes (♭5): {sc.out_of_scale.blue_notes.slice(0, 6).map((b) => b.name).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* fretboard scale patterns */}
          {!!sc.fretboard?.boxes?.length && (
            <div className="card p-4">
              <SectionTitle title="Scale patterns on the neck" icon={<ScaleIcon size={15} />}
                subtitle={`${sc.fretboard.name ?? ''} — ${(sc.fretboard.boxes || []).length} positions`}
                right={
                  <div className="flex flex-wrap gap-1">
                    {(sc.fretboard.boxes || []).map((b, i) => (
                      <button key={i} onClick={() => setBoxIdx(i)}
                        className={`rounded-md border px-2 py-0.5 text-[10.5px] transition ${
                          boxIdx === i ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-ink-600 text-slate-400 hover:text-slate-200'}`}>
                        {b.start_fret}–{b.end_fret}
                      </button>
                    ))}
                  </div>
                } />
              {shownBox(boxIdx) && (
                <>
                  <Fretboard
                    mode="scales"
                    tuning={result.overview.tuning}
                    capo={result.overview.capo}
                    scalePitchClasses={sc.fretboard.pitch_classes || []}
                    scaleRootPc={sc.fretboard.root_pc || 0}
                    frets={Math.min(22, Math.max(12, (shownBox(boxIdx)?.end_fret ?? 5) + 3))}
                  />
                  <p className="mt-2 text-[11px] text-slate-500">{sc.fretboard.blurb}</p>
                </>
              )}
            </div>
          )}

          {/* per-note in/out of scale */}
          {!!sc.per_note?.length && (
            <div className="card p-4">
              <SectionTitle title="Every note, in context"
                subtitle="Click a note to jump to it" />
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {(sc.per_note || []).map((n, i) => (
                  <button key={i} onClick={() => onSeek?.(n.time)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[11px] transition ${
                      n.in_scale
                        ? 'bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                        : 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'}`}
                    title={`${n.name} · ${n.degree ?? ''} · ${n.in_scale ? 'in scale' : 'outside'}`}>
                    {n.name}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-sky-500/60" /> inside {solo.name}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded bg-orange-500/70" /> outside
                </span>
                <Badge tone="slate">R = root · b3 = minor 3rd · ♯4 = raised 4th</Badge>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
