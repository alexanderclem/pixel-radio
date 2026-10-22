import { sleep } from '../utils/math'
import { geoDistance } from '../utils/geo'
import { fetchGeoStations, fetchStationsNear, fetchUnplacedPage, fetchUnplacedStations } from './radioBrowser'
import { stationIndex } from './stationIndex'

const PAGE = 1000

/**
 * Streams the Radio Browser catalogue onto the map:
 *  1. pages through every geolocated station in the background, most popular first,
 *     then through every station without coordinates (placed near its region's stations);
 *  2. when the camera dives into a region, fetches that region's stations immediately;
 *  3. once zoomed into a country, pulls in its stations that have no coordinates first.
 */
class StationLoader {
  onChange: (() => void) | null = null
  private started = false
  private tiles = new Set<string>()
  private countries = new Set<string>()
  private inflight = 0

  start() {
    if (this.started) return
    this.started = true
    void (async () => {
      // Geolocated stations first: they anchor the approximate placement of the rest
      await this.pageCatalogue(fetchGeoStations)
      await this.pageCatalogue(fetchUnplacedPage)
    })()
  }

  private notify(added: number) {
    if (added > 0) this.onChange?.()
  }

  private async pageCatalogue(fetchPage: typeof fetchGeoStations) {
    let offset = 0
    let failures = 0
    for (;;) {
      try {
        const { stations, raw } = await fetchPage(offset, PAGE)
        this.notify(stationIndex.add(stations))
        failures = 0
        if (raw < PAGE) return
        offset += PAGE
        await sleep(700)
      } catch {
        if (++failures > 5) return
        await sleep(4000 * failures)
      }
    }
  }

  /** Called a few times a second with the camera view. */
  focus(lon: number, lat: number, zoom: number, spanDeg: number) {
    if (zoom < 2.5 || this.inflight >= 2) return

    // Tile size halves as you zoom: 16°, 8°, 4°, 2°
    const size = zoom < 5 ? 16 : zoom < 10 ? 8 : zoom < 20 ? 4 : 2
    const tx = Math.round(lon / size)
    const ty = Math.round(lat / size)
    const key = `${size}:${tx}:${ty}`
    if (!this.tiles.has(key)) {
      this.tiles.add(key)
      this.run(fetchStationsNear(ty * size, tx * size, size * 111 * 0.8, 500))
      return
    }

    if (zoom >= 4) {
      const [near] = stationIndex.nearest(lon, lat, 1)
      if (near?.country && !this.countries.has(near.country) && geoDistance(lon, lat, near.lon!, near.lat!) < spanDeg) {
        this.countries.add(near.country)
        this.run(fetchUnplacedStations(near.country, 600))
      }
    }
  }

  private run(request: ReturnType<typeof fetchStationsNear>) {
    this.inflight++
    request
      .then((stations) => this.notify(stationIndex.add(stations)))
      .catch(() => {})
      .finally(() => this.inflight--)
  }
}

export const stationLoader = new StationLoader()
