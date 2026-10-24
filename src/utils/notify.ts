/**
 * Show a system notification. Installed apps and some mobile browsers only allow them
 * from the service worker, so that is tried first. False when nothing could be shown.
 */
export async function notify(title: string, options: NotificationOptions & { tag: string }): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const registration = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined
    if (registration?.active) {
      await registration.showNotification(title, { icon: '/icons/icon-192.png', ...options })
      return true
    }
    const shown = new Notification(title, options)
    shown.onclick = () => {
      window.focus()
      shown.close()
    }
    return true
  } catch {
    return false
  }
}

/** Notification clicks the service worker hands back to the page, by tag. */
export function onNotificationClick(handler: (tag: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  const listener = (event: MessageEvent) => {
    const data: unknown = event.data
    if (data && typeof data === 'object' && (data as { type?: unknown }).type === 'notification-click') {
      const tag = (data as { tag?: unknown }).tag
      if (typeof tag === 'string') handler(tag)
    }
  }
  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}
