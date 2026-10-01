export type PlaybackCapability = 'seekable-recorded' | 'live' | 'audio' | 'generated'

export type SourceProvider = 'youtube' | 'external-embed' | 'audio-stream' | 'local' | 'generated'

export interface SourceDefinition {
  id: string
  provider: SourceProvider
  mediaKind: 'video' | 'audio'
  capability: PlaybackCapability
  /** Present only when a real supported id has been configured. Never invented. */
  externalId?: string
  url?: string
  label: string
  priority: number
  enabled: boolean
}

export interface ChannelOverride {
  channelNumber: number
  displayName?: string
  disabledSourceIds?: string[]
  additionalSources?: SourceDefinition[]
  /**
   * Canonical channel name this override was bound to.
   * Absent on records saved before the canonical lineup.
   */
  boundName?: string
}

export function mergeSources(
  defaults: readonly SourceDefinition[],
  override?: ChannelOverride | null,
): SourceDefinition[] {
  const disabled = new Set(override?.disabledSourceIds ?? [])
  const base = defaults
    .filter((source) => !disabled.has(source.id))
    .map((source) => ({ ...source }))
  const extra = (override?.additionalSources ?? []).map((source) => ({ ...source }))
  return [...extra, ...base].sort((left, right) => left.priority - right.priority)
}

export function generatedSource(channelNumber: number): SourceDefinition {
  return {
    id: `generated:${channelNumber}`,
    provider: 'generated',
    mediaKind: 'video',
    capability: 'generated',
    label: 'Off air',
    priority: 100,
    enabled: true,
  }
}
