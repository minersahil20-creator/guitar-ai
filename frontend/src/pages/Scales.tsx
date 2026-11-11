import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Scale as ScaleIcon, Upload } from 'lucide-react'
import ScalesSection from '../components/sections/ScalesSection'
import { EmptyState, Notice, SectionTitle, Spinner } from '../components/ui'
import { api, pollJob } from '../services/api'
import { useAnalysis } from '../context'
import { usePlayer } from '../hooks/usePlayer'

export default function Scales() {
  const { result, setResult } = useAnalysis()
  const navigate = useNavigate()
  const player = usePlayer(result?.media?.url)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  const rerun = async () => {
    if (!result) return
    setRunning(true)
    try {
      const { job_id } = await api.runScales(result.job_id, { tuning: 'standard' })
      await pollJob(job_id, (j) => setMsg(`${j.stage}: ${j.message}`))
      setResult(await api.result(result.job_id))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setRunning(false) }
  }

  if (!result) {
    return (
      <EmptyState
        icon={<ScaleIcon size={30} />}
        title="No track loaded"
        body="Scale analysis works on the notes found in a recording — upload one first."
        action={
          <button onClick={() => navigate('/analyse')}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-4 py-2 text-sm font-semibold text-ink-950">
            <Upload size={14} /> Analyse a song
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle
          title="Scale finder" icon={<ScaleIcon size={15} />}
          subtitle="Song key and solo scale are analysed separately — they are often different"
        />
        <button onClick={rerun} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50">
          {running ? <Spinner /> : <RefreshCw size={12} />}
          {running ? msg || 'Analysing…' : 'Re-run scale analysis'}
        </button>
      </div>
      {msg && !running && <Notice kind="info">{msg}</Notice>}
      <ScalesSection result={result} onSeek={(t) => void player.seek(t)} />
    </div>
  )
}
