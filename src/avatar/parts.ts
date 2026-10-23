/**
 * Pixel avatars: a 7×13 sprite layered from five swappable parts. Part rows use
 * single-letter colour tokens; "s" is always the head's skin and "." is transparent.
 */

export const AVATAR_W = 7
export const AVATAR_H = 13

/** A milestone that earns a part: focus hours, hours with friends, a streak, places heard, trips taken. */
export interface Unlock {
  kind: 'focusHours' | 'togetherHours' | 'streak' | 'countries' | 'stations' | 'boatTrips' | 'flights' | 'balloonRides'
  n: number
}

export interface Part {
  name: string
  /** Rows of the 13-row grid this layer starts at */
  y: number
  rows: string[]
  colors: Record<string, string>
  /** Locked until this milestone; parts without one are always available */
  unlock?: Unlock
}

export interface HeadPart extends Part {
  skin: string
}

export interface Avatar {
  head: number
  hat: number
  shirt: number
  pants: number
  shoes: number
}

export type AvatarSlot = keyof Avatar
export const AVATAR_SLOTS: AvatarSlot[] = ['head', 'hat', 'shirt', 'pants', 'shoes']

/** Rows 3–6: forehead, eyes, cheeks, chin. */
const FACE = ['.sssss.', '.seses.', '.sssss.', '..sss..']

const SKIN = { light: '#f6d2b0', tan: '#e0a878', brown: '#a8673f', deep: '#6b4028', olive: '#c99a6b' }
const EYE = '#20131c'

/** Head = skin + face + hair, drawn from row 0 so tall hairstyles fit. */
const head = (name: string, skin: string, hair: string, hairRows: string[]): HeadPart => ({
  name,
  skin,
  y: 0,
  // Face sits on rows 3–6; hair rows (starting at row 0) are laid over it
  rows: mergeRows(['.......', '.......', '.......', ...FACE], hairRows),
  colors: { e: EYE, h: hair },
})

/** Overlay `top` onto `base`; "." in `top` lets the base show through. */
function mergeRows(base: string[], top: string[]): string[] {
  const out = [...base]
  top.forEach((row, y) => {
    const under = out[y] ?? '.......'
    out[y] = [...under].map((ch, x) => (row[x] && row[x] !== '.' ? row[x] : ch)).join('')
  })
  return out
}

export const HEADS: HeadPart[] = [
  head('Short hair', SKIN.light, '#5a3a22', ['.......', '.......', '..hhh..', '.hhhhh.']),
  head('Long hair', SKIN.tan, '#2b1d14', ['.......', '.......', '..hhh..', '.hhhhh.', 'hh...hh', 'hh...hh', 'h.....h']),
  head('Curls', SKIN.deep, '#140c08', ['.......', '.......', '.hhhhh.', 'hhhhhhh', 'h.....h']),
  head('Buzz cut', SKIN.brown, '#2a1a10', ['.......', '.......', '.......', '.hhhhh.']),
  head('Top bun', SKIN.olive, '#3b2316', ['.......', '...h...', '..hhh..', '.hhhhh.']),
  head('Mohawk', SKIN.light, '#e0457b', ['...h...', '...h...', '...h...', '.shhhs.']),
  head('Blonde bob', SKIN.light, '#f2cf5b', ['.......', '.......', '.hhhhh.', 'hhhhhhh', 'h.....h', 'h.....h']),
  head('Silver', SKIN.tan, '#d9dde3', ['.......', '.......', '..hhh..', 'hhhhhhh', 'h.....h']),
]

