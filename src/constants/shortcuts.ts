/** Single source for the help overlay; `useShortcuts` implements the bindings. */
export const SHORTCUTS: { group: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    group: 'Tuning',
    keys: [
      { keys: ['N', 'B'], label: 'Next / previous station' },
      { keys: ['1', '…', '0'], label: 'City presets 1–10' },
      { keys: ['/'], label: 'Search stations' },
      { keys: ['S'], label: 'Favorite the playing station' },
      { keys: ['M'], label: 'Mute / unmute' },
    ],
  },
  {
    group: 'Map',
    keys: [
      { keys: ['L'], label: 'Go to the playing station' },
      { keys: ['H'], label: 'World view' },
      { keys: ['←', '↑', '→', '↓'], label: 'Pan (map focused)' },
      { keys: ['+', '−'], label: 'Zoom (map focused)' },
    ],
  },
  {
    group: 'Focus',
    keys: [
      { keys: ['T'], label: 'Start / pause the timer' },
      { keys: ['F'], label: 'Focus mode' },
    ],
  },
  {
    group: 'Panels',
    keys: [
      { keys: ['C'], label: 'All controls / fewer controls' },
      { keys: ['D'], label: 'Favorites & recents' },
      { keys: ['G'], label: 'Friends' },
      { keys: ['?'], label: 'This help' },
      { keys: ['Esc'], label: 'Close / leave focus mode' },
    ],
  },
]
