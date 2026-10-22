/** The map's internal pixel buffer as last drawn, for share cards. PixelCanvas registers it. */
export interface MapView {
  image: CanvasImageSource
  width: number
  height: number
  /** Geo → buffer pixel */
  project: (lon: number, lat: number) => [number, number]
}

let provider: (() => MapView | null) | null = null

export const setMapView = (fn: (() => MapView | null) | null) => {
  provider = fn
}

export const mapView = () => provider?.() ?? null