export const HATS: Part[] = [
  { name: 'No hat', y: 0, rows: [], colors: {} },
  { name: 'Cap', y: 2, rows: ['..aaa..', '.aaaaaa'], colors: { a: '#e8473c' } },
  { name: 'Beanie', y: 0, rows: ['.......', '...b...', '..aaa..', '.aaaaa.'], colors: { a: '#3d7be0', b: '#ffffff' } },
  { name: 'Headphones', y: 2, rows: ['.aaaaa.', 'a.....a', 'b.....b', 'b.....b'], colors: { a: '#2b2b33', b: '#ff4d6d' } },
  { name: 'Top hat', y: 0, rows: ['..aaa..', '..aaa..', '..bbb..', 'aaaaaaa'], colors: { a: '#1d1b22', b: '#b9324a' } },
  { name: 'Crown', y: 1, rows: ['.a.a.a.', '.aaaaa.'], colors: { a: '#ffd23f' } },
  { name: 'Cowboy', y: 1, rows: ['..aaa..', '..aaa..', 'aaaaaaa'], colors: { a: '#9a6332' } },
  { name: 'Flower', y: 2, rows: ['....bab', '.....b.'], colors: { a: '#ffe066', b: '#ff7eb6' } },
  // Earned
  { name: 'Beret', y: 1, rows: ['....a..', '.aaaaa.', 'aaaaaa.'], colors: { a: '#2b2b33' }, unlock: { kind: 'countries', n: 5 } },
  { name: 'Party hat', y: 0, rows: ['...b...', '...a...', '..aaa..', '.ababa.'], colors: { a: '#ff7eb6', b: '#7df9ff' }, unlock: { kind: 'streak', n: 3 } },
  { name: 'Halo', y: 0, rows: ['.aaaaa.'], colors: { a: '#ffe680' }, unlock: { kind: 'togetherHours', n: 2 } },
  { name: 'Wizard hat', y: 0, rows: ['...a...', '..aab..', '.aaaaa.', 'aaaaaaa'], colors: { a: '#4b3bb3', b: '#ffd23f' }, unlock: { kind: 'focusHours', n: 10 } },
  { name: 'Captain', y: 1, rows: ['.aaaaa.', '.bbbbb.', '.cccccc'], colors: { a: '#f4f4f7', b: '#1d2a4a', c: '#1d1b22' }, unlock: { kind: 'boatTrips', n: 3 } },
  { name: 'Aviator', y: 2, rows: ['.aaaaa.', 'abbabba', 'a.....a'], colors: { a: '#7a4a26', b: '#9fd8ff' }, unlock: { kind: 'flights', n: 3 } },
]

const shirt = (name: string, rows: string[], colors: Record<string, string>): Part => ({ name, y: 7, rows, colors })
export const SHIRTS: Part[] = [
  shirt('Red tee', ['ccccccc', 'scccccs', '.ccccc.'], { c: '#e8473c' }),
  shirt('Blue tee', ['ccccccc', 'scccccs', '.ccccc.'], { c: '#3d7be0' }),
  shirt('Green hoodie', ['ccccccc', 'cccdccc', 'ccccccc'], { c: '#3fae6a', d: '#bff0cf' }),
  shirt('Purple hoodie', ['ccccccc', 'cccdccc', 'ccccccc'], { c: '#8a5cf0', d: '#e2d6ff' }),
  shirt('Stripes', ['ccccccc', 'sddddds', '.ccccc.'], { c: '#1f3a6e', d: '#f2f2f2' }),
  shirt('Jacket', ['ccdddcc', 'ccdddcc', 'ccdddcc'], { c: '#26252b', d: '#f2f2f2' }),
  shirt('Tank top', ['s.ccc.s', 's.ccc.s', '.ccccc.'], { c: '#ffd23f' }),
  shirt('Sweater', ['ccccccc', 'cdcdcdc', 'ccccccc'], { c: '#e9822f', d: '#ffd5a8' }),
  // Earned
  { ...shirt('Radio tee', ['ccccccc', 'scdddcs', '.ccccc.'], { c: '#26252b', d: '#ffb000' }), unlock: { kind: 'stations', n: 10 } },
  { ...shirt('Matching scarf', ['ddddddd', 'scccccs', '.ccccd.'], { c: '#3d7be0', d: '#e8473c' }), unlock: { kind: 'togetherHours', n: 5 } },
  { ...shirt('Flame shirt', ['ccccccc', 'sdcdcds', '.ddddd.'], { c: '#e8473c', d: '#ffd23f' }), unlock: { kind: 'streak', n: 7 } },
  { ...shirt('Starry sweater', ['ccccccc', 'cdcccdc', 'ccdcdcc'], { c: '#1f2a5e', d: '#fff6b0' }), unlock: { kind: 'focusHours', n: 25 } },
  { ...shirt('Sky tee', ['ccccccc', 'scdddcs', '.ccccc.'], { c: '#7fc8ff', d: '#ffffff' }), unlock: { kind: 'balloonRides', n: 1 } },
]

const pants = (name: string, rows: string[], color: string): Part => ({ name, y: 10, rows, colors: { p: color } })
export const PANTS: Part[] = [
  pants('Jeans', ['.ppppp.', '.pp.pp.'], '#3557a6'),
  pants('Black jeans', ['.ppppp.', '.pp.pp.'], '#25232b'),
  pants('Khakis', ['.ppppp.', '.pp.pp.'], '#c7a46b'),
  pants('Shorts', ['.ppppp.', '.ss.ss.'], '#3fae6a'),
  pants('Skirt', ['ppppppp', '.ss.ss.'], '#d6336c'),
  pants('Joggers', ['.ppppp.', '.pp.pp.'], '#8a8f99'),
  pants('Purple', ['.ppppp.', '.pp.pp.'], '#6a3fb8'),
  pants('White', ['.ppppp.', '.pp.pp.'], '#e9e9ee'),
  // Earned
  { name: 'Plaid', y: 10, rows: ['.pqpqp.', '.qp.pq.'], colors: { p: '#b8322f', q: '#2b2b33' }, unlock: { kind: 'countries', n: 10 } },
  { ...pants('Gold', ['.ppppp.', '.pp.pp.'], '#e6b422'), unlock: { kind: 'focusHours', n: 50 } },
]

