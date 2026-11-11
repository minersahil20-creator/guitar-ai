import { useState } from 'react'
import { Download, GitBranch, Music4, Pause, Play, Repeat } from 'lucide-react'
import Fretboard from '../Fretboard'
import NoteList from '../NoteList'
import TabViewer from '../TabViewer'
import { Badge, Notice, SectionTitle, Stat } from '../ui'
import { api, fmtTime } from '../../services/api'
import type { AnalysisResult, Note } from '../../types'
import type { usePlayer } from '../../hooks/usePlayer'

interface Props {
  result: AnalysisResult
  time: number
  onSeek: (t: number) => void
  onResult: (r: AnalysisResult) => void
  player?: ReturnType<typeof usePlayer>
}

export default function SoloSection({ result, time, onSeek, onResult, player }: Props) {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const notes = result.solo?.notes ?? []
  const phrases = result.solo?.phrases ?? []
  const ranges = result.solo?.range

  const activeNote =
    notes.find((n) => time >= n.start && time < n.end && n.string != null && n.fret != null) ?? null

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Notes" value={notes.length} accent="amber" />
        <Stat label="Range" value={ranges?.lowest && ranges?.highest ? `${ranges.lowest}–${ranges.highest}` : '—'} />
        <Stat label="Repeated licks" value={phrases.length} accent="sky" />
        <Stat label="Engine" value={
          <span className="text-[13px]">
            {result.solo?.engine === 'basic-pitch' ? 'Basic Pitch (neural)' : 'Harmonic Tracker (DSP)'}
          </span>
        } hint={result.solo?.source ? `source: ${result.solo.source}` : undefined} />
      </div>

      {notes.length === 0 && (
        <Notice kind="warn" title="No notes detected">
          <p>
            No clear solo or lead guitar notes were detected in this track. If the guitar is
            layered into a full band mix, try the stem separation feature to isolate the lead guitar.
          </p>
        </Notice>
      )}

      {/* ── Solo Transport & Playhead Controls ── */}
      {player && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-3.5 bg-gradient-to-r from-ink-850 to-ink-900 border-amber-500/20">
          <div className="flex items-center gap-3">
            <button
              onClick={player.toggle}
              disabled={!player.ready}
              className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-ink-950 shadow-md shadow-amber-900/30 transition hover:from-amber-300 disabled:opacity-40">
              {player.playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <div className="font-mono text-xs text-slate-300">
              {fmtTime(time)} <span className="text-slate-600">/ {fmtTime(player.duration || result.overview?.duration || 0)}</span>
            </div>
            {activeNote && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 text-xs font-semibold">
                Now: {activeNote.name} {activeNote.string != null && activeNote.fret != null ? `(String ${activeNote.string + 1}, Fret ${activeNote.fret})` : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider hidden sm:inline">Speed:</span>
            {[0.5, 0.75, 1].map((s) => (
              <button
                key={s}
                onClick={() => player.setTempo(s)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] transition ${
                  Math.abs(player.tempo - s) < 0.01
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200 bg-ink-800'
                }`}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      )}

      {/* fretboard */}
      <div className="card p-4">
        <SectionTitle
          title="Interactive fretboard" icon={<Music4 size={15} />}
          subtitle="Detected solo notes, highlighted live during playback"
          right={
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="violet">purple = detected note</Badge>
              {activeNote && <Badge tone="amber">{activeNote.name}</Badge>}
            </div>
          }
        />
        <Fretboard
          mode="solo"
          tuning={result.overview?.tuning}
          capo={result.overview?.capo}
          soloNotes={notes}
          activeNote={activeNote && activeNote.string != null && activeNote.fret != null
            ? { string: activeNote.string, fret: activeNote.fret } : null}
          frets={15}
        />
      </div>

      {/* tabs */}
      <div className="card p-4">
        <SectionTitle
          title="Guitar tablature" icon={<GitBranch size={15} />}
          subtitle="Fingerings chosen by a dynamic-programming search that keeps your hand in one position"
          right={
            <div className="flex gap-2">
              <a href={api.exportUrl.midi(result.job_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
                <Download size={12} /> .mid
              </a>
              <a href={api.exportUrl.tab(result.job_id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300">
                <Download size={12} /> .txt
              </a>
            </div>
          }
        />
        <TabViewer tabs={result.tabs} currentTime={time} onSeek={onSeek} />
      </div>

      {/* repeated phrases */}
      {phrases.length > 0 && (
        <div className="card p-4">
          <SectionTitle title="Repeated phrases" icon={<Repeat size={15} />}
            subtitle="Identical interval patterns that appear more than once — the licks worth learning first" />
          <div className="space-y-2">
            {phrases.slice(0, 5).map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-700 bg-ink-850/50 p-2.5">
                <Badge tone="sky">{p.length_notes} notes</Badge>
                <span className="text-xs text-slate-400">×{p.occurrences}</span>
                <span className="font-mono text-[11px] text-slate-300">{(p.note_names || []).join(' ')}</span>
                <div className="ml-auto flex gap-1">
                  {(p.starts || []).slice(0, 4).map((s, k) => (
                    <button key={k} onClick={() => onSeek(s)}
                      className="rounded-md border border-ink-600 px-2 py-0.5 font-mono text-[10px] text-slate-400 transition hover:border-amber-500/50 hover:text-amber-300">
                      {(s || 0).toFixed(1)}s
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* note list */}
      <div className="card p-4">
        <SectionTitle title="Detected notes" icon={<Music4 size={15} />}
          subtitle="Hover a row to correct the pitch or delete a false detection"
          right={selectedNote ? <Badge tone="amber">{selectedNote.name}</Badge> : undefined} />
        <NoteList
          jobId={result.job_id}
          notes={notes}
          currentTime={time}
          onSeek={onSeek}
          onSelect={setSelectedNote}
          onChanged={async () => onResult(await api.result(result.job_id))}
        />
      </div>
    </div>
  )
}
