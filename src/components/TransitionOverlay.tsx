import type { CSSProperties } from 'react'
import { channelByNumber } from '../data/catalogue.ts'
import { onScreen } from '../player/manual.ts'
import { TRANSITIONS, transitionTiming, type CardAccent, type TransitionColour, type TransitionSettings } from '../state/transitions.ts'
import { useClock } from '../utils/use-clock.ts'
import { padChannel } from '../utils/time.ts'
import { Noise } from './StaticOverlay.tsx'

/** What the title card names: always the channel being tuned to, never one passed through on the way. */
export interface CardIdentity {
  number: string
  name: string
  programme: string | null
}

const TINTS: Record<TransitionColour, string | null> = {
  mono: null,
  warm: '#ffd2a1',
  cool: '#a8d4ff',
  green: '#8dffa8',
  amber: '#ffb54d',
  accent: 'var(--gold)',
}

const ACCENTS: Record<CardAccent, string> = {
  gold: 'var(--gold)',
  white: '#f4f4f4',
  green: '#8dffa8',
  amber: '#ffb54d',
  cool: '#a8d4ff',
}

const SIZES = { small: 0.75, medium: 1, large: 1.3 } as const

function channelIdentity(channelNumber: number, now: number): CardIdentity {
  const channel = channelByNumber(channelNumber)
  return {
    number: channel ? padChannel(channel.number) : '———',
    name: channel?.name ?? 'NO CHANNEL',
    programme: channel ? onScreen(channel, now).current.programme.title : null,
  }
}

function TitleCard({ settings, identity, immediate }: { settings: TransitionSettings; identity: CardIdentity; immediate: boolean }) {
  const { card } = settings
  return (
    <div className={`fx-card at-${card.position} panel-${card.panel} type-${card.type}${immediate ? ' is-immediate' : ''}`}>
      <div className="fx-card-face static-ident">
        {card.number ? <p className="static-number">{identity.number}</p> : null}
        {card.name ? <p className="static-name">{identity.name}</p> : null}
        {card.programme && identity.programme ? <p className="static-title">{identity.programme}</p> : null}
      </div>
    </div>
  )
}

/**
 * One channel change on screen: the transition's effect and, from its IDENTIFY phase, the title card. The same
 * element stays mounted from the press until the picture takes over, so a tune made during it changes only the
 * card's identity. `revealing` is the effect giving way to the playing picture, without the card.
 */
export function TransitionOverlay({
  settings,
  identity,
  revealing = false,
  contained = false,
}: {
  settings: TransitionSettings
  identity: CardIdentity
  revealing?: boolean
  contained?: boolean
}) {
  const definition = TRANSITIONS[settings.id]
  const timing = transitionTiming(settings)
  const tint = definition.colour ? TINTS[settings.colour] : null
  const grain = definition.grain ? settings.grain : 'normal'
  const style = {
    '--fx-ms': `${Math.max(1, timing.durationMs)}ms`,
    '--card-delay': `${timing.cardAtMs ?? 0}ms`,
    '--reveal-ms': `${timing.revealMs}ms`,
    '--card-opacity': settings.card.opacity,
    '--card-zoom': SIZES[settings.card.size] * (contained ? 0.34 : 1),
    '--card-accent': ACCENTS[settings.card.accent],
    ...(tint ? { '--fx-tint': tint } : {}),
  } as CSSProperties
  const className = ['fx', `fx-${definition.effect}`, contained ? 'is-contained' : '', revealing ? 'is-revealing' : ''].filter(Boolean).join(' ')

  return (
    <div className={className} style={style} role="status" aria-live="polite" data-transition={settings.id}>
      {definition.effect === 'tune' ? <Noise grain={grain} /> : null}
      {definition.effect === 'analogue' ? (
        <>
          <Noise grain={grain} heavy />
          <div className="fx-scan" />
          <div className="fx-roll" />
        </>
      ) : null}
      {definition.effect === 'crt' ? <div className="fx-beam" /> : null}
      {definition.effect === 'glitch' ? (
        <>
          <Noise grain={grain} />
          <div className="fx-tears">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      ) : null}
      {definition.effect === 'flash' ? <div className="fx-flash-light" /> : null}
      {tint ? <div className="fx-tint" /> : null}
      {timing.cardAtMs !== null && !revealing ? <TitleCard settings={settings} identity={identity} immediate={timing.cardAtMs === 0} /> : null}
    </div>
  )
}

/** The television's transition for a channel number, its card following that channel's schedule. */
export function ChannelTransition({ settings, channelNumber, revealing }: { settings: TransitionSettings; channelNumber: number; revealing: boolean }) {
  const now = useClock(500)
  return <TransitionOverlay settings={settings} identity={channelIdentity(channelNumber, now)} revealing={revealing} />
}
