import { programmeSuitsChannel } from './fit.ts'
import { policyFor } from './policies.ts'
import type { Eligibility, MediaItem } from './types.ts'

function subjectNames(item: MediaItem): string[] {
  return [...(item.subjects ?? []), ...(item.sport ? [item.sport] : [])]
}

function matches(item: MediaItem, rule: Eligibility | undefined): boolean {
  if (!rule) return true
  if (rule.routedOnly) return false
  if (rule.excludeTypes?.includes(item.programmeType)) return false
  if (rule.excludeTopics?.some((topic) => item.topics?.includes(topic))) return false
  if (rule.excludeSubjects?.some((subject) => subjectNames(item).includes(subject))) return false
  const typeOk = !rule.includeTypes?.length || rule.includeTypes.includes(item.programmeType)
  const topicOk = !rule.includeTopics?.length || rule.includeTopics.some((topic) => item.topics?.includes(topic))
  if (rule.includeTypes?.length && rule.includeTopics?.length) return typeOk && topicOk
  if (rule.includeSubjects?.length) {
    const subjectOk = rule.includeSubjects.some((subject) => subjectNames(item).includes(subject) || item.topics?.includes(subject))
    if (!subjectOk) return false
  }
  if (rule.includeTopics?.length) return topicOk
  if (rule.includeTypes?.length) return typeOk
  return true
}

export interface EligibilityExplanation {
  eligible: boolean
  reasons: string[]
}

function playbackIncompatible(item: MediaItem, channelNumber: number): boolean {
  const policy = policyFor(channelNumber)
  if (!policy) return false
  if (policy.scheduleStyle === 'radio') return item.mediaKind === 'video'
  return item.mediaKind === 'audio'
}

/** An item drawn from a channel's routed pool is already routed; only exclusions and playback remain. */
export function routedPoolAccepts(item: MediaItem, channelNumber: number, rule: Eligibility): boolean {
  if (item.explicitChannelExcludes?.includes(channelNumber)) return false
  if (rule.explicitExclude?.includes(item.id)) return false
  return !playbackIncompatible(item, channelNumber) && programmeSuitsChannel(item, channelNumber)
}

function describeMatch(item: MediaItem, rule: Eligibility | undefined, label: string): string[] {
  if (!rule) return []
  if (rule.routedOnly) return [`${label} airs only programmes routed to this channel`]
  const reasons: string[] = []
  if (rule.excludeTypes?.includes(item.programmeType)) {
    reasons.push(`programmeType ${item.programmeType} excluded by ${label}`)
    return reasons
  }
  const blockedSubject = rule.excludeSubjects?.find((subject) => subjectNames(item).includes(subject))
  if (blockedSubject) {
    if (rule.includeTypes?.includes(item.programmeType)) {
      reasons.push(`programmeType ${item.programmeType} allowed by ${label}`)
    }
    reasons.push(`subject ${blockedSubject} does not satisfy ${label}`)
    return reasons
  }
  const blockedTopic = rule.excludeTopics?.find((topic) => item.topics?.includes(topic))
  if (blockedTopic) {
    reasons.push(`topic ${blockedTopic} excluded by ${label}`)
    return reasons
  }
  const typeListed = !rule.includeTypes?.length || rule.includeTypes.includes(item.programmeType)
  const topicHit = rule.includeTopics?.find((topic) => item.topics?.includes(topic))
  const topicListed = !rule.includeTopics?.length || Boolean(topicHit)
  if (rule.includeTypes?.length && !typeListed) {
    reasons.push(`programmeType ${item.programmeType} is not included by ${label}`)
  } else if (rule.includeTypes?.length && typeListed) {
    reasons.push(`programmeType ${item.programmeType} allowed by ${label}`)
  }
  if (rule.includeTopics?.length && !topicListed) {
    reasons.push(`required ${label} topic not satisfied`)
  } else if (topicHit) {
    reasons.push(`topic ${topicHit} matched ${label} include`)
  }
  const subjectHit = rule.includeSubjects?.find((subject) => subjectNames(item).includes(subject) || item.topics?.includes(subject))
  if (rule.includeSubjects?.length && !subjectHit) reasons.push(`required ${label} subject not satisfied`)
  else if (subjectHit) reasons.push(`subject ${subjectHit} matched ${label} include`)
  return reasons
}

