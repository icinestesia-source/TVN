import { useState } from 'react'
import { userTestDiagnostic } from '../services/diagnostic.ts'
import { useTv } from '../state/tv-context.ts'
import { useClock } from '../utils/use-clock.ts'

/** A copyable report of what is on screen, for testers. Built locally; nothing is sent. */
export function DiagnosticPanel() {
  const now = useClock(1000)
  const tv = useTv()
  const [copied, setCopied] = useState<'idle' | 'copied' | 'select'>('idle')
  const text = userTestDiagnostic(tv.channel, now, {
    playerStatus: tv.playerStatus,
    playerDetail: tv.playerDetail,
    viewport: { width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio },
    userAgent: navigator.userAgent,
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('copied')
    } catch {
      setCopied('select')
    }
  }

  return (
    <aside className="diagnostic" role="dialog" aria-label="Diagnostic information">
      <p className="diagnostic-title">Diagnostic · press D or Esc to close</p>
      <pre className="diagnostic-text" tabIndex={0}>
        {text}
      </pre>
      <button type="button" onClick={() => void copy()}>
        {copied === 'copied' ? 'Copied' : 'Copy'}
      </button>
      {copied === 'select' ? <p className="diagnostic-note">Copying is blocked here; select the text above instead.</p> : null}
    </aside>
  )
}
