/**
 * api.ts — every call the frontend makes to the FastAPI backend.
 *
 * The base URL is '' (same origin) because the Vite dev server proxies
 * /api to http://127.0.0.1:8000 (see vite.config.ts). In production you can
 * point VITE_API_URL at a deployed backend.
 */
import type { AnalysisResult, Capabilities, JobStatus, Project, UrlDiagnosis, UrlInfo } from '../types'

const BASE = import.meta.env.VITE_API_URL ?? ''

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail =
      (data as { detail?: string | { msg?: string } })?.detail ??
      (data as { message?: string })?.message ??
      res.statusText
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return data as T
}

export const api = {
  health: () => json<{ status: string }>('/api/health'),
  capabilities: () => json<Capabilities>('/api/capabilities'),

  checkUrl: (url: string) =>
    json<{ fetched: boolean; job_id: string | null; info: UrlInfo }>(
      '/api/url',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }) },
    ),

  /** Upload + start analysis in one request. `onProgress` reports upload %. */
  async analyseFile(
    file: File,
    options: Record<string, unknown> = {},
    onProgress?: (pct: number) => void,
  ): Promise<{ job_id: string; estimated_seconds: number }> {
    const form = new FormData()
    form.append('file', file)
    form.append('options', JSON.stringify(options))
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/api/analyse/file`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText)
          if (xhr.status >= 200 && xhr.status < 300) resolve(data)
          else reject(new Error(data?.detail ?? data?.message ?? `HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`Unexpected server response (HTTP ${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error — is the backend running on port 8000?'))
      xhr.send(form)
    })
  },

  analyse: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string; estimated_seconds: number }>('/api/analyse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, options }),
    }),

  /**
   * Paste-a-link: fetch the audio, then run the same pipeline as an upload.
   * When a platform refuses (bot check, private, age gate…) the backend
   * answers 422 with {kind, message, hint} — we keep all three so the UI can
   * explain exactly what happened and what to do instead.
   */
  async analyseUrl(url: string, options: Record<string, unknown> = {}) {
    const res = await fetch(`${BASE}/api/analyse/url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, options }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 422 && data) {
        const err = new Error(data.message || 'That link cannot be fetched.') as Error & {
          kind?: string; hint?: string
        }
        err.kind = data.kind
        err.hint = data.hint
        throw err
      }
      throw new Error(data?.detail ?? data?.message ?? res.statusText)
    }
    return data as { job_id: string; title?: string; duration?: number; status: string }
  },

  /** Settings-page helper: asks the backend what a link is and whether it's reachable. */
  diagnoseUrl: (url: string) =>
    json<UrlDiagnosis>('/api/url/diagnose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  job: (jobId: string) => json<JobStatus>(`/api/jobs/${jobId}`),
  jobs: () => json<{ jobs: JobStatus[]; queued: number }>('/api/jobs'),
  cancelJob: (jobId: string) => json<{ job_id: string; status: string }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),

  result: (jobId: string) => json<AnalysisResult>(`/api/results/${jobId}`),

  // single-stage reruns
  runChords: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string }>('/api/chords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, options }) }),
  runTranscribe: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string }>('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, options }) }),
  runScales: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string }>('/api/scales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, options }) }),
  runSeparate: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string }>('/api/separate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, options }) }),
  makeBackingTrack: (jobId: string, options: Record<string, unknown> = {}) =>
    json<{ job_id: string }>('/api/backing-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, options }) }),

  // manual corrections
  correctChord: (jobId: string, index: number, body: { root_pc?: number; quality?: string; bass_pc?: number }) =>
    json<{ ok: boolean; chord: unknown }>(`/api/results/${jobId}/chords/${index}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  correctNote: (jobId: string, index: number, body: { midi?: number; start?: number; end?: number }) =>
    json<{ ok: boolean }>(`/api/results/${jobId}/notes/${index}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteNote: (jobId: string, index: number) =>
    json<{ ok: boolean }>(`/api/results/${jobId}/notes/${index}`, { method: 'DELETE' }),

  projects: () => json<{ projects: Project[] }>('/api/projects'),
  project: (id: string) => json<{ project: Project; has_result: boolean }>(`/api/projects/${id}`),
  updateProject: (id: string, body: Partial<Project>) =>
    json<{ project: Project }>(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteProject: (id: string) => json<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  exportUrl: {
    tab: (jobId: string) => `${BASE}/api/export/${jobId}/tab`,
    midi: (jobId: string) => `${BASE}/api/export/${jobId}/midi`,
    chords: (jobId: string) => `${BASE}/api/export/${jobId}/chords`,
    json: (jobId: string) => `${BASE}/api/export/${jobId}/json`,
  },
}

/** Poll a job until it finishes. Calls onUpdate with each status. */
export function pollJob(
  jobId: string,
  onUpdate: (job: JobStatus) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<JobStatus> {
  const { intervalMs = 700, timeoutMs = 20 * 60 * 1000 } = opts
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await api.job(jobId)
        onUpdate(job)
        if (job.status === 'done') {
          resolve(job)
          return
        }
        if (job.status === 'error') {
          reject(new Error(job.message || 'Operation failed'))
          return
        }
        if (job.status === 'cancelled') {
          reject(new Error('Operation was cancelled'))
          return
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Analysis timed out after 20 minutes.'))
          return
        }
        setTimeout(tick, intervalMs)
      } catch (err) {
        reject(err)
      }
    }
    tick()
  })
}

export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export const fmtTimeMs = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}
