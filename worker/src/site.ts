import { stationPage } from './stationPage'

/**
 * The site Worker (`pixel-radio`). Static files are served without running this script;
 * only /api/* and /s/* reach it (see run_worker_first in the root wrangler.jsonc).
 * /api/* goes to the friends Worker over a service binding, which makes the site's own
 * origin a valid VITE_PRESENCE_URL with no cross-origin requests. /s/* (shared station
 * links) gets the app's page with link-preview tags naming the station.
 */
interface SiteEnv {
  PRESENCE: Fetcher
  ASSETS: Fetcher
}

export default {
  fetch(request: Request, env: SiteEnv): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/')) return env.PRESENCE.fetch(request)
    if (pathname.startsWith('/s/')) return stationPage(request, env.ASSETS)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<SiteEnv>
