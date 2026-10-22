import { Crosshair, Home, Minus, Plus, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { CITY_BY_ID } from '../constants/cities'
import { blendPalette, PALETTES, PHASE_LABEL, type Palette } from '../constants/palettes'
import { Camera, CITY_ZOOM, MAX_ZOOM } from '../render/camera'
import { CrtRenderer, type CrtUniforms } from '../render/crtShader'
import { setMapView } from '../render/mapSnapshot'
import { loadTerrain } from '../render/loadTerrain'
import { avatarFromId, type Avatar } from '../avatar/parts'
import { AvatarWalker } from '../avatar/walker'
import { LABEL_FONT, MapRenderer, type AvatarMark, type StationHit } from '../render/mapRenderer'
import { ParticleEngine, type WeatherInput } from '../render/particleEngine'
import { classifyPhase, sunElevation, sunPosition } from '../render/solar'
import { stationIndex } from '../services/stationIndex'
import { stationLoader } from '../services/stationLoader'
import { tuneToFriend } from '../social/friendStation'
import type { FriendInfo } from '../social/protocol'
import { currentSong, isCalm, useRadioStore } from '../store/useRadioStore'
import type { CityPreset, SolarPhase, Station } from '../types'
import { computeAmbientMix, geoDistance, nearestCity } from '../utils/geo'
import { clamp, rgba, smoothstep } from '../utils/math'
import { localTimeAt } from '../utils/time'
import { ambientOf, formatTemp, liveWeather, type LiveWeather } from '../weather/liveWeather'

/** CSS pixels per internal "art" pixel. */
const PIXEL_SCALE = 2
const HOME_VIEW = { lon: 15, lat: 18, zoom: 1 }

/** JS twin of the shader's barrel(): maps a screen uv to the source uv it displays. */
const barrel = (u: number, v: number, k: number): [number, number] => {
  const cx = u * 2 - 1
  const cy = v * 2 - 1
  const ox = Math.abs(cy) / 5.5
  const oy = Math.abs(cx) / 4.5
  return [(cx + cx * ox * ox * k) * 0.5 + 0.5, (cy + cy * oy * oy * k) * 0.5 + 0.5]
}

/** Auto weather is the real weather where you're listening, else the nearest city's mood. */
function resolveWeather(focus: CityPreset, live: LiveWeather | null, zoom: number): WeatherInput {
  const s = useRadioStore.getState()
  const { weather } = s
  const manualWind = (weather.wind - 0.5) * 2
  const density = weather.density * 2 * (isCalm(s) ? 0.5 : 1)
  if (weather.mode !== 'auto') return { type: weather.mode, intensity: 0.8 * density, wind: manualWind }
  const base = live ?? focus.weather
  // Zoomed out over the planet the weather thins out; it gets heavier as you dive in
  const local = 0.35 + 0.65 * smoothstep(1.3, 3, zoom)
  return {
    type: base.type,
    intensity: base.intensity * density * local,
    wind: clamp(base.wind + manualWind, -1, 1),
  }
}

function crtUniforms(): CrtUniforms {
  const s = useRadioStore.getState()
  const { crt } = s
  const on = crt.enabled ? 1 : 0
  const calm = isCalm(s)
  return {
    scanlines: on * Number(crt.scanlines) * (calm ? 0.5 : 1),
    aberration: calm ? 0 : on * Number(crt.aberration),
    flicker: calm ? 0 : on * Number(crt.flicker),
    curvature: on * Number(crt.curvature),
    vignette: on * (crt.curvature ? 1 : 0.5),
  }
}

type WalkerTarget = Omit<AvatarMark, 'walking' | 'facing'>
const SELF_ID = '__self'

/** Online friends who are sharing a station with a map position. */
const friendTargetsOf = (list: FriendInfo[]): WalkerTarget[] =>
  list.flatMap((f) => {
    const st = f.online ? f.presence?.station : null
    if (!st || st.lat === null || st.lon === null) return []
    // Friends on an older server share no avatar; give them a stable one from their id
    const avatar: Avatar = f.presence?.avatar ?? avatarFromId(f.userId)
    return [{ id: f.userId, name: f.name, avatar, self: false, stationName: st.name, lon: st.lon, lat: st.lat }]
  })

/** The station the map should highlight: the one playing, else the one being tuned. */
const activeStation = (): { station: Station; playing: boolean; song: string | null } | null => {
  const s = useRadioStore.getState()
  if (s.station?.lat != null) return { station: s.station, playing: s.tuneStatus === 'playing', song: currentSong(s) }
  if (s.tuneStatus === 'tuning' && s.stationRequest?.station.lat != null) return { station: s.stationRequest.station, playing: false, song: null }
  return null
}

export function PixelCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera | null>(null)
  const [webgl, setWebgl] = useState(true)
  const crtEnabled = useRadioStore((s) => s.crt.enabled && s.crt.scanlines)
  const resetView = useRadioStore((s) => s.resetView)
  const locateActive = useRadioStore((s) => s.locateActive)
  const canLocate = useRadioStore((s) => s.station?.lat != null || s.selectedCityId !== null)

  useEffect(() => {
    const container = containerRef.current!
    const canvas = canvasRef.current!
    let map: MapRenderer | null = null
    let disposed = false
    loadTerrain()
      .then((terrain) => {
        if (!disposed) map = new MapRenderer(terrain)
      })
      .catch((err) => console.error('World generation failed', err))

    let lightsVersion = -1
    let lastLights = -Infinity
    let lastCount = 0
    stationLoader.onChange = () => {
      // Throttled so the deck doesn't re-render for every page that lands
      if (stationIndex.size - lastCount > 200 || stationIndex.size < 2000) {
        lastCount = stationIndex.size
        useRadioStore.getState().setStationCount(stationIndex.size)
      }
    }
    stationLoader.start()

    const cam = new Camera()
    cam.flyTo(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.zoom)
    cameraRef.current = cam
    const particles = new ParticleEngine()
    particles.onLightning = (strength) => audioEngine.thunder(strength)

    const buffer = document.createElement('canvas')
    const bctx = buffer.getContext('2d')!
    const crt = CrtRenderer.create(canvas)
    const ctx2d = crt ? null : canvas.getContext('2d')
    if (!crt) setWebgl(false)
    void document.fonts?.load(LABEL_FONT)
    bctx.imageSmoothingEnabled = false
    setMapView(() => ({
      image: buffer,
      width: buffer.width,
      height: buffer.height,
      project: (lon, lat) => cam.geoToScreen(lon, lat),
      camera: { lon: cam.target.lon, lat: cam.target.lat, zoom: cam.target.zoom },
    }))

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      buffer.width = Math.max(1, Math.ceil(rect.width / PIXEL_SCALE))
      buffer.height = Math.max(1, Math.ceil(rect.height / PIXEL_SCALE))
      cam.resize(buffer.width, buffer.height)
      particles.resize(buffer.width, buffer.height)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    // --- Solar phase & palette crossfade state ---
    let phase: SolarPhase | null = null
    let lastOverride = ''
    let fromPal: Palette = PALETTES.day
    let toPal: Palette = PALETTES.day
    let pal: Palette = PALETTES.day
    let blend = 1
    let sun = sunPosition(new Date())
    let focus: CityPreset = nearestCity(cam.lon, cam.lat).city
    let hudLeft = 'GENERATING WORLD…'
    let hudWeather = ''
    let live: LiveWeather | null = null
    let lastSolar = -Infinity
    let lastSpatial = -Infinity
    let hoverCityId: string | null = null
    let hoverStation: StationHit | null = null
    let hoverFriend: string | null = null
    let friendsFor: FriendInfo[] | null = null
    let friendTargets: WalkerTarget[] = []
    const walker = new AvatarWalker()

    /**
     * Where the sky is judged from: the tuned station/city if it's in view, else the camera centre.
     * `live` marks a real place worth fetching weather for (not wherever a pan stopped).
     */
    const pickFocus = (): { lon: number; lat: number; code: string; zone: string | null; weather: CityPreset; live: boolean } => {
      const { selectedCityId } = useRadioStore.getState()
      const selected = selectedCityId ? CITY_BY_ID[selectedCityId] : null
      if (selected && geoDistance(cam.lon, cam.lat, selected.lon, selected.lat) < 25) {
        return { lon: selected.lon, lat: selected.lat, code: selected.code, zone: selected.timeZone, weather: selected, live: true }
      }
      const active = activeStation()?.station
      if (active && geoDistance(cam.lon, cam.lat, active.lon!, active.lat!) < 25) {
        const near = nearestCity(active.lon!, active.lat!)
        return {
          lon: active.lon!, lat: active.lat!, code: active.country || '??',
          zone: near.distance < 3 ? near.city.timeZone : null, weather: near.city, live: true,
        }
      }
      const near = nearestCity(cam.lon, cam.lat)
      return near.distance < 3
        ? { lon: near.city.lon, lat: near.city.lat, code: near.city.code, zone: near.city.timeZone, weather: near.city, live: true }
        : { lon: cam.lon, lat: cam.lat, code: 'GEO', zone: null, weather: near.city, live: false }
    }

    const updateSolar = (t: number) => {
      const s = useRadioStore.getState()
      sun = sunPosition(new Date())
      const f = pickFocus()
      focus = f.weather
      live = f.live && s.weather.mode === 'auto' ? liveWeather.get(f.lat, f.lon) : null
      // A chosen weather is labelled as such, so it's never mistaken for the real thing
      hudWeather =
        s.weather.mode !== 'auto'
          ? `THEMED ${s.weather.mode.toUpperCase()}`
          : live
            ? `${live.label}${live.tempC === null ? '' : ` ${formatTemp(live.tempC)}`}`
            : ''
      const elevation = sunElevation(f.lat, f.lon, sun)
      const next = s.solarOverride === 'auto' ? classifyPhase(elevation, f.lat) : s.solarOverride
      if (next !== phase) {
        fromPal = phase === null ? PALETTES[next] : pal
        toPal = PALETTES[next]
        blend = phase === null ? 1 : 0
        phase = next
        s.setActivePhase(next)
      }
      hudLeft = `${PHASE_LABEL[next]} ${f.code} ${localTimeAt(f.lon, f.lat, false, new Date(), f.zone)}`
      lastSolar = t
      lastOverride = s.solarOverride
    }

    const updateSpatial = (t: number) => {
      const s = useRadioStore.getState()
      const mix = computeAmbientMix(cam.lon, cam.lat, cam.zoom, live && ambientOf(live))
      audioEngine.setSpatialMix(mix)
      s.setGeoMix(mix)
      stationLoader.focus(cam.lon, cam.lat, cam.zoom, cam.width / cam.ppd())
      const city = s.selectedCityId ? CITY_BY_ID[s.selectedCityId] : null
      const source = activeStation()?.station ?? null
      const target = source ? { lon: source.lon!, lat: source.lat! } : city
      if (target) {
        const [sx, sy] = cam.geoToScreen(target.lon, target.lat)
        const nx = (sx - cam.width / 2) / (cam.width / 2)
        const ny = (sy - cam.height / 2) / (cam.height / 2)
        const presence = 1 - smoothstep(0.7, 1.8, Math.max(Math.abs(nx), Math.abs(ny)))
        audioEngine.setStreamSpatial(nx, presence)
      }
      lastSpatial = t
    }

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const t = now / 1000
      const s = useRadioStore.getState()
      const calm = isCalm(s)
      particles.calm = calm

      cam.update(dt)
      if (t - lastSolar > 1 || s.solarOverride !== lastOverride) updateSolar(t)
      if (blend < 1) {
        blend = Math.min(1, blend + dt / 2)
        pal = blendPalette(fromPal, toPal, smoothstep(0, 1, blend))
      } else {
        pal = toPal
      }

      if (map) {
        if (lightsVersion !== stationIndex.version && t - lastLights > 3) {
          map.setLights(stationIndex.placed)
          lightsVersion = stationIndex.version
          lastLights = t
        }
        map.update(pal, sun, t, cam)
        map.draw(bctx, cam, pal)
        map.drawStations(bctx, cam, pal, stationIndex.placed)
      } else {
        bctx.fillStyle = rgba(pal.bg)
        bctx.fillRect(0, 0, buffer.width, buffer.height)
      }
      particles.update(dt, resolveWeather(focus, live, cam.zoom), t)
      particles.draw(bctx, pal, t)
      if (map) {
        map.drawHotspots(bctx, cam, pal, t, {
          selectedCityId: s.selectedCityId, hoverCityId, playing: s.tuneStatus === 'playing', calm,
        })
        map.drawStationOverlays(bctx, cam, pal, t, activeStation(), hoverStation, calm)
        if (s.friends.list !== friendsFor) {
          friendsFor = s.friends.list
          friendTargets = friendTargetsOf(friendsFor)
        }
        // You walk to whatever you're playing or tuning
        const mine = s.powered ? activeStation()?.station : null
        const targets = mine
          ? [{ id: SELF_ID, name: 'You', avatar: s.avatar, self: true, stationName: mine.name, lon: mine.lon!, lat: mine.lat! }, ...friendTargets]
          : friendTargets
        const positions = walker.update(targets, t)
        map.drawAvatars(bctx, cam, pal, t, targets.map((m, i) => ({ ...m, ...positions[i] })), hoverFriend)
      }

      const ns = cam.lat >= 0 ? 'N' : 'S'
      const ew = cam.lon >= 0 ? 'E' : 'W'
      map?.drawHud(
        bctx,
        cam,
        pal,
        hudLeft,
        `${Math.abs(cam.lat).toFixed(2)}${ns} ${Math.abs(cam.lon).toFixed(2)}${ew} ${cam.zoom.toFixed(1)}X`,
        hudWeather,
      )

      if (crt) crt.render(buffer, crtUniforms(), t)
      else if (ctx2d) {
        ctx2d.imageSmoothingEnabled = false
        ctx2d.drawImage(buffer, 0, 0, canvas.width, canvas.height)
      }

      if (t - lastSpatial > 0.1) updateSpatial(t)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // --- Input: pan, pinch/wheel zoom, hover & click hotspots ---
    const pointers = new Map<number, [number, number]>()
    let moved = 0
    let pinchDist = 0

    const toBuffer = (e: { clientX: number; clientY: number }): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      let u = (e.clientX - rect.left) / rect.width
      let v = (e.clientY - rect.top) / rect.height
      if (crt) [u, v] = barrel(u, v, crtUniforms().curvature)
      return [u * buffer.width, v * buffer.height]
    }

    const flyToCity = (id: string) => {
      const city = CITY_BY_ID[id]
      if (city) cam.flyTo(city.lon, city.lat, Math.max(CITY_ZOOM, cam.target.zoom))
    }

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, toBuffer(e))
      moved = 0
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1])
      }
    }

    const onMove = (e: PointerEvent) => {
      const pos = toBuffer(e)
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        hoverFriend = map?.hitTestAvatar(pos[0], pos[1]) ?? null
        hoverCityId = hoverFriend ? null : (map?.hitTestCity(cam, pos[0], pos[1]) ?? null)
        hoverStation = hoverFriend || hoverCityId ? null : (map?.hitTestStation(cam, pos[0], pos[1]) ?? null)
        canvas.style.cursor = hoverFriend || hoverCityId || hoverStation ? 'pointer' : 'grab'
        return
      }
      hoverStation = null
      hoverFriend = null
      pointers.set(e.pointerId, pos)
      if (pointers.size === 1) {
        const dx = pos[0] - prev[0]
        const dy = pos[1] - prev[1]
        moved += Math.abs(dx) + Math.abs(dy)
        cam.panBy(dx, dy)
        canvas.style.cursor = 'grabbing'
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1])
        if (pinchDist > 0) cam.zoomAt(dist / pinchDist, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        pinchDist = dist
        moved = Infinity
      }
    }

    const onUp = (e: PointerEvent) => {
      const pos = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      canvas.style.cursor = 'grab'
      if (!pos || moved > 4 || pointers.size > 0 || !map) return
      const friendId = map.hitTestAvatar(pos[0], pos[1], e.pointerType === 'touch' ? 12 : 8)
      const friend = friendId ? useRadioStore.getState().friends.list.find((f) => f.userId === friendId) : null
      if (friend) {
        void tuneToFriend(friend)
        return
      }
      const cityId = map.hitTestCity(cam, pos[0], pos[1])
      if (cityId) {
        useRadioStore.getState().selectCity(cityId)
        return
      }
      const hit = map.hitTestStation(cam, pos[0], pos[1], e.pointerType === 'touch' ? 12 : 7)
      if (hit) {
        const { lon, lat } = hit.station
        // Clusters open up as you click into them; a lone station just centres
        const zoom = hit.count > 1 ? Math.min(MAX_ZOOM, Math.max(3, cam.target.zoom * 2)) : Math.max(3, cam.target.zoom)
        cam.flyTo(lon!, lat!, zoom)
        useRadioStore.getState().requestStation(hit.station, false)
      }
    }

    const onLeave = () => {
      hoverCityId = null
      hoverStation = null
      hoverFriend = null
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = toBuffer(e)
      cam.zoomAt(Math.exp(-e.deltaY * 0.0015), x, y)
    }

    const onDblClick = (e: MouseEvent) => {
      const [x, y] = toBuffer(e)
      cam.zoomAt(2, x, y)
    }

    const onKey = (e: KeyboardEvent) => {
      const step = 24
      const actions: Record<string, () => void> = {
        ArrowLeft: () => cam.panBy(step, 0),
        ArrowRight: () => cam.panBy(-step, 0),
        ArrowUp: () => cam.panBy(0, step),
        ArrowDown: () => cam.panBy(0, -step),
        '+': () => cam.zoomAt(1.4, cam.width / 2, cam.height / 2),
        '=': () => cam.zoomAt(1.4, cam.width / 2, cam.height / 2),
        '-': () => cam.zoomAt(1 / 1.4, cam.width / 2, cam.height / 2),
      }
      const action = actions[e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('keydown', onKey)

    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.focusNonce !== prev.focusNonce && next.selectedCityId) flyToCity(next.selectedCityId)
      if (next.viewResetNonce !== prev.viewResetNonce) cam.flyTo(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.zoom)
      if (next.flyRequest && next.flyRequest !== prev.flyRequest) {
        const { lon, lat, zoom } = next.flyRequest
        cam.flyTo(lon, lat, Math.max(zoom, cam.target.zoom))
      }
      if (next.locateNonce !== prev.locateNonce) {
        const active = activeStation()?.station
        if (active) cam.flyTo(active.lon!, active.lat!, Math.max(6, cam.target.zoom))
        else if (next.selectedCityId) flyToCity(next.selectedCityId)
      }
      const req = next.stationRequest
      if (req && req !== prev.stationRequest && req.fly && req.station.lat !== null && req.station.lon !== null) {
        cam.flyTo(req.station.lon, req.station.lat, Math.max(6, cam.target.zoom))
      }
    })

    return () => {
      disposed = true
      setMapView(null)
      stationLoader.onChange = null
      cancelAnimationFrame(raf)
      ro.disconnect()
      unsubscribe()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('keydown', onKey)
      cameraRef.current = null
    }
  }, [])

  const zoom = (factor: number) => {
    const cam = cameraRef.current
    if (cam) cam.zoomAt(factor, cam.width / 2, cam.height / 2)
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Pixel world map of radio stations. Drag to pan, scroll to zoom, click a station or city to tune in. Arrow keys pan, plus and minus zoom."
        className="pixelated absolute inset-0 h-full w-full cursor-grab touch-none outline-none"
      />
      {!webgl && crtEnabled && <div className="crt-fallback pointer-events-none absolute inset-0" />}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <MapButton label="Go to playing station" hint="L" icon={Crosshair} onClick={locateActive} disabled={!canLocate} />
        <MapButton label="Zoom in" icon={Plus} onClick={() => zoom(1.6)} />
        <MapButton label="Zoom out" icon={Minus} onClick={() => zoom(1 / 1.6)} />
        <MapButton label="World view" hint="H" icon={Home} onClick={resetView} />
      </div>
    </div>
  )
}

function MapButton({ label, hint, icon: Icon, onClick, disabled }: {
  label: string
  hint?: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center border-2 border-black/60 bg-zinc-900/70 text-zinc-200 shadow-[2px_2px_0_#000] backdrop-blur-sm transition hover:bg-zinc-800 hover:text-amber-300 active:translate-x-px active:translate-y-px active:shadow-none disabled:opacity-40 disabled:hover:bg-zinc-900/70 disabled:hover:text-zinc-200"
    >
      <Icon size={16} strokeWidth={3} />
    </button>
  )
}
