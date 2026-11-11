import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListMusic, Pencil, Star, Trash2, Check, X } from 'lucide-react'
import { Badge, EmptyState, Notice, SectionTitle } from '../components/ui'
import { api } from '../services/api'
import { useAnalysis } from '../context'
import type { Project } from '../types'

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const { loadResult, jobId } = useAnalysis()
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    api.projects().then((r) => setProjects(r.projects)).catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
    }).finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  const open = async (p: Project) => {
    if (!p.job_id) return
    try {
      await loadResult(p.job_id)
      navigate('/analyse')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        msg.includes('404') || msg.toLowerCase().includes('no result')
          ? `Analysis data for "${p.name}" was cleared or removed from disk. You can delete this entry or re-analyse the audio.`
          : msg
      )
    }
  }

  const rename = async (id: string) => {
    await api.updateProject(id, { name: draft })
    setEditing(null)
    refresh()
  }

  const toggleStar = async (p: Project) => {
    await api.updateProject(p.id, { starred: !p.starred })
    refresh()
  }

  const remove = async (id: string) => {
    await api.deleteProject(id)
    refresh()
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title="My projects" icon={<ListMusic size={15} />}
        subtitle="Every analysis you have run, saved locally"
        right={<span className="text-[11px] text-slate-500">{projects.length} saved</span>}
      />

      {error && <Notice kind="error">{error}</Notice>}

      {loading ? (
        <div className="card shimmer h-32 rounded-xl" />
      ) : !projects.length ? (
        <EmptyState
          icon={<ListMusic size={30} />}
          title="No projects yet"
          body="Analyse a track and it will appear here automatically, with its chords, key and tempo."
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {projects.map((p) => (
            <div key={p.id}
              className={`card group p-4 transition hover:border-amber-500/40 ${
                p.job_id === jobId ? 'ring-1 ring-amber-500/40' : ''}`}>
              <div className="flex items-start gap-3">
                <button onClick={() => toggleStar(p)}
                  className={`mt-0.5 transition ${p.starred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}>
                  <Star size={14} fill={p.starred ? 'currentColor' : 'none'} />
                </button>

                <div className="min-w-0 flex-1">
                  {editing === p.id ? (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') rename(p.id); if (e.key === 'Escape') setEditing(null) }}
                        className="flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-amber-500" />
                      <button onClick={() => rename(p.id)} className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"><Check size={13} /></button>
                      <button onClick={() => setEditing(null)} className="rounded p-1 text-slate-500 hover:bg-ink-700"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => open(p)} className="block max-w-full truncate text-left text-sm font-medium text-slate-100 hover:text-amber-300">
                      {p.name}
                    </button>
                  )}

                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    {p.key && <span>{p.key}</span>}
                    {p.bpm ? <span>· {Math.round(p.bpm)} BPM</span> : null}
                    {p.chord_count != null && <span>· {p.chord_count} chords</span>}
                    {p.note_count != null && <span>· {p.note_count} notes</span>}
                    {p.duration && <span>· {p.duration.toFixed(0)}s</span>}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.solo_scale && <Badge tone="violet">{p.solo_scale}</Badge>}
                    {p.has_stems && <Badge tone="emerald">stems</Badge>}
                    {p.engines?.transcription && <Badge tone="slate">{String(p.engines.transcription)}</Badge>}
                    {p.engines?.separation && String(p.engines.separation).startsWith('demucs') && (
                      <Badge tone="sky">demucs</Badge>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => { setEditing(p.id); setDraft(p.name) }}
                    className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-amber-300">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => remove(p.id)}
                    className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-600">
        Projects are stored in <span className="font-mono">processed/store.json</span> — a plain
        file, no database setup. Deleting a project also deletes its processed audio and stems.
        Temporary files older than KEEP_TEMP_HOURS are cleared automatically.
      </p>
    </div>
  )
}
