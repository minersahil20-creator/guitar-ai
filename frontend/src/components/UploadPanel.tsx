import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Download, FileAudio, KeyRound, Link2, Loader2, Settings2, Upload, X } from 'lucide-react'
import { api } from '../services/api'
import { useAnalysis } from '../context'
import type { UrlInfo } from '../types'
import { Notice, ProgressBar } from './ui'

const EXT = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.mp4', '.mov', '.mkv', '.webm']

interface Props {
  compact?: boolean
  onStarted?: (jobId: string) => void
}

/** The "paste a link or drop a file" panel used on Home and Analyse. */
export default function UploadPanel({ compact = false, onStarted }: Props) {
  const navigate = useNavigate()
  const { runFile, runUrl, loading, error, setError } = useAnalysis()
  const inputRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [url, setUrl] = useState('')
  const [urlInfo, setUrlInfo] = useState<UrlInfo | null>(null)
  const [checkingUrl, setCheckingUrl] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [urlHint, setUrlHint] = useState<string | null>(null)
  const [showOpts, setShowOpts] = useState(false)
  const [opts, setOpts] = useState({
    separation: true,
    transcription: true,
    gemini: true,
    tuning: 'standard',
  })

  const pick = (f: File | undefined | null) => {
    if (!f) return
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    if (!EXT.includes(ext)) {
      setError(`Unsupported file type "${ext}". Allowed: ${EXT.join(', ')}`)
      return
    }
    setError(null)
    setFile(f)
    setUrl('')
    setUrlInfo(null)
    setUrlHint(null)
  }

  const checkUrl = async () => {
    if (!url.trim()) return
    setCheckingUrl(true)
    setUrlHint(null)
    try {
      const r = await api.checkUrl(url.trim())
      setUrlInfo(r.info)
      setUrlHint((r.info as { what_to_do?: string }).what_to_do ?? null)
    } catch (e) {
      setUrlInfo({
        ok: false, kind: 'error', name: 'Error', can_fetch: false,
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setCheckingUrl(false)
    }
  }

  const start = async () => {
    if (!file) return
    navigate('/analyse')
    try {
      setUploadPct(0)
      const id = await runFile(file, opts, setUploadPct)
      onStarted?.(id)
    } catch {
      /* error surfaced through context */
    }
  }

  /** Download the audio behind the checked link, then analyse it. */
  const startUrl = async () => {
    if (!url.trim()) return
    setFetching(true)
    navigate('/analyse')
    try {
      const id = await runUrl(url.trim(), opts)
      onStarted?.(id)
    } catch (e) {
      // The backend tells us *why* a platform refused and what to do instead.
      const msg = e instanceof Error ? e.message : String(e)
      const hint = (e as { hint?: string }).hint
      // Metadata can succeed while the download is refused, so turn the green
      // "Found it" card into the explanation of what actually went wrong.
      setUrlInfo((prev) => prev && { ...prev, can_fetch: false,
        why_blocked: msg, what_to_do: hint ?? prev.what_to_do })
      if (hint) setUrlHint(hint)
    } finally {
      setFetching(false)
    }
  }

  const urlReady = !!url.trim() && (urlInfo === null || urlInfo?.can_fetch !== false)

  return (
    <div className="space-y-4">
      {/* dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]) }}
        onClick={() => inputRef.current?.click()}
        className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all ${
          dragging
            ? 'border-amber-400 bg-amber-500/10'
            : 'border-ink-600 bg-ink-850/50 hover:border-amber-500/50 hover:bg-ink-800/50'
        } ${compact ? 'px-6 py-8' : 'px-6 py-12'}`}>
        <input ref={inputRef} type="file" accept={EXT.join(',')} className="hidden"
               onChange={(e) => pick(e.target.files?.[0])} />
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`grid h-14 w-14 place-items-center rounded-2xl transition-all ${
            dragging ? 'bg-amber-500/25 animate-pulse-ring' : 'bg-ink-800 group-hover:bg-ink-700'}`}>
            <Upload size={22} className={dragging ? 'text-amber-300' : 'text-slate-400'} />
          </div>
          {file ? (
            <>
              <div className="flex max-w-full items-center gap-2">
                <FileAudio size={15} className="shrink-0 text-amber-400" />
                <span className="truncate text-sm font-medium text-slate-100">{file.name}</span>
                <button onClick={(e) => { e.stopPropagation(); setFile(null) }}
                        className="rounded p-0.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200">
                  <X size={13} />
                </button>
              </div>
              <div className="text-xs text-slate-500">{(file.size / 1e6).toFixed(1)} MB — ready to analyse</div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-200">
                Drop an audio or video file here, or click to browse
              </div>
              <div className="text-xs text-slate-500">
                MP3 · WAV · M4A · FLAC · OGG · MP4 · MOV — up to 15 minutes
              </div>
            </>
          )}
        </div>
      </div>

      {/* URL */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlInfo(null) }}
            onKeyDown={(e) => e.key === 'Enter' && checkUrl()}
            placeholder="…or paste a YouTube / SoundCloud / Instagram link"
            className="w-full rounded-xl border border-ink-600 bg-ink-850/70 py-2.5 pl-9 pr-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"
          />
        </div>
        <button onClick={checkUrl} disabled={!url.trim() || checkingUrl}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink-600 bg-ink-800/70 px-4 py-2.5 text-sm text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40">
          {checkingUrl ? <Loader2 size={14} className="animate-spin" /> : null} Check link
        </button>
      </div>

      {urlInfo && urlInfo.can_fetch && (
        <Notice kind="success" title={`Found: ${urlInfo.title ?? urlInfo.name}`}>
          <p>
            {[
              urlInfo.uploader,
              urlInfo.duration_label,
              urlInfo.extractor,
            ].filter(Boolean).join('  ·  ')}
          </p>
          <p className="text-slate-400">
            Ready to fetch. We download the audio only — no video — and then run the
            same analysis as an uploaded file.
          </p>
        </Notice>
      )}

      {urlInfo && !urlInfo.can_fetch && (
        <Notice kind={urlInfo.error_kind === 'bot_check' ? 'info' : 'warn'} title={urlInfo.name}>
          <p>{urlInfo.why_blocked || urlInfo.message || urlInfo.note}</p>
          {(urlInfo.what_to_do || urlHint) && (
            <p className="text-slate-400">{urlInfo.what_to_do || urlHint}</p>
          )}
          {(urlInfo.error_kind === 'bot_check' || urlInfo.error_kind === 'login_required') && (
            <button
              onClick={() => navigate('/settings')}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/20">
              <KeyRound size={12} /> Fix this now: sign in with your cookies
            </button>
          )}
        </Notice>
      )}

      {/* options */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowOpts((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/50 px-2.5 py-1.5 text-xs text-slate-400 transition hover:text-slate-200">
          <Settings2 size={13} /> Options
        </button>
        <div className="text-[11px] text-slate-600">
          {opts.separation ? 'backing track generation on' : 'backing track generation off (faster)'}
        </div>
      </div>

      {showOpts && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 text-xs">
            <input type="checkbox" checked={opts.separation}
              onChange={(e) => setOpts({ ...opts, separation: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-amber-500" />
            <span>
              <span className="font-medium text-slate-200">Make backing track</span>
              <span className="block text-slate-500">Remove guitars to create a play-along backing track.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-xs">
            <input type="checkbox" checked={opts.transcription}
              onChange={(e) => setOpts({ ...opts, transcription: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-amber-500" />
            <span>
              <span className="font-medium text-slate-200">Solo transcription</span>
              <span className="block text-slate-500">Detect individual notes and build tablature.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-xs">
            <input type="checkbox" checked={opts.gemini}
              onChange={(e) => setOpts({ ...opts, gemini: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 accent-amber-500" />
            <span>
              <span className="font-medium text-slate-200">Gemini explanations</span>
              <span className="block text-slate-500">Uses your free API key if configured; otherwise local text.</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-300">Tuning</span>
            <select value={opts.tuning} onChange={(e) => setOpts({ ...opts, tuning: e.target.value })}
              className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-slate-200 outline-none">
              <option value="standard">Standard E A D G B E</option>
              <option value="half_down">Eb (half step down)</option>
              <option value="drop_d">Drop D</option>
              <option value="drop_c">Drop C</option>
              <option value="whole_down">D standard</option>
              <option value="open_g">Open G</option>
              <option value="open_d">Open D</option>
              <option value="dadgad">D A D G A D</option>
            </select>
          </label>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          <ProgressBar value={uploadPct} />
          <div className="text-xs text-slate-400">
            {fetching
              ? 'Fetching the link (download + convert to audio)…'
              : uploadPct < 100
                ? `Uploading… ${uploadPct}%`
                : 'Analysing… this can take a minute or two on CPU.'}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {urlHint && urlInfo && !urlInfo.can_fetch && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-200">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{urlHint}</span>
        </div>
      )}

      {urlReady ? (
        <button onClick={startUrl} disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-5 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-amber-900/30 transition hover:from-amber-300 hover:to-amber-500 disabled:cursor-not-allowed disabled:opacity-40">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {loading ? (fetching ? 'Fetching link…' : 'Analysing…') : 'Fetch & analyse this link'}
        </button>
      ) : (
        <button onClick={start} disabled={!file || loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-5 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-amber-900/30 transition hover:from-amber-300 hover:to-amber-500 disabled:cursor-not-allowed disabled:opacity-40">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {loading ? 'Analysing…' : 'Analyse this track'}
        </button>
      )}
    </div>
  )
}
