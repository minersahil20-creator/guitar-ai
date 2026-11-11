import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music4, RefreshCw, Upload } from 'lucide-react'
import SoloSection from '../components/sections/SoloSection'
import { EmptyState, Notice, SectionTitle, Spinner } from '../components/ui'
import { api, pollJob } from '../services/api'
import { useAnalysis } from '../context'
import { usePlayer } from '../hooks/usePlayer'

export default function Solo() {
  const { result, setResult } = useAnalysis()
  const navigate = useNavigate()
  const player = usePlayer(result?.media?.url)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  const rerun = async () => {
    if (!result) return
    setRunning(true)
    try {
      const { job_id } = await api.runTranscribe(result.job_id, {
        tuning: 'standard', capo: result.overview.capo,
      })
      await pollJob(job_id, (j) => setMsg(`${j.stage}: ${j.message}`))
      setResult(await api.result(result.job_id))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setRunning(false) }
  }

  if (!result) {
    return (
      <EmptyState
        icon={<Music4 size={30} />}
        title="No track loaded"
        body="Upload a recording with a guitar part to transcribe the solo into notes and tablature."
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
          title="Solo transcription" icon={<Music4 size={15} />}
          subtitle="Notes → tablature → fretboard, with bends, slides, vibrato and legato flagged"
        />
        <button onClick={rerun} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-[11.5px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50">
          {running ? <Spinner /> : <RefreshCw size={12} />}
          {running ? msg || 'Transcribing…' : 'Re-run transcription'}
        </button>
      </div>
      {msg && !running && <Notice kind="info">{msg}</Notice>}
      <SoloSection
        result={result}
        time={player.time}
        onSeek={(t) => void player.seek(t)}
        onResult={(r) => setResult(r)}
        player={player}
      />
    </div>
  )
}
