import { useState } from 'react'
import { ChevronDown, ChevronRight, ListChecks, Sparkles, Target, TriangleAlert } from 'lucide-react'
import type { AIResult } from '../types'
import { Badge } from './ui'

const SECTIONS: { key: keyof AIResult['content']; title: string }[] = [
  { key: 'chord_explanation', title: 'The chords' },
  { key: 'scale_explanation', title: 'The scale' },
  { key: 'solo_explanation', title: 'The solo' },
  { key: 'chord_scale_relationship', title: 'How they fit together' },
]

export default function AICoach({ ai }: { ai: AIResult | undefined }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ 'The chords': true })
  if (!ai) return null
  const c = ai.content
  const isGemini = ai.provider === 'gemini'

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 bg-gradient-to-r from-violet-500/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-violet-300" />
          <span className="text-[13px] font-semibold text-slate-100">Your guitar teacher</span>
          {isGemini
            ? <Badge tone="violet" title={ai.model}>Gemini · {ai.model}</Badge>
            : <Badge tone="slate" title={ai.fallback_reason ?? ''}>offline explanations</Badge>}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-[13.5px] font-medium leading-snug text-slate-100">{c.headline}</p>
        <p className="text-[12.5px] leading-relaxed text-slate-400">{c.overview}</p>

        {ai.fallback_reason && !isGemini && (
          <p className="rounded-md bg-ink-800/60 px-3 py-2 text-[11px] text-slate-500">
            {ai.fallback_reason}
          </p>
        )}

        <div className="space-y-1.5 pt-1">
          {SECTIONS.map(({ key, title }) => {
            const text = c[key]
            if (typeof text !== 'string' || !text) return null
            const isOpen = open[title]
            return (
              <div key={title} className="overflow-hidden rounded-lg border border-ink-700">
                <button onClick={() => setOpen((o) => ({ ...o, [title]: !o[title] }))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-slate-300 transition hover:bg-ink-800/60">
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {title}
                </button>
                {isOpen && (
                  <p className="animate-fade-up border-t border-ink-700 px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-400">
                    {text}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <div className="rounded-lg border border-ink-700 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              <ListChecks size={12} /> Practice plan
            </div>
            <ol className="space-y-1.5">
              {c.practice_plan?.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-400">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-500/15 text-[9px] font-bold text-amber-300">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-orange-300">
                <TriangleAlert size={12} /> Double-check these
              </div>
              <ul className="space-y-1.5">
                {c.things_to_double_check?.map((t, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-400">
                    <span className="text-orange-400">•</span><span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-ink-700 p-3">
              <Target size={13} className="mt-0.5 shrink-0 text-sky-300" />
              <p className="text-[12px] leading-relaxed text-slate-400">{c.confidence_comment}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
