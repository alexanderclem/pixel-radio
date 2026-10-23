import { composeAvatar, SHIRTS, type Avatar } from './parts'

/**
 * Rides for longer trips. Each vehicle is a token-row sprite (like the avatar parts)
 * with the avatar's upper body sat in it; "c" is the rider's shirt colour so boats,
 * planes and balloons match their owner. All face east; the renderer mirrors them.
 */

export type VehicleMode = 'boat' | 'plane' | 'balloon'

interface VehicleArt {
  /** Rows per animation frame */
  frames: string[][]
  colors: Record<string, string>
  /** Where the rider's top-left pixel goes, and how many avatar rows show; the vehicle is drawn over them */
  rider: { x: number; y: number; rows: number }
}

const BOAT_HULL = ['.............', '.............', 'wwwwwwwwwwwww', '.hhhhhhhhhhh.', '..hhhhhhhhh..']
const PLANE_BODY = [
  't..................',
  'tt.................',
  'ttt................',
  'fffffffffffffffff..',
  'cccccccccccccccfp..',
  '.ffffffffffffff....',
  '......gggggg.......',
  '.......k...k.......',
]
const BALLOON_TOP = [
  '...cacac...',
  '..accacca..',
  '.caccaccac.',
  'cacccaccaca',
  'cacccaccaca',
  'cacccaccaca',
  '.caccaccac.',
  '..accacca..',
  '...cacac...',
  '....ccc....',
  '...r...r...',
  '..r.....r..',
]
const rope = '.r.......r.'

/** Overlay rows onto a blank w×h canvas starting at row `y`. */
const place = (w: number, h: number, layers: [number, string[]][]) => {
  const out = Array.from({ length: h }, () => '.'.repeat(w))
  for (const [y, rows] of layers) {
    rows.forEach((row, dy) => {
      const under = out[y + dy]
      if (under !== undefined) out[y + dy] = [...under].map((ch, x) => (row[x] && row[x] !== '.' ? row[x] : ch)).join('')
    })
  }
  return out
}

const ART: Record<VehicleMode, VehicleArt> = {
  // Rider rows 0–8 (head and shoulders) sit behind the gunwale; oars dip and lift
  boat: {
    frames: [
      place(13, 13, [[7, BOAT_HULL], [9, ['o...........o']], [10, ['.o.........o.']], [12, ['r...........r']]]),
      place(13, 13, [[7, BOAT_HULL], [8, ['oo.........oo']], [12, ['..r.......r..']]]),
    ],
    colors: { w: '#c58b4e', h: '#7a4a26', o: '#e0c08a', r: '#bfe8ff' },
    rider: { x: 3, y: 0, rows: 10 },
  },
  // Open cockpit: head and shoulders above the fuselage, propeller spinning at the nose
  plane: {
    frames: [
      place(19, 14, [[6, PLANE_BODY], [8, ['.................p.']], [10, ['.................p.']]]),
      place(19, 14, [[6, PLANE_BODY], [9, ['.................pp']]]),
    ],
    colors: { t: '', f: '#f4f4f7', g: '#c9ccd6', p: '#2b2b33', k: '#18161c' },
    rider: { x: 8, y: 0, rows: 10 },
  },
  // Rider's head peeks over the basket rim under a striped envelope
  balloon: {
    frames: [
      place(11, 22, [[0, BALLOON_TOP], [12, Array(7).fill(rope)], [19, ['.bbbbbbbbb.', '.bBbBbBbBb.', '..bbbbbbb..']]]),
    ],
    colors: { a: '#f4f4f7', r: '#5b4632', b: '#9a6332', B: '#6e4422' },
    rider: { x: 2, y: 12, rows: 8 },
  },
}

export const vehicleFrames = (mode: VehicleMode) => ART[mode].frames.length

/** The rider's shirt colour, used for fuselage stripes, tails and envelopes. */
const shirtColor = (avatar: Avatar) => SHIRTS[avatar.shirt]?.colors.c ?? '#e8473c'

/** Composite a rider into a vehicle frame: a grid of CSS colours (null = transparent). */
export function composeVehicle(avatar: Avatar, mode: VehicleMode, frame = 0): (string | null)[][] {
  const art = ART[mode]
  const rows = art.frames[frame % art.frames.length]
  const colors: Record<string, string> = { ...art.colors, c: shirtColor(avatar) }
  if (mode === 'plane') colors.t = colors.c
  const grid: (string | null)[][] = rows.map((row) => [...row].map(() => null))
  const body = composeAvatar(avatar)
  for (let y = 0; y < art.rider.rows; y++) {
    body[y]?.forEach((c, x) => {
      if (c && grid[art.rider.y + y]?.[art.rider.x + x] !== undefined) grid[art.rider.y + y][art.rider.x + x] = c
    })
  }
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (colors[ch]) grid[y][x] = colors[ch]
    }),
  )
  return grid
}
