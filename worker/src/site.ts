/**
 * The site Worker (`pixel-radio`). Static files are served without running this script;
 * only /api/* reaches it (see run_worker_first in the root wrangler.jsonc), and those
 * requests go to the friends Worker over a service binding. That makes the site's own
 * origin a valid VITE_PRESENCE_URL, with no cross-origin requests.
 */
interface SiteEnv {
  PRESENCE: Fetcher
  ASSETS: Fetcher
}

export default {
  fetch(request: Request, env: SiteEnv): Promise<Response> {
    const { pathname } = new URL(request.url)
    return pathname.startsWith('/api/') ? env.PRESENCE.fetch(request) : env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<SiteEnv>
