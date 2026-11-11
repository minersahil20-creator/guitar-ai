import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Cpu, Database, Info, KeyRound, Link2, Loader2, Server, Sparkles, Trash2, Upload, XCircle } from 'lucide-react'
import { Badge, Card, Notice, SectionTitle } from '../components/ui'
import { api } from '../services/api'
import type { Capabilities, UrlDiagnosis } from '../types'

export default function Settings() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [testUrl, setTestUrl] = useState('')
  const [diag, setDiag] = useState<UrlDiagnosis | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const cookieRef = useRef<HTMLInputElement>(null)
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)

  const runDiagnose = async () => {
    if (!testUrl.trim()) return
    setDiagBusy(true)
    setDiag(null)
    try {
      setDiag(await api.diagnoseUrl(testUrl.trim()))
    } catch (e) {
      setDiag(null)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDiagBusy(false)
    }
  }

  const uploadCookies = async (f: File | undefined | null) => {
    if (!f) return
    setCookieBusy(true)
    setCookieMsg(null)
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch('/api/url/cookies', { method: 'POST', body: form })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail ?? `HTTP ${res.status}`)
      setCookieMsg(data.message as string)
      setCaps(await api.capabilities())
    } catch (e) {
      setCookieMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setCookieBusy(false)
    }
  }

  const removeCookies = async () => {
    setCookieBusy(true)
    setCookieMsg(null)
    try {
      const res = await fetch('/api/url/cookies', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCookieMsg('Cookies removed.')
      setCaps(await api.capabilities())
    } catch (e) {
      setCookieMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setCookieBusy(false)
    }
  }

  useEffect(() => {
    api.capabilities().then(setCaps).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const backend = caps?.engines ?? []
  const ck = caps?.url_fetch?.cookies

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionTitle title="Settings" subtitle="Everything runs locally. Nothing here costs money." icon={<Server size={15} />} />

      {err && (
        <Notice kind="error" title="Backend unreachable">
          <p>{err}</p>
          <p className="font-mono text-[11px]">cd backend &amp;&amp; uvicorn app.main:app --reload --port 8000</p>
        </Notice>
      )}

      {/* engines */}
      <div>
        <SectionTitle title="Engines" subtitle="Green = installed and in use" icon={<Cpu size={15} />} />
        <div className="space-y-2">
          {backend.map((e) => (
            <Card key={e.id} className="flex items-start gap-3">
              {e.installed
                ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                : <XCircle size={15} className="mt-0.5 shrink-0 text-slate-600" />}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-200">{e.name}</span>
                  {e.required && <Badge tone="sky">required</Badge>}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{e.note}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* limits */}
      {caps && (
        <div>
          <SectionTitle title="Limits" subtitle="Change these in backend/.env" icon={<Database size={15} />} />
          <Card>
            <dl className="grid gap-2 text-[12px] sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Max upload</dt>
                <dd className="font-mono text-slate-200">{caps.limits.max_upload_mb} MB</dd>
              </div>
              <div>
                <dt className="text-slate-500">Max duration</dt>
                <dd className="font-mono text-slate-200">
                  {Math.round(caps.limits.max_duration_seconds / 60)} min
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Formats</dt>
                <dd className="font-mono text-[10.5px] text-slate-300">
                  {caps.limits.allowed_extensions.map((x) => x.replace('.', '')).join(' · ')}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}

      {/* link fetching */}
      <div>
        <SectionTitle title="Link fetching" icon={<Link2 size={15} />}
          subtitle="Paste a link instead of a file — public media only" />
        <Card className="space-y-3">
          <dl className="grid gap-2 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">yt-dlp</dt>
              <dd className="font-mono text-slate-200">
                {caps?.url_fetch.yt_dlp ? `v${caps.url_fetch.yt_dlp}` : 'not installed'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">ffmpeg</dt>
              <dd className="truncate font-mono text-slate-200" title={caps?.url_fetch.ffmpeg ?? ''}>
                {caps?.url_fetch.ffmpeg ? 'found' : 'not installed'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Max link length</dt>
              <dd className="font-mono text-slate-200">
                {caps ? Math.round(caps.url_fetch.max_duration_sec / 60) : '—'} min
              </dd>
            </div>
          </dl>

          {caps && !caps.url_fetch.ready && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11.5px] text-amber-200">
              {caps.url_fetch.why_not}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runDiagnose()}
              placeholder="Paste a link to test it (no audio is downloaded)"
              className="w-full rounded-xl border border-ink-600 bg-ink-850/70 py-2 px-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-amber-500/60"
            />
            <button onClick={runDiagnose} disabled={!testUrl.trim() || diagBusy}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink-600 bg-ink-800/70 px-4 py-2 text-xs text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40">
              {diagBusy ? <Loader2 size={13} className="animate-spin" /> : null} Test link
            </button>
          </div>

          {diag?.probe && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11.5px] text-emerald-200">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>
                Reachable — <span className="font-medium">{diag.probe.title}</span>
                {diag.probe.duration ? ` · ${Math.floor(diag.probe.duration / 60)}:${String(Math.round(diag.probe.duration % 60)).padStart(2, '0')}` : ''}
                {diag.probe.uploader ? ` · ${diag.probe.uploader}` : ''}
                {diag.probe.extractor ? ` · ${diag.probe.extractor}` : ''}
              </span>
            </div>
          )}

          {diag?.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-[11.5px] text-red-200">
              <div className="font-medium">{diag.error.message}</div>
              {diag.error.hint && <div className="mt-1 text-slate-400">{diag.error.hint}</div>}
            </div>
          )}

          {/* cookies */}
          <div className="space-y-2 rounded-lg border border-ink-600 bg-ink-850/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11.5px] text-slate-300">
                <KeyRound size={13} className="text-slate-500" />
                {ck?.loaded ? (
                  <span>
                    Cookies loaded — {ck.entries} entries
                    {ck.youtube ? <span className="text-emerald-300"> · YouTube ✓</span> : null}
                    {ck.instagram ? <span className="text-emerald-300"> · Instagram ✓</span> : null}
                    {ck.expires_in_days != null ? ` · expires in ${ck.expires_in_days} day${ck.expires_in_days === 1 ? '' : 's'}` : ''}
                  </span>
                ) : (
                  <span className="text-slate-500">
                    No cookies — needed for YouTube (bot check) and Instagram (login)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => cookieRef.current?.click()} disabled={cookieBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 text-[11px] text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40">
                  {cookieBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Upload cookies.txt
                </button>
                {ck?.loaded && (
                  <button onClick={removeCookies} disabled={cookieBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800/70 px-2.5 py-1.5 text-[11px] text-slate-400 transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-40">
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
            </div>
            <input ref={cookieRef} type="file" accept=".txt,.cookies" className="hidden"
                   onChange={(e) => uploadCookies(e.target.files?.[0])} />
            <ol className="list-inside list-decimal space-y-0.5 text-[11px] text-slate-500">
              <li>Install the browser extension <span className="text-slate-300">“Get cookies.txt LOCALLY”</span> (Chrome, Edge or Firefox).</li>
              <li>Open YouTube <span className="text-slate-300">while signed in to your own account</span>.</li>
              <li>Click the extension → <span className="text-slate-300">Export</span> → <span className="text-slate-300">Current site</span> → save the file.</li>
              <li>Upload it here, then test your link again.</li>
            </ol>
            {cookieMsg && (
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-sky-200">
                {cookieMsg}
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-slate-600">
            We only fetch media the platform serves publicly. Age gates, private or members-only
            items, region blocks and “confirm you’re not a bot” checks are reported, never
            bypassed. YouTube, Instagram and TikTok routinely block downloads that come from
            server/cloud IP addresses — if you see a bot-check message here, run the backend on
            your own computer (home internet) and the same link will usually work.
          </p>
        </Card>
      </div>

      {/* Gemini */}
      <div>
        <SectionTitle title="Google Gemini (optional)" icon={<Sparkles size={15} />}
          subtitle="Free tier — used only for prose explanations of measured results" />
        <Card className="space-y-2">
          {caps?.gemini.configured ? (
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 size={14} /> Connected — models: {caps.gemini.models.join(', ')}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <XCircle size={14} className="text-slate-600" /> No API key set — using free local explanations
              </div>
              <ol className="list-inside list-decimal space-y-1 text-[11.5px] text-slate-500">
                <li>Get a free key at aistudio.google.com/apikey (no card required).</li>
                <li>Open <span className="font-mono text-slate-400">backend/.env</span>.</li>
                <li>Set <span className="font-mono text-slate-400">GEMINI_API_KEY=your_key_here</span>.</li>
                <li>Restart the backend.</li>
              </ol>
            </>
          )}
          <p className="text-[11px] leading-relaxed text-slate-600">
            Gemini never sees your audio. It only receives the measured chord, scale and note data
            and is instructed to use nothing else — so it cannot invent notes that were not detected.
          </p>
        </Card>
      </div>

      {/* privacy */}
      <div>
        <SectionTitle title="Privacy & storage" icon={<Info size={15} />} />
        <Card className="space-y-2 text-[11.5px] leading-relaxed text-slate-400">
          <p>
            Audio is stored only in <span className="font-mono text-slate-300">uploads/</span> and
            <span className="font-mono text-slate-300"> processed/</span> on this machine. Nothing is
            uploaded to a third party. If you enable Gemini, only a small JSON summary of the
            analysis (chord names, note names, timings) is sent — never the audio itself.
          </p>
          <p>
            Temporary files are deleted automatically after the interval set by
            <span className="font-mono text-slate-300"> KEEP_TEMP_HOURS</span> (default 24h), and you
            can delete any project — with its audio — from the Projects page.
          </p>
        </Card>
      </div>
    </div>
  )
}
