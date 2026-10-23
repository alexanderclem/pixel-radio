/** Single source for the help overlay; `useShortcuts` implements the bindings. */
export const SHORTCUTS: { group: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    group: 'Tuning',
    keys: [
      { keys: ['N', 'B'], label: 'Next / previous station' },
      { keys: ['1', '…', '0'], label: 'City presets 1–10' },
      { keys: ['/'], label: 'Search stations' },
      { keys: ['R'], label: 'Surprise me: a random station' },
      { keys: ['S'], label: 'Favorite the playing station' },
      { keys: ['M'], label: 'Mute / unmute' },
    ],
  },
  {
    group: 'Map',
    keys: [
      { keys: ['L'], label: 'Go to the playing station' },
      { keys: ['H'], label: 'World view' },
      { keys: ['V'], label: 'Everyone / friends only on the map' },
      { keys: ['W'], label: 'Music only (hide talk stations)' },
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
      { keys: ['E'], label: 'Discover: vibes, trending, more like this' },
      { keys: ['Y'], label: 'Atmospheres' },
      { keys: ['D'], label: 'Saved setups, stars & recents' },
      { keys: ['G'], label: 'Friends' },
      { keys: ['A'], label: 'Your avatar' },
      { keys: ['P'], label: 'Passport: stamps, streaks, unlocks' },
      { keys: ['U'], label: 'Account' },
      { keys: ['?'], label: 'This help' },
      { keys: ['Esc'], label: 'Close / leave focus mode' },
    ],
  },
]
