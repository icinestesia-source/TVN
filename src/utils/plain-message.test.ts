import { describe, expect, it } from 'vitest'
import { plainMessage } from './plain-message.ts'

describe('viewer-facing error text', () => {
  it('passes RetroTV wording through and hides technical browser errors', () => {
    expect(plainMessage(new Error('The file is not valid JSON'))).toBe('The file is not valid JSON')
    expect(plainMessage(new SyntaxError('Unexpected token < in JSON at position 0'))).toBeNull()
    expect(plainMessage(new TypeError("Cannot read properties of undefined (reading 'channels')"))).toBeNull()
    expect(plainMessage(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toBeNull()
    expect(plainMessage(new Error(''))).toBeNull()
    expect(plainMessage('undefined')).toBeNull()
    expect(plainMessage(undefined)).toBeNull()
  })
})
