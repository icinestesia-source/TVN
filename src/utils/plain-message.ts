/**
 * The message of an error RetroTV raised itself, for showing to the viewer. Browser, storage and
 * parser errors (DOMException, TypeError, SyntaxError…) carry technical text and return null so
 * the caller shows its own wording instead.
 */
export function plainMessage(caught: unknown): string | null {
  if (!(caught instanceof Error) || caught.name !== 'Error' || caught.constructor !== Error) return null
  const message = caught.message.trim()
  return message === '' ? null : message
}
