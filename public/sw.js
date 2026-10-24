// Pixel Radio's service worker: makes the site installable and quick to reopen. It caches
// only the site's own files. Radio streams, the relay, the API, and every other origin
// (Radio Browser, Open-Meteo, stations) go straight to the network, untouched.
const CACHE = 'pixel-radio-v1'
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const copy = response.clone()
    void caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

/** Pages always come from the network when it answers; the cached app shell covers offline. */
const networkFirstPage = async (request, url) => {
  try {
    const response = await fetch(request)
    // /s/ pages carry per-station preview tags, so only the plain shell is kept
    if (response.ok && url.pathname === SHELL) {
      const copy = response.clone()
      void caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
    }
    return response
  } catch (error) {
    const cached = (await caches.match(request)) ?? (await caches.match(SHELL))
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request, url))
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request))
  }
})

// Clicking a focus or scheduled-mood notification brings the app forward
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows[0]
      if (open) {
        open.postMessage({ type: 'notification-click', tag: event.notification.tag })
        return open.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
