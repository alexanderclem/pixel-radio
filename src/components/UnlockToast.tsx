import { motion } from 'motion/react'
import { useEffect } from 'react'
import { rewardOf, UNLOCKS } from '../avatar/unlocks'
import { isCalm, useRadioStore } from '../store/useRadioStore'

/** Brief banner when a milestone earns a new avatar part. */
export function UnlockToast() {
  const notice = useRadioStore((s) => s.unlockNotice)
  const dismiss = useRadioStore((s) => s.dismissUnlock)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const calm = useRadioStore(isCalm)

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(dismiss, 4000)
    return () => window.clearTimeout(id)
  }, [notice, dismiss])

  if (!notice) return null
  const unlock = UNLOCKS.find((u) => u.id === notice.id)
  const reward = rewardOf(notice.id)
  return (
    <motion.button
      key={notice.nonce}
      type="button"
      role="status"
      onClick={() => {
        dismiss()
        setDrawer('avatar')
      }}
      initial={calm ? false : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-14 left-1/2 z-50 -translate-x-1/2 rounded-[3px] border-2 border-black bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-center text-black shadow-[0_3px_0_#000]"
    >
      <div className="font-pixel text-[10px] tracking-wide">UNLOCKED: {(reward?.name ?? unlock?.title ?? '').toUpperCase()}</div>
      <div className="font-term text-[15px] leading-tight">{unlock?.title} · tap to try it on</div>
    </motion.button>
  )
}