function matched(item: MediaItem, rule: Eligibility | undefined): boolean {
  return matches(item, rule)
}

/**
 * Explicit exclusion wins. An explicit channel include forces eligibility
 * unless the item cannot play on that channel. It does not remove the item
 * from other channels it already matches.
 */
export function decideEligibility(
  item: MediaItem,
  channelNumber: number,
  channelRule: Eligibility,
  blockRule?: Eligibility,
): EligibilityExplanation {
  if (item.explicitChannelExcludes?.includes(channelNumber)) {
    return { eligible: false, reasons: ['explicitChannelExclude rejects this channel'] }
  }
  if (channelRule.explicitExclude?.includes(item.id) || blockRule?.explicitExclude?.includes(item.id)) {
    return { eligible: false, reasons: ['explicitExclude rejects this item'] }
  }
  if (playbackIncompatible(item, channelNumber)) {
    return { eligible: false, reasons: ['playback constraint: media kind does not match this channel'] }
  }
  const suits = programmeSuitsChannel(item, channelNumber)
  if (item.explicitChannelIncludes?.includes(channelNumber) && suits) {
    return { eligible: true, reasons: ['explicitChannelInclude forces eligibility', 'explicitExclude absent'] }
  }
  const sibling = channelRule.routedFrom?.find((number) => item.explicitChannelIncludes?.includes(number))
  if (sibling !== undefined && suits && !blockRule?.explicitExclude?.includes(item.id)) {
    return { eligible: true, reasons: [`routed to sibling channel ${sibling} of this aggregate`, 'explicitExclude absent'] }
  }
  if (!suits && (item.explicitChannelIncludes?.includes(channelNumber) || sibling !== undefined) && channelRule.routedOnly) {
    return { eligible: false, reasons: ['routed here, but the programme does not suit this channel'] }
  }
  if (item.id.startsWith('yt:') && !channelRule.includeTopics?.length && !channelRule.includeSubjects?.length) {
    return {
      eligible: false,
      reasons: ['user media needs a topic or subject match on this channel'],
    }
  }
  if (channelRule.explicitInclude?.includes(item.id) || blockRule?.explicitInclude?.includes(item.id)) {
    return { eligible: true, reasons: ['policy explicitInclude forces eligibility', 'explicitExclude absent'] }
  }
  const reasons = [
    ...describeMatch(item, channelRule, 'policy'),
    ...describeMatch(item, blockRule, 'block'),
  ]
  const eligible = matched(item, channelRule) && matched(item, blockRule)
  if (eligible) reasons.push('explicitExclude absent')
  if (!eligible && reasons.length === 0) reasons.push('channel policy did not accept this item')
  return { eligible, reasons }
}

/** Explicit exclusion wins over inclusion, channel filters, and block filters. */
export function isEligible(
  item: MediaItem,
  channelNumber: number,
  channelRule: Eligibility,
  blockRule?: Eligibility,
): boolean {
  return decideEligibility(item, channelNumber, channelRule, blockRule).eligible
}

/** Why a stored item does or does not fit a channel that has a programming policy. */
export function explainEligibility(
  item: MediaItem,
  channelNumber: number,
  blockRule?: Eligibility,
): EligibilityExplanation {
  const policy = policyFor(channelNumber)
  if (!policy) {
    return { eligible: false, reasons: [`Channel ${channelNumber} has no programming policy`] }
  }
  return decideEligibility(item, channelNumber, policy.eligibility, blockRule)
}
