import { useNavigate } from 'react-router-dom'
import { Sliders, Upload } from 'lucide-react'
import PracticeSection from '../components/sections/PracticeSection'
import { EmptyState, SectionTitle } from '../components/ui'
import { useAnalysis } from '../context'
import { usePlayer } from '../hooks/usePlayer'

export default function Practice() {
  const { result, loading } = useAnalysis()
  const navigate = useNavigate()
  const player = usePlayer(result?.media?.url)

  if (loading && !result) {
    return (
      <div className="space-y-4">
        <SectionTitle
          title="Practice studio" icon={<Sliders size={15} />}
          subtitle="Loading audio and timeline…"
        />
        <div className="card shimmer h-48 rounded-xl" />
      </div>
    )
  }

  if (!result) {
    return (
      <EmptyState
        icon={<Sliders size={30} />}
        title="No track loaded"
        body="The practice studio needs a track: slow it down, loop the hard part, shift the key."
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
      <SectionTitle
        title="Practice studio" icon={<Sliders size={15} />}
        subtitle="0.25× to 2×, pitch-preserving slowdown, A–B loop, metronome, synced chords and tab"
      />
      <PracticeSection result={result} player={player} />
    </div>
  )
}
