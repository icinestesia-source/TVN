import { useEffect, useState } from 'react'
import type { MediaItem } from '../director/types.ts'
import { mediaLibrary } from '../director/library.ts'
import type { Programme } from '../types/programme.ts'
import { loadedRegister, loadRegister } from './load.ts'
import { EMPTY_REGISTER, libraryItem, sourceIdOf, type SourceRegister } from './provenance.ts'
import { publicWebPage } from '../utils/web-page.ts'

/** Who made what is on screen, as a record names them: their @handle when one is known, else their name. */
export interface Attribution {
  text: string
  /** The creator's own YouTube channel page, or a feed episode's own page; absent when no record names it. */
  url?: string
}

const HANDLE = /^[\w.-]{3,30}$/

/** A YouTube channel address, made https, or nothing when it is not one. */
export function youtubeChannelPage(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.hostname !== 'www.youtube.com' && url.hostname !== 'youtube.com') return undefined
    if (url.pathname.length < 2 || url.search || url.hash) return undefined
    return `https://www.youtube.com${url.pathname}`
  } catch {
    return undefined
  }
}

/** The handle a channel address itself carries (`/@handle`); never taken from a name. */
export function handleOfChannelPage(raw: string | undefined): string | undefined {
  const page = youtubeChannelPage(raw)
  const handle = page?.match(/^https:\/\/www\.youtube\.com\/@([^/]+)$/)?.[1]
  return handle && HANDLE.test(handle) ? handle : undefined
}

/**
 * The creator of a YouTube programme: carried on the programme by the User Network's own scans, or, for TVN's
 * catalogue, from the shipped source register. Nothing is looked up and nothing is shown when no record has it.
 */
export function programmeAttribution(
  programme: Programme,
  register: SourceRegister,
  library: readonly MediaItem[] = mediaLibrary(),
): Attribution | null {
  if (programme.mediaUrl && !programme.liveStream) return episodeAttribution(programme.episodeUrl)
  if (!programme.videoId || programme.liveStream || programme.mediaUrl) return null
  const name = programme.creator?.trim()
  if (name) {
    const handle = programme.creatorHandle && HANDLE.test(programme.creatorHandle) ? programme.creatorHandle : undefined
    const url = youtubeChannelPage(programme.creatorUrl)
    return { text: handle ? `@${handle}` : name, ...(url ? { url } : {}) }
  }
  const entry = register.sources[sourceIdOf(libraryItem(library, programme.videoId)) ?? '']
  if (!entry?.name?.trim()) return null
  const url = youtubeChannelPage(entry.channelUrl)
  const handle = handleOfChannelPage(entry.channelUrl)
  return { text: handle ? `@${handle}` : entry.name.trim(), ...(url ? { url } : {}) }
}

/** A feed episode links to its own page, or to the site that publishes it, named by its address. */
export function episodeAttribution(raw: string | undefined): Attribution | null {
  const page = publicWebPage(raw)
  if (!page) return null
  const url = new URL(page)
  const site = url.hostname.replace(/^www\./, '')
  return { text: url.pathname === '/' && !url.search ? site : 'LINK', url: page }
}

/** The source register once it has loaded (it is read once per visit); empty until then. */
export function useSourceRegister(): SourceRegister {
  const [register, setRegister] = useState<SourceRegister>(() => loadedRegister() ?? EMPTY_REGISTER)
  useEffect(() => {
    if (loadedRegister()) return
    let live = true
    void loadRegister().then((value) => {
      if (live) setRegister(value)
    })
    return () => {
      live = false
    }
  }, [])
  return register
}
