import { useState } from 'react'
import { ScheduleWatcher } from './state/ScheduleWatcher.tsx'
import { TvProvider } from './state/TvProvider.tsx'
import { useTv } from './state/tv-context.ts'
import { TvScreen } from './app/TvScreen.tsx'
import { SleepScreen } from './components/SleepScreen.tsx'
import { StartupScreen } from './components/StartupScreen.tsx'

function Television() {
  const { startupPhase, startupProgress, startupSettled, asleep, wake } = useTv()
  const [curtain, setCurtain] = useState(true)
  const ready = startupPhase === 'ready'
  // One startup screen from the first frame until it fades off over the first picture: the set mounts beneath
  // it once the network is ready, so the logo and its ring are never replaced part-way.
  const phase = !ready ? startupPhase : startupSettled ? 'ready' : 'loading'
  if (asleep) return <SleepScreen onWake={wake} />
  return (
    <>
      {ready ? (
        <>
          <ScheduleWatcher />
          <TvScreen />
        </>
      ) : null}
      {curtain ? (
        <StartupScreen phase={phase} progress={ready ? 100 : startupProgress} onLeft={() => setCurtain(false)} />
      ) : null}
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
