/** A public web page's address, made canonical: http or https, no credentials. Anything else is nothing. */
export function publicWebPage(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** The site a feed is published from: its address's home page. */
export function siteOf(feedUrl: string | undefined): string | undefined {
  const page = publicWebPage(feedUrl)
  return page ? `${new URL(page).origin}/` : undefined
}
