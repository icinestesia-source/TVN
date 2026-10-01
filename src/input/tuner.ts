/** How many digits the on-screen tuner will accept. */
export const TUNER_MAX_DIGITS = 6

/**
 * Commit immediately only when the buffer cannot grow into another real channel.
 * Otherwise wait for another digit, Enter, or the entry timeout.
 * "009" tunes 9. "1001" tunes 1001. "9" waits, because 900 still exists.
 */
export function tunerStep(buffer: string, channelNumbers: readonly number[]): 'commit' | 'wait' {
  if (!buffer || !/^[0-9]+$/.test(buffer)) return 'wait'
  if (buffer.length >= TUNER_MAX_DIGITS) return 'commit'
  // 000 and 1000 are reserved. They must be typeable, then resolve as no channel.
  if (buffer === '000' || buffer === '1000') return 'commit'
  if ('1000'.startsWith(buffer) && buffer.length < 4) return 'wait'
  const value = Number(buffer)
  const longer = channelNumbers.some((number) => {
    const plain = String(number)
    const padded = number < 1000 ? plain.padStart(3, '0') : plain
    return (
      (plain.startsWith(buffer) && plain.length > buffer.length) ||
      (padded.startsWith(buffer) && padded.length > buffer.length)
    )
  })
  if (longer) return 'wait'
  if (channelNumbers.includes(value)) return 'commit'
  return 'wait'
}

/**
 * Digits as typed, with a dash while another digit can still arrive.
 * "3" waits as "3—". A finished "317" or "1004" has no dash.
 */
export function entryFace(digits: string, channelNumbers: readonly number[]): string {
  if (!digits) return ''
  return tunerStep(digits, channelNumbers) === 'wait' ? `${digits}—` : digits
}

/** Three-digit display for the default network. Longer numbers stay as typed. */
export function formatEntry(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 3) return digits.padStart(3, '0')
  return digits
}

export function formatChannelNumber(number: number): string {
  const value = Math.max(0, Math.floor(number))
  if (value >= 1000) return String(value)
  return String(value).padStart(3, '0')
}
