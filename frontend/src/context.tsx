import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './services/api'
import type { AnalysisResult, JobStatus } from './types'

interface AnalysisState {
  jobId: string | null
  setJobId: (id: string | null) => void
  result: AnalysisResult | null
  setResult: (r: AnalysisResult | null) => void
  job: JobStatus | null
  setJob: (j: JobStatus | null) => void
  loading: boolean
  error: string | null
  setError: (e: string | null) => void
  /** Upload a file and run the full pipeline, polling until it finishes. */
  runFile: (file: File, options?: Record<string, unknown>, onProgress?: (pct: number) => void) => Promise<string>
  /** Fetch a pasted link, then run the full pipeline. Throws a descriptive
   *  error (with `.hint`) when the platform refuses the download. */
  runUrl: (url: string, options?: Record<string, unknown>) => Promise<string>
  /** Load an existing result (e.g. from Projects). */
  loadResult: (jobId: string) => Promise<void>
  clear: () => void
}

const STORAGE_KEY = 'guitar-ai:last-job'

const fallbackState: AnalysisState = {
  jobId: null,
  setJobId: () => {},
  result: null,
  setResult: () => {},
  job: null,
  setJob: () => {},
  loading: false,
  error: null,
  setError: () => {},
  runFile: async () => '',
  runUrl: async () => '',
  loadResult: async () => {},
  clear: () => {},
}

// Preserve context reference across Vite HMR / React Fast Refresh
const globalObj = (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as {
  __GUITAR_AI_CTX__?: React.Context<AnalysisState | null>
  __GUITAR_AI_STATE__?: AnalysisState
}

const Ctx =
  globalObj.__GUITAR_AI_CTX__ ??
  (globalObj.__GUITAR_AI_CTX__ = createContext<AnalysisState | null>(null))

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [jobId, setJobIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY) || null,
  )
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setJobId = useCallback((id: string | null) => {
    setJobIdState(id)
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  }, [])

  const loadResult = useCallback(async (id: string) => {
    setError(null)
    try {
      const r = await api.result(id)
      setResult(r)
      setJobId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }, [setJobId])

  // restore the last analysis on first load
  useEffect(() => {
    if (jobId && !result) {
      api.result(jobId).then(setResult).catch(() => {
        localStorage.removeItem(STORAGE_KEY)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runFile = useCallback<AnalysisState['runFile']>(
    async (file, options = {}, onProgress) => {
      setLoading(true)
      setError(null)
      setResult(null)
      try {
        const { job_id } = await api.analyseFile(file, options, onProgress)
        setJobId(job_id)
        await new Promise<void>((resolve, reject) => {
          const poll = async () => {
            try {
              const j = await api.job(job_id)
              setJob(j)
              if (j.status === 'done') { resolve(); return }
              if (j.status === 'error') { reject(new Error(j.message || 'Analysis failed')); return }
              if (j.status === 'cancelled') { reject(new Error('Cancelled')); return }
              setTimeout(poll, 700)
            } catch (e) { reject(e) }
          }
          poll()
        })
        const r = await api.result(job_id)
        setResult(r)
        return job_id
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      } finally {
        setLoading(false)
      }
    },
    [setJobId],
  )

  const runUrl = useCallback<AnalysisState['runUrl']>(
    async (url, options = {}) => {
      setLoading(true)
      setError(null)
      setResult(null)
      try {
        const { job_id } = await api.analyseUrl(url, options)
        setJobId(job_id)
        await new Promise<void>((resolve, reject) => {
          const poll = async () => {
            try {
              const j = await api.job(job_id)
              setJob(j)
              if (j.status === 'done') { resolve(); return }
              if (j.status === 'error') { reject(new Error(j.message || 'Analysis failed')); return }
              if (j.status === 'cancelled') { reject(new Error('Cancelled')); return }
              setTimeout(poll, 700)
            } catch (e) { reject(e) }
          }
          poll()
        })
        const r = await api.result(job_id)
        setResult(r)
        return job_id
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      } finally {
        setLoading(false)
      }
    },
    [setJobId],
  )

  const clear = useCallback(() => {
    setJobId(null); setResult(null); setJob(null); setError(null)
  }, [setJobId])

  const value = useMemo(() => ({
    jobId, setJobId, result, setResult, job, setJob, loading, error, setError,
    runFile, runUrl, loadResult, clear,
  }), [jobId, setJobId, result, job, loading, error, runFile, runUrl, loadResult, clear])

  useEffect(() => {
    globalObj.__GUITAR_AI_STATE__ = value
  }, [value])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAnalysis() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    if (globalObj.__GUITAR_AI_STATE__) {
      return globalObj.__GUITAR_AI_STATE__
    }
    return fallbackState
  }
  return ctx
}
