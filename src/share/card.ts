import { composeAvatar, type Avatar } from '../avatar/parts'
import type { MapView } from '../render/mapSnapshot'

export const CARD_W = 1200
export const CARD_H = 630
/** Map pixels are drawn this many times larger on the card. */
const MAP_SCALE = 4
const MAP_W = 600

export interface CardInfo {
  stationName: string
  /** "Tokyo, Japan" */
  place: string
  lat: number | null
  lon: number | null
  song: string | null
  /** "23:14" local time at the station, when known */
  time: string | null
  /** "RAIN 57°F", when known */
  weather: string | null
  avatar: Avatar
  url: string
}

/** The card's text, top to bottom (pure, so it can be tested without a canvas). */
export function cardLines(info: CardInfo) {
  return {
    brand: 'PIXEL RADIO',
    kicker: 'NOW LISTENING',
    station: info.stationName,
    song: info.song ? `♪ ${info.song}` : null,
    details: [info.place, info.time, info.weather].filter(Boolean).join(' · ').toUpperCase(),
    url: info.url.replace(/^https?:\/\//, ''),
  }
}

/** Where to crop the map: centred on the station when it's in view, else the middle. */
export function cropFor(view: Pick<MapView, 'width' | 'height' | 'project'>, lat: number | null, lon: number | null) {
  const w = Math.min(view.width, MAP_W / MAP_SCALE)
  const h = Math.min(view.height, Math.ceil(CARD_H / MAP_SCALE))
  let [cx, cy] = lat !== null && lon !== null ? view.project(lon, lat) : [view.width / 2, view.height / 2]
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < 0 || cx > view.width || cy < 0 || cy > view.height) {
    ;[cx, cy] = [view.width / 2, view.height / 2]
  }
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), view.width - w))
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), view.height - h))
  return { x, y, w, h }
}

/** Shorten text with an ellipsis until it fits. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let chars = [...text]
  while (chars.length > 1 && ctx.measureText(`${chars.join('')}…`).width > max) chars = chars.slice(0, -1)
  return `${chars.join('').trimEnd()}…`
}

/** A 1200×630 PNG: the map around the station on the left, what's playing on the right. */
export async function drawCard(info: CardInfo, view: MapView | null): Promise<Blob> {
  await Promise.all([document.fonts?.load('28px "Press Start 2P"'), document.fonts?.load('40px VT323')])
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#0b0a12'
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  if (view) {
    const c = cropFor(view, info.lat, info.lon)
    ctx.drawImage(view.image, c.x, c.y, c.w, c.h, 0, 0, c.w * MAP_SCALE, c.h * MAP_SCALE)
  }
  // Scanlines and a soft edge so the crop reads as the receiver's screen
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  for (let y = 0; y < CARD_H; y += 4) ctx.fillRect(0, y, MAP_W, 2)
  const edge = ctx.createLinearGradient(MAP_W - 120, 0, MAP_W, 0)
  edge.addColorStop(0, 'rgba(11,10,18,0)')
  edge.addColorStop(1, 'rgba(11,10,18,1)')
  ctx.fillStyle = edge
  ctx.fillRect(MAP_W - 120, 0, 120, CARD_H)

  const lines = cardLines(info)
  const left = MAP_W + 40
  const max = CARD_W - left - 48
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#ffb000'
  ctx.font = '28px "Press Start 2P"'
  ctx.fillText(lines.brand, left, 56)
  ctx.fillStyle = '#5c7a52'
  ctx.font = '30px VT323'
  ctx.fillText(lines.kicker, left, 120)
  ctx.fillStyle = '#b6ff9e'
  // Long names step down a size or two before they're shortened
  for (const size of [60, 52, 44]) {
    ctx.font = `${size}px VT323`
    if (ctx.measureText(lines.station).width <= max) break
  }
  ctx.fillText(fit(ctx, lines.station, max), left, 152)
  let y = 222
  if (lines.song) {
    ctx.fillStyle = '#e4ffd8'
    ctx.font = '40px VT323'
    ctx.fillText(fit(ctx, lines.song, max), left, y)
    y += 52
  }
  ctx.fillStyle = '#8fd27a'
  ctx.font = '34px VT323'
  ctx.fillText(fit(ctx, lines.details, max), left, y)

  // The listener's avatar at ten times size, standing at the bottom
  const grid = composeAvatar(info.avatar, false)
  const px = 10
  const ay = CARD_H - 56 - grid.length * px
  grid.forEach((row, gy) =>
    row.forEach((c, gx) => {
      if (!c) return
      ctx.fillStyle = c
      ctx.fillRect(left + gx * px, ay + gy * px, px, px)
    }),
  )
  ctx.fillStyle = '#ffb000'
  ctx.font = '30px VT323'
  ctx.fillText(fit(ctx, lines.url, max - 110), left + 110, CARD_H - 90)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image export failed'))), 'image/png'))
}