const shoes = (name: string, color: string): Part => ({ name, y: 12, rows: ['.ff.ff.'], colors: { f: color } })
export const SHOES: Part[] = [
  shoes('White sneakers', '#f4f4f7'),
  shoes('Black boots', '#18161c'),
  shoes('Red kicks', '#e8473c'),
  shoes('Brown boots', '#7a4a26'),
  shoes('Yellow', '#ffd23f'),
  shoes('Pink', '#ff7eb6'),
  shoes('Blue', '#3d7be0'),
  { name: 'Barefoot', y: 12, rows: ['.ss.ss.'], colors: {} },
  // Earned
  { ...shoes('Moon boots', '#c0c4cc'), unlock: { kind: 'countries', n: 20 } },
  { ...shoes('Glow sneakers', '#7df9ff'), unlock: { kind: 'stations', n: 25 } },
]

export const PARTS: Record<AvatarSlot, Part[]> = { head: HEADS, hat: HATS, shirt: SHIRTS, pants: PANTS, shoes: SHOES }
export const PART_COUNTS: Record<AvatarSlot, number> = {
  head: HEADS.length,
  hat: HATS.length,
  shirt: SHIRTS.length,
  pants: PANTS.length,
  shoes: SHOES.length,
}

export const SLOT_LABEL: Record<AvatarSlot, string> = { head: 'Head', hat: 'Hat', shirt: 'Shirt', pants: 'Pants', shoes: 'Shoes' }

export const DEFAULT_AVATAR: Avatar = { head: 0, hat: 3, shirt: 1, pants: 0, shoes: 0 }

/** Which parts may be worn; by default the ones that need no milestone. */
export type PartFilter = (slot: AvatarSlot, index: number) => boolean
export const basePart: PartFilter = (slot, index) => !PARTS[slot][index]?.unlock

export function randomAvatar(random = Math.random, allowed: PartFilter = basePart): Avatar {
  return Object.fromEntries(
    AVATAR_SLOTS.map((slot) => {
      const options = PARTS[slot].map((_, i) => i).filter((i) => allowed(slot, i))
      return [slot, options[Math.floor(random() * options.length)] ?? 0]
    }),
  ) as unknown as Avatar
}

/** A stable look for someone who hasn't shared one (e.g. an older server), derived from their id. */
export function avatarFromId(id: string): Avatar {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return randomAvatar(() => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    return ((h >>> 0) % 10007) / 10007
  })
}

/** The next allowed part in a slot (wrapping), skipping locked ones. */
export function cycle(avatar: Avatar, slot: AvatarSlot, step: number, allowed: PartFilter = () => true): Avatar {
  const n = PART_COUNTS[slot]
  let i = avatar[slot]
  for (let k = 0; k < n; k++) {
    i = (((i + step) % n) + n) % n
    if (allowed(slot, i)) return { ...avatar, [slot]: i }
  }
  return avatar
}

/**
 * Composite the avatar into a 13×7 grid of CSS colours (null = transparent).
 * `stride` spreads the feet apart for the second walking frame.
 */
export function composeAvatar(avatar: Avatar, stride = false): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: AVATAR_H }, () => Array<string | null>(AVATAR_W).fill(null))
  const headPart = HEADS[avatar.head] ?? HEADS[0]
  const layer = (part: Part | undefined) => {
    if (!part) return
    part.rows.forEach((row, dy) => {
      const y = part.y + dy
      if (y < 0 || y >= AVATAR_H) return
      for (let x = 0; x < AVATAR_W; x++) {
        const ch = row[x]
        if (!ch || ch === '.') continue
        const color = ch === 's' ? headPart.skin : part.colors[ch]
        if (color) grid[y][x] = color
      }
    })
  }
  layer(PANTS[avatar.pants])
  layer(SHOES[avatar.shoes])
  layer(SHIRTS[avatar.shirt])
  layer(headPart)
  layer(HATS[avatar.hat])

  if (stride) {
    // Mid-step: the lowest leg row and the feet swing outward by one pixel
    for (const y of [AVATAR_H - 2, AVATAR_H - 1]) {
      const row = grid[y]
      grid[y] = row.map((_, x) => (x < 3 ? (row[x + 1] ?? null) : x > 3 ? (row[x - 1] ?? null) : null))
    }
  }
  return grid
}
