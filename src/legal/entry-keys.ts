/** The keys TVN answers to, as src/input/keyboard.ts and src/input/space-hold.ts bind them; nothing here is a key of its own. */
export const ENTRY_KEYS: readonly { group: string; keys: readonly { key: string; label: string; name: string }[] }[] = [
  {
    group: 'Watch',
    keys: [
      { key: 'P', label: 'Pause', name: 'P' },
      { key: 'Space', label: 'Surf', name: 'Space' },
      { key: 'Hold Space', label: 'Surf scope', name: 'Hold Space' },
      { key: 'S', label: 'Favourite', name: 'S' },
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
      { key: 'Home', label: 'Now', name: 'Home' },
      { key: '-', label: 'Zoom out', name: 'Minus' },
      { key: '=', label: 'Zoom in', name: 'Equals' },
    ],
  },
  { group: 'Screen', keys: [{ key: 'F', label: 'Fullscreen', name: 'F' }] },
]
