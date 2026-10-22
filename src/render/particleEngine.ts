import type { Palette } from '../constants/palettes'
import type { WeatherType } from '../types'
import { mulberry32, rgba } from '../utils/math'

const KIND = { RAIN: 0, SPLASH: 1, SNOW: 2, EMBER: 3 } as const
type Kind = (typeof KIND)[keyof typeof KIND]

interface Particle {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  /** Rain: ground line to splash at. Others: wobble seed. */
  aux: number
  size: number
}

interface Star {
  x: number
  y: number
  speed: number
  seed: number
  bright: boolean
}

export interface WeatherInput {
  type: WeatherType
  /** 0..~1.5 */
  intensity: number
  /** -1..1 */
  wind: number
}

const MAX_PARTICLES = 2200

/**
 * Pooled weather particles in internal pixel space: rain (with splashes), snow,
 * rising embers, twinkling stars, aurora ribbons and storm lightning.
 */
export class ParticleEngine {
  onLightning: ((strength: number) => void) | null = null
  /** Calm mode: lightning neither flashes the screen nor triggers thunder */
  calm = false
  private pool: Particle[] = []
  private alive = 0
  private stars: Star[] = []
  private spawnAcc = 0
  private flash = 0
  /** Eased copy of `flash`, so a bolt swells and fades instead of strobing */
  private flashLevel = 0
  private nextBolt = 3
  private w = 1
  private h = 1

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({ kind: KIND.RAIN, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, aux: 0, size: 1 })
    }
  }

  resize(w: number, h: number) {
    this.w = w
    this.h = h
    const rand = mulberry32(1337)
    const count = Math.floor((w * h) / 700)
    this.stars = Array.from({ length: count }, () => ({
      x: rand() * w,
      y: rand() * h * 0.7,
      speed: 1 + rand() * 3,
      seed: rand() * 100,
      bright: rand() < 0.12,
    }))
  }

  private spawn(): Particle | null {
    if (this.alive >= MAX_PARTICLES) return null
    return this.pool[this.alive++]
  }

  private emit(wx: WeatherInput) {
    const { w, h } = this
    const p = this.spawn()
    if (!p) return
    const r = Math.random
    if (wx.type === 'rain' || wx.type === 'storm') {
      const speed = wx.type === 'storm' ? 1.35 : 1
      p.kind = KIND.RAIN
      p.vy = (h * 0.9 + r() * h * 0.4) * speed
      p.vx = wx.wind * h * 0.35 * speed
      // Spawn upwind so slanted rain still covers the screen
      p.x = r() * (w + Math.abs(p.vx)) - (p.vx > 0 ? Math.abs(p.vx) : 0)
      p.y = -10 - r() * 20
      p.aux = h * (0.55 + r() * 0.45)
      p.life = 0
      p.maxLife = 4
      p.size = 1
    } else if (wx.type === 'snow') {
      p.kind = KIND.SNOW
      p.x = r() * w
      p.y = -4
      p.vy = 12 + r() * 26
      p.vx = wx.wind * 28
      p.aux = r() * 100
      p.life = 0
      p.maxLife = 30
      p.size = r() < 0.25 ? 2 : 1
    } else if (wx.type === 'embers') {
      p.kind = KIND.EMBER
      p.x = r() * w
      p.y = h + 2
      p.vy = -(14 + r() * 34)
      p.vx = wx.wind * 14
      p.aux = r() * 100
      p.life = 0
      p.maxLife = 3 + r() * 5
      p.size = r() < 0.2 ? 2 : 1
    } else {
      this.alive--
    }
  }

  private splash(x: number, y: number) {
    for (let k = 0; k < 2; k++) {
      const p = this.spawn()
      if (!p) return
      p.kind = KIND.SPLASH
      p.x = x
      p.y = y
      p.vx = (Math.random() - 0.5) * 50
      p.vy = -(30 + Math.random() * 40)
      p.life = 0
      p.maxLife = 0.22 + Math.random() * 0.12
      p.aux = 0
      p.size = 1
    }
  }

  update(dt: number, wx: WeatherInput, time: number) {
    const area = (this.w * this.h) / (400 * 250)
    const base =
      wx.type === 'rain' ? 220 : wx.type === 'storm' ? 420 : wx.type === 'snow' ? 60 : wx.type === 'embers' ? 26 : 0
    this.spawnAcc += base * wx.intensity * area * dt
    while (this.spawnAcc >= 1) {
      this.emit(wx)
      this.spawnAcc--
    }

    if (wx.type === 'storm' && wx.intensity > 0.05) {
      this.nextBolt -= dt * wx.intensity
      if (this.nextBolt <= 0) {
        this.nextBolt = 2.5 + Math.random() * 7
        if (!this.calm) {
          this.flash = 0.6 + Math.random() * 0.4
          this.onLightning?.(Math.min(1, wx.intensity))
        }
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2)
    this.flashLevel += (this.flash - this.flashLevel) * Math.min(1, dt * 10)

    let i = 0
    while (i < this.alive) {
      const p = this.pool[i]
      p.life += dt
      let dead = p.life >= p.maxLife
      switch (p.kind) {
        case KIND.RAIN:
          p.x += p.vx * dt
          p.y += p.vy * dt
          if (p.y >= p.aux) {
            dead = true
            if (Math.random() < 0.5) this.splash(p.x, p.aux)
          }
          break
        case KIND.SPLASH:
          p.vy += 320 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          break
        case KIND.SNOW:
          p.x += (p.vx + Math.sin(time * 1.3 + p.aux) * 12) * dt
          p.y += p.vy * dt
          if (p.y > this.h + 2) dead = true
          break
        case KIND.EMBER:
          p.x += (p.vx + Math.sin(time * 2.1 + p.aux) * 10) * dt
          p.y += p.vy * dt
          p.vy *= 1 - 0.15 * dt
          if (p.y < -4) dead = true
          break
      }
      if (dead) {
        // Swap-remove keeps the live region packed
        this.alive--
        this.pool[i] = this.pool[this.alive]
        this.pool[this.alive] = p
      } else {
        i++
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, pal: Palette, time: number) {
    const { w, h } = this

    if (pal.stars > 0.01) {
      for (const s of this.stars) {
        const tw = 0.5 + 0.5 * Math.sin(time * s.speed + s.seed)
        const fade = 1 - s.y / (h * 0.7)
        ctx.fillStyle = rgba(pal.star, pal.stars * tw * fade * (s.bright ? 0.7 : 0.35))
        ctx.fillRect(s.x | 0, s.y | 0, 1, 1)
        if (s.bright && tw > 0.85) {
          ctx.fillRect((s.x | 0) - 1, s.y | 0, 3, 1)
          ctx.fillRect(s.x | 0, (s.y | 0) - 1, 1, 3)
        }
      }
    }

    if (pal.aurora > 0.01) this.drawAurora(ctx, pal, time)

    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(pal.rain, 0.55)
    ctx.beginPath()
    for (let i = 0; i < this.alive; i++) {
      const p = this.pool[i]
      if (p.kind !== KIND.RAIN) continue
      const x = Math.round(p.x) + 0.5
      const y = Math.round(p.y)
      ctx.moveTo(x, y)
      ctx.lineTo(Math.round(p.x - p.vx * 0.012) + 0.5, Math.round(p.y - p.vy * 0.012))
    }
    ctx.stroke()

    ctx.fillStyle = rgba(pal.rain, 0.7)
    for (let i = 0; i < this.alive; i++) {
      const p = this.pool[i]
      if (p.kind === KIND.SPLASH) ctx.fillRect(p.x | 0, p.y | 0, 1, 1)
    }

    for (let i = 0; i < this.alive; i++) {
      const p = this.pool[i]
      if (p.kind !== KIND.SNOW) continue
      ctx.fillStyle = rgba(pal.snowfall, 0.85)
      ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size)
    }

    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < this.alive; i++) {
      const p = this.pool[i]
      if (p.kind !== KIND.EMBER) continue
      const k = 1 - p.life / p.maxLife
      const flicker = 0.6 + 0.4 * Math.sin(time * 18 + p.aux)
      ctx.fillStyle = rgba(pal.ember, k * flicker)
      ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size)
    }
    ctx.restore()

    if (this.flashLevel > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${this.flashLevel * 0.3})`
      ctx.fillRect(0, 0, w, h)
    }
  }

  /** Curtains of light: vertical pixel columns whose height and hue drift with time. */
  private drawAurora(ctx: CanvasRenderingContext2D, pal: Palette, t: number) {
    const { w, h } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let band = 0; band < 2; band++) {
      const baseY = h * (0.1 + band * 0.09)
      for (let x = 0; x < w; x += 2) {
        const y = baseY + Math.sin(x * 0.012 + t * 0.35 + band * 2) * h * 0.05 + Math.sin(x * 0.031 - t * 0.6) * h * 0.02
        const len = h * (0.06 + 0.05 * (0.5 + 0.5 * Math.sin(x * 0.05 + t * 1.1 + band)))
        const mix = 0.5 + 0.5 * Math.sin(x * 0.008 + t * 0.2 + band * 1.7)
        const c = mix < 0.5 ? pal.auroraA : pal.auroraB
        const a = pal.aurora * 0.16 * (0.5 + 0.5 * Math.sin(x * 0.02 + t * 0.9))
        ctx.fillStyle = rgba(c, a)
        ctx.fillRect(x, Math.round(y), 2, Math.round(len))
        ctx.fillStyle = rgba(c, a * 1.6)
        ctx.fillRect(x, Math.round(y + len), 2, 1)
      }
    }
    ctx.restore()
  }
}
