import { useState } from 'react'
import { ScheduleWatcher } from './state/ScheduleWatcher.tsx'
import { TvProvider } from './state/TvProvider.tsx'
import { useTv } from './state/tv-context.ts'
import { TvScreen } from './app/TvScreen.tsx'
import { SleepScreen } from './components/SleepScreen.tsx'
import { StartupScreen } from './components/StartupScreen.tsx'

function Television() {
  const { startupPhase, startupProgress, asleep, wake } = useTv()
  const [curtain, setCurtain] = useState(true)
  if (startupPhase !== 'ready') return <StartupScreen phase={startupPhase} progress={startupProgress} />
  if (asleep) return <SleepScreen onWake={wake} />
  return (
    <>
      <ScheduleWatcher />
      <TvScreen />
      {curtain ? <StartupScreen phase="ready" progress={100} onLeft={() => setCurtain(false)} /> : null}
    </>
  )
}

export default function App() {
  return (
    <TvProvider>
      <Television />
    </TvProvider>
  )
}
