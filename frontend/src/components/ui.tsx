import type { ReactNode } from 'react'
import {AlertTriangle, Info, Loader2, CheckCircle2 } from 'lucide-react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>
}

export function SectionTitle({
  title, subtitle, right, icon,
}: { title: string; subtitle?: string; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {icon && <span className="text-amber-400">{icon}</span>}
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function Stat({
  label, value, hint, accent,
}: { label: string; value: ReactNode; hint?: string; accent?: 'amber' | 'violet' | 'sky' | 'emerald' | 'slate' }) {
  const accentCls = accent === 'amber' ? 'text-amber-300'
    : accent === 'violet' ? 'text-violet-300'
    : accent === 'sky' ? 'text-sky-300'
    : accent === 'emerald' ? 'text-emerald-300' : 'text-slate-100'
  return (
    <div className="card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-xl font-semibold ${accentCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

export function Badge({
  children, tone = 'slate', title,
}: { children: ReactNode; tone?: 'slate' | 'amber' | 'emerald' | 'red' | 'violet' | 'sky'; title?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-ink-700/60 text-slate-300 ring-ink-600',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    red: 'bg-red-500/15 text-red-300 ring-red-500/30',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
    sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  }
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function ConfidenceBar({ value, className = '' }: { value: number; className?: string }) {
  const safeVal = Number.isFinite(value) ? value : 0
  const pct = Math.round(Math.max(0, Math.min(1, safeVal)) * 100)
  const color = pct > 70 ? 'bg-emerald-400' : pct > 45 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 font-mono text-[10px] text-slate-400">{pct}%</span>
    </div>
  )
}

export function Notice({
  kind = 'info', children, title,
}: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; title?: string }) {
  const map = {
    info: { cls: 'border-sky-500/30 bg-sky-500/5 text-sky-200', Icon: Info },
    success: { cls: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200', Icon: CheckCircle2 },
    warn: { cls: 'border-amber-500/30 bg-amber-500/5 text-amber-200', Icon: AlertTriangle },
    error: { cls: 'border-red-500/30 bg-red-500/5 text-red-200', Icon: AlertTriangle },
  }[kind]
  return (
    <div className={`flex gap-2.5 rounded-lg border p-3 text-[12.5px] leading-relaxed ${map.cls}`}>
      <map.Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-semibold">{title}</div>}
        <div className="space-y-1 text-slate-300">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({
  title, body, action, icon,
}: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-slate-600">{icon}</div>}
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {body && <div className="max-w-md text-xs leading-relaxed text-slate-500">{body}</div>}
      {action}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={16} />
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-ink-700 ${className}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-300"
           style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}
