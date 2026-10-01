import type { SourceInfo } from '../services/channel-sources.ts'
import { webUrl } from './provenance.ts'

export const MAX_SOURCE_LINKS = 6

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/
const PHONE = /^\+?[\d\s().-]{6,24}$/

/** What the editor's fields hold while the viewer types; nothing is validated until Save. */
export interface SourceInfoDraft {
  website: string
  links: string
  contactPage: string
  email: string
  phone: string
}

export function draftOf(info: SourceInfo | undefined): SourceInfoDraft {
  return {
    website: info?.website ?? '',
    links: (info?.links ?? []).join('\n'),
    contactPage: info?.contactPage ?? '',
    email: info?.email ?? '',
    phone: info?.phone ?? '',
  }
}

/**
 * The viewer's typed public information, checked: every link must be a web address, the email an address
 * and the phone a number. Empty fields are dropped, so a source with none keeps no `info` at all.
 */
export function cleanSourceInfo(draft: SourceInfoDraft): { info?: SourceInfo; problem?: string } {
  const info: SourceInfo = {}
  const website = draft.website.trim()
  if (website) {
    const url = webUrl(website)
    if (!url) return { problem: 'WEBSITE MUST BE A WEB ADDRESS (https://…)' }
    info.website = url
  }
  const lines = draft.links.split(/\s*\n\s*/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > MAX_SOURCE_LINKS) return { problem: `UP TO ${MAX_SOURCE_LINKS} SOCIAL LINKS` }
  const links: string[] = []
  for (const line of lines) {
    const url = webUrl(line)
    if (!url) return { problem: 'EACH SOCIAL LINK MUST BE A WEB ADDRESS (https://…)' }
    links.push(url)
  }
  if (links.length) info.links = links
  const contact = draft.contactPage.trim()
  if (contact) {
    const url = webUrl(contact)
    if (!url) return { problem: 'CONTACT PAGE MUST BE A WEB ADDRESS (https://…)' }
    info.contactPage = url
  }
  const email = draft.email.trim()
  if (email) {
    if (!EMAIL.test(email)) return { problem: 'THAT IS NOT AN EMAIL ADDRESS' }
    info.email = email
  }
  const phone = draft.phone.trim()
  if (phone) {
    if (!PHONE.test(phone)) return { problem: 'THAT IS NOT A PHONE NUMBER' }
    info.phone = phone
  }
  return Object.keys(info).length ? { info } : {}
}

/** The link name a viewer sees: the site, never a guess at who runs it. */
export function linkLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, '') : ''}`
  } catch {
    return url
  }
}
