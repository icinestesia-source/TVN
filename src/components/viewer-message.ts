/** A failure as the viewer sees it: TVN's own short message, or the fallback for anything long or technical. */
export function viewerMessage(caught: unknown, fallback: string): string {
  const text = caught instanceof Error ? caught.message.trim() : ''
  return text && text.length <= 90 && !/[<>{}]/.test(text) ? text.toUpperCase() : fallback
}
