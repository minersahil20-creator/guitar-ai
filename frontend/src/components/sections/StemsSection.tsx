import { useState } from 'react'
import { RefreshCw, Scissors, Sparkles } from 'lucide-react'
import StemMixer from '../StemMixer'
import { Notice, SectionTitle, Spinner } from '../ui'
import { api, pollJob } from '../../services/api'
import type { AnalysisResult } from '../../types'

interface Props {
  result: AnalysisResult
  onResult: (r: AnalysisResult) => void
}

export default function StemsSection({ result, onResult }: Props) {
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  const rerun = async () => {
    setRunning(true)
    setErr(null)
    setProgressPct(5)
    setMsg('Starting stem separation…')
    try {
      const { job_id } = await api.runSeparate(result.job_id)
      await pollJob(job_id, (j) => {
        setProgressPct(j.progress || 0)
        setMsg(j.message ? `${j.stage}: ${j.message}` : `${j.stage}…`)
      })
      const updated = await api.result(result.job_id)
      onResult(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      setMsg('')
      setProgressPct(0)
    }
  }

  if (!result.stems) {
    return (
      <div className="space-y-3">
        <Notice kind="info" title="Stem separation was skipped">
          This analysis ran without separation (it is the slowest step on CPU). Run it now with Meta Demucs to get
          the isolated guitar stem, backing track (no guitar), drums, bass, vocals, and keys.
        </Notice>
        <button
          onClick={rerun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:from-amber-300 disabled:opacity-50"
        >
          {running ? <Spinner /> : <Sparkles size={15} />}
          {running ? msg || 'Separating stems…' : 'Separate stems with AI'}
        </button>
        {running && (
          <div className="card space-y-2 p-4">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <Spinner className="h-3 w-3" /> {msg || 'Processing audio with Demucs…'}
              </span>
              <span className="font-mono text-amber-400">{progressPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-900">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
                style={{ width: `${Math.max(5, progressPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle
          title="Stem separation studio"
          icon={<Scissors size={15} />}
          subtitle={`Engine: ${result.stems.engine} (${result.stems.is_true_separation ? 'Real AI source separation' : 'Signal processing fallback'})`}
        />
        <button
          onClick={rerun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
        >
          {running ? <Spinner className="mr-1" /> : <RefreshCw size={13} />}
          {running ? 'Separating stems…' : 'Re-run separation'}
        </button>
      </div>

      {running && (
        <div className="card space-y-2 border-amber-500/30 bg-ink-850/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-200">
            <span className="flex items-center gap-2 font-medium">
              <Spinner className="h-3.5 w-3.5 text-amber-400" /> {msg || 'Separating stems with Demucs…'}
            </span>
            <span className="font-mono font-bold text-amber-400">{progressPct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-950">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
              style={{ width: `${Math.max(5, progressPct)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Demucs 6-stem AI model (htdemucs_6s) extracts isolated guitar, backing track, drums, bass, vocals, and piano.
          </p>
        </div>
      )}

      {err && <Notice kind="error">{err}</Notice>}
      <StemMixer stems={result.stems} jobId={result.job_id} />
    </div>
  )
}
