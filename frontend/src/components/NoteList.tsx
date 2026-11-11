import { memo, useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import type { Note } from '../types'
import { ConfidenceBar, Notice } from './ui'
import { api, fmtTimeMs } from '../services/api'

interface Props {
  jobId: string
  notes: Note[]
  currentTime?: number
  onSeek?: (t: number) => void
  onSelect?: (n: Note) => void
  onChanged?: () => void
}

const TECH_LABEL: Record<string, string> = {
  h: 'hammer-on', p: 'pull-off', '/': 'slide up', '\\': 'slide down', b: 'bend', '~': 'vibrato',
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

interface RowProps {
  n: Note
  i: number
  active: boolean
  isEditing: boolean
  draft: string
  busy: boolean
  onSeek?: (t: number) => void
  onSelect?: (n: Note) => void
  onStartEdit: (i: number, name: string) => void
  onDraftChange: (v: string) => void
  onSave: (i: number, val: string) => void
  onCancelEdit: () => void
  onRemove: (i: number) => void
}

const MemoizedNoteRow = memo(function MemoizedNoteRow({
  n,
  i,
  active,
  isEditing,
  draft,
  busy,
  onSeek,
  onSelect,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancelEdit,
  onRemove,
}: RowProps) {
  return (
    <div
      data-note-idx={i}
      onClick={() => {
        onSeek?.(n.start)
        onSelect?.(n)
      }}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg border px-2.5 py-1.5 transition ${
        active
          ? 'border-amber-400/60 bg-amber-500/15'
          : 'border-ink-700 bg-ink-850/50 hover:border-ink-600'
      }`}
    >
      <span className="w-14 shrink-0 font-mono text-[10.5px] text-slate-500">
        {fmtTimeMs(n.start)}
      </span>

      {isEditing ? (
        <div className="flex flex-1 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(i, draft)
              if (e.key === 'Escape') onCancelEdit()
            }}
            placeholder="e.g. A4"
            className="w-20 rounded border border-ink-600 bg-ink-900 px-2 py-0.5 font-mono text-xs text-slate-200 outline-none focus:border-amber-500"
          />
          <button
            disabled={busy}
            onClick={() => onSave(i, draft)}
            className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
          >
            <Check size={13} />
          </button>
          <button
            onClick={onCancelEdit}
            className="rounded p-1 text-slate-500 hover:bg-ink-700"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          <span
            className={`w-12 shrink-0 font-mono text-[13px] font-semibold ${
              active ? 'text-amber-200' : 'text-slate-200'
            }`}
          >
            {n.name}
          </span>
          {n.string != null && n.fret != null && (
            <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {n.string + 1}·{n.fret}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {n.techniques?.map((t, k) => (
              <span key={k} className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                {TECH_LABEL[t] ?? t}
              </span>
            ))}
            {n.vibrato && (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                vibrato
              </span>
            )}
            {(n.bend_semitones ?? 0) > 0.5 && (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                bend {n.bend_semitones?.toFixed(1)}st
              </span>
            )}
            {n.slide_from != null && (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                slide
              </span>
            )}
            {n.legato && (
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9.5px] text-violet-300">
                {n.legato}
              </span>
            )}
          </div>
          <div className="hidden w-24 sm:block">
            <ConfidenceBar value={n.confidence} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit(i, n.name)
              }}
              className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-amber-300"
              title="Correct pitch"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(i)
              }}
              className="rounded p-1 text-slate-500 hover:bg-ink-700 hover:text-red-400"
              title="Delete note"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  )
})

/** Editable list of detected notes (confidence, timing, pitch). */
export default function NoteList({ jobId, notes, currentTime = 0, onSeek, onSelect, onChanged }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const activeIdx = notes.findIndex((n) => currentTime >= n.start && currentTime < n.end)

  useEffect(() => {
    if (activeIdx < 0 || !scrollerRef.current) return
    const container = scrollerRef.current
    const el = container.querySelector<HTMLElement>(`[data-note-idx="${activeIdx}"]`)
    if (el) {
      const cRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const topDiff = elRect.top - cRect.top
      const bottomDiff = elRect.bottom - cRect.bottom

      if (topDiff < 0 || bottomDiff > 0) {
        container.scrollTo({
          top: container.scrollTop + topDiff - 32,
          behavior: 'auto',
        })
      }
    }
  }, [activeIdx])

  const save = async (index: number, val: string) => {
    const trimmed = val.trim()
    const m = NOTE_NAMES.findIndex((x) => x === trimmed.slice(0, -1).toUpperCase())
    if (m < 0) return
    const oct = parseInt(trimmed.slice(-1), 10)
    if (isNaN(oct)) return
    const midi = (oct + 1) * 12 + m

    setBusy(true)
    setErr(null)
    try {
      await api.correctNote(jobId, index, { midi })
      setEditing(null)
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (index: number) => {
    setBusy(true)
    setErr(null)
    try {
      await api.deleteNote(jobId, index)
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!notes.length) {
    return (
      <Notice kind="info">
        No individual notes were detected. This is normal for pure rhythm parts, heavily
        distorted walls of sound, or audio where the guitar is buried in the mix — try the
        stem-separation step and re-run transcription on the isolated guitar.
      </Notice>
    )
  }

  return (
    <div className="space-y-2">
      {err && <Notice kind="error">{err}</Notice>}
      <div ref={scrollerRef} className="max-h-[430px] space-y-1 overflow-y-auto pr-1">
        {notes.map((n, i) => (
          <MemoizedNoteRow
            key={i}
            n={n}
            i={i}
            active={i === activeIdx}
            isEditing={editing === i}
            draft={draft}
            busy={busy}
            onSeek={onSeek}
            onSelect={onSelect}
            onStartEdit={(idx, name) => {
              setEditing(idx)
              setDraft(name)
            }}
            onDraftChange={setDraft}
            onSave={save}
            onCancelEdit={() => setEditing(null)}
            onRemove={remove}
          />
        ))}
      </div>
    </div>
  )
}
