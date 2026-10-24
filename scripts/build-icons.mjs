// Renders public/favicon.svg (a 16×16 grid of <rect>s) into the PNG app icons the web app
// manifest and iOS need. Run with `npm run icons`; the outputs are committed.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const PUBLIC = new URL('../public/', import.meta.url)
const GRID = 16
const INK = [0x0b, 0x0a, 0x12, 0xff]

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 0xff]

/** The favicon's rects painted in order onto a GRID×GRID array of RGBA pixels. */
function readGrid() {
  const svg = readFileSync(new URL('favicon.svg', PUBLIC), 'utf8')
  const grid = Array.from({ length: GRID * GRID }, () => INK)
  for (const [, attrs] of svg.matchAll(/<rect([^>]*)\/>/g)) {
    const attr = (name, fallback) => Number(attrs.match(new RegExp(`\\b${name}="([\\d.]+)"`))?.[1] ?? fallback)
    const fill = attrs.match(/fill="(#[0-9a-f]{6})"/i)?.[1]
    if (!fill) continue
    const x0 = attr('x', 0)
    const y0 = attr('y', 0)
    for (let y = y0; y < y0 + attr('height', GRID); y++) {
      for (let x = x0; x < x0 + attr('width', GRID); x++) grid[y * GRID + x] = hex(fill)
    }
  }
  return grid
}

/** Nearest-neighbour scale of the grid into `size` px, the art filling `art` px in the middle. */
function render(grid, size, art) {
  const px = Buffer.alloc(size * size * 4)
  const offset = Math.floor((size - art) / 2)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(((x - offset) * GRID) / art)
      const gy = Math.floor(((y - offset) * GRID) / art)
      const inside = gx >= 0 && gy >= 0 && gx < GRID && gy < GRID
      px.set(inside ? grid[gy * GRID + gx] : INK, (y * size + x) * 4)
    }
  }
  return px
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, px) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  // Each scanline starts with filter type 0 (none)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const grid = readGrid()
// Maskable icons are cropped to a circle of 80% diameter, so the art sits in the middle 60%
const icons = [
  ['icons/icon-192.png', 192, 192],
  ['icons/icon-512.png', 512, 512],
  ['icons/maskable-512.png', 512, 320],
  ['icons/apple-touch-icon.png', 180, 160],
]
for (const [file, size, art] of icons) {
  writeFileSync(new URL(file, PUBLIC), png(size, render(grid, size, art)))
  console.log(`wrote public/${file}`)
}
