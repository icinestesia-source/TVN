/** The keys TVN answers to, as src/input/keyboard.ts and src/input/space-hold.ts bind them; nothing here is a key of its own. */
export const ENTRY_KEYS: readonly { group: string; keys: readonly { key: string; label: string; name: string }[] }[] = [
  {
    group: 'Watch',
    keys: [
      { key: 'P', label: 'Pause', name: 'P' },
      { key: 'Space', label: 'Surf', name: 'Space' },
      { key: 'Hold Space', label: 'Surf scope', name: 'Hold Space' },
      { key: 'A', label: 'Favourite', name: 'A' },
      { key: 'S', label: 'Subtitles', name: 'S' },
      { key: 'V', label: 'Info', name: 'V' },
    ],
  },
  {
    group: 'Channels',
    keys: [
      { key: ',', label: 'Prev', name: 'Comma' },
      { key: '.', label: 'Next', name: 'Full stop' },
      { key: '/', label: 'Multi', name: 'Slash' },
    ],
  },
  {
    group: 'Guide',
    keys: [
      { key: 'G', label: 'Guide', name: 'G' },
      { key: 'C', label: 'All / User / Fav', name: 'C' },
      { key: 'R', label: 'Refresh', name: 'R' },
      { key: 'Home', label: 'Now', name: 'Home' },
      { key: '-', label: 'Zoom out', name: 'Minus' },
      { key: '=', label: 'Zoom in', name: 'Equals' },
    ],
  },
  { group: 'Screen', keys: [{ key: 'F', label: 'Fullscreen', name: 'F' }] },
]

/**
 * One key on the entry screen's keyboard. `key` is the KeyboardEvent key TVN binds (absent for a key it
 * leaves alone, drawn dimmed); `cap` is what the key is printed with; `size` is its width in key units.
 */
export interface KeyboardKey {
  cap: string
  key?: string
  label?: string
  name?: string
  size?: number
}

const letter = (cap: string, label?: string, name = cap): KeyboardKey => (label ? { cap, key: cap.toLowerCase(), label, name } : { cap })

/** A whole keyboard, row by row, with what each key does (− and = zoom the Guide, and set the volume over the picture). */
export const KEYBOARD_ROWS: readonly (readonly KeyboardKey[])[] = [
  [
    { cap: 'Esc', key: 'Escape', label: 'Back', name: 'Escape', size: 1.25 },
    ...'1234567890'.split('').map((digit): KeyboardKey => ({ cap: digit, key: digit, name: digit })),
    { cap: '-', key: '-', label: 'Zoom out', name: 'Minus' },
    { cap: '=', key: '=', label: 'Zoom in', name: 'Equals' },
    { cap: '⌫', key: 'Backspace', label: 'Last', name: 'Backspace', size: 1.5 },
  ],
  [
    { cap: 'Tab', size: 1.5 },
    letter('Q'),
    letter('W'),
    letter('E', 'Edit'),
    letter('R', 'Refresh'),
    letter('T', 'Cycle'),
    letter('Y', 'User'),
    letter('U', 'Add'),
    letter('I', 'Media'),
    letter('O', 'Export ALL'),
    letter('P', 'Pause'),
    { cap: '[' },
    { cap: ']' },
  ],
  [
    { cap: 'Caps', size: 1.75 },
    letter('A', 'Fav'),
    letter('S', 'Subs'),
    letter('D'),
    letter('F', 'Full screen'),
    letter('G', 'Guide'),
    letter('H', 'Help'),
    letter('J'),
    letter('K'),
    letter('L', 'Latest'),
    { cap: ';' },
    { cap: 'Enter', key: 'Enter', label: 'OK', name: 'Enter', size: 1.75 },
  ],
  [
    { cap: 'Shift', size: 2.25 },
    letter('Z', 'A to Z'),
    letter('X', 'Reload'),
    letter('C', 'All / User / Fav'),
    letter('V', 'Info'),
    letter('B', 'Prev prog'),
    letter('N', 'Next prog'),
    letter('M', 'Mute'),
    { cap: ',', key: ',', label: 'Prev', name: 'Comma' },
    { cap: '.', key: '.', label: 'Next', name: 'Full stop' },
    { cap: '/', key: '/', label: 'Multi', name: 'Slash' },
    { cap: 'Shift', size: 2.25 },
  ],
  [{ cap: 'Space', key: ' ', label: 'Surf · hold: scope', name: 'Space', size: 7 }],
]

/** Beside the keyboard: Home and the page and arrow keys. */
export const KEYBOARD_NAV: readonly KeyboardKey[] = [
  { cap: 'Home', key: 'Home', label: 'Now', name: 'Home' },
  { cap: 'PgUp', key: 'PageUp', label: 'Ch +', name: 'Page Up' },
  { cap: 'PgDn', key: 'PageDown', label: 'Ch −', name: 'Page Down' },
  { cap: '↑', key: 'ArrowUp', label: 'Ch +', name: 'Up' },
  { cap: '←', key: 'ArrowLeft', label: 'Vol −', name: 'Left' },
  { cap: '↓', key: 'ArrowDown', label: 'Ch −', name: 'Down' },
  { cap: '→', key: 'ArrowRight', label: 'Vol +', name: 'Right' },
]
