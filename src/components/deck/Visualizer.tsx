import { useRef, useState } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'
import { Segmented } from './ToggleSwitch'

type Mode = 'spectrum' | 'scope'

const W = 160
const H = 64
const BARS = 32

/** Phosphor-green FFT bars or a triggered oscilloscope trace, rendered at low res. */
export function Visualizer({ active }: { active: boolean }) {
  const [mode, setMode] = useState<Mode>('spectrum')
  const canvas = useRef<HTMLCanvasElement>(null)
  const buffers = useRef<{ freq: Uint8Array<ArrayBuffer>; time: Uint8Array<ArrayBuffer> } | null>(null)
  const peaks = useRef(new Float32Array(BARS))

  useAnimationFrame((dt, t) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const analyser = active ? audioEngine.analyser : null

    if (mode === 'scope') {
      // Persistence: fade the previous frame instead of clearing
      ctx.fillStyle = 'rgba(4,10,6,0.45)'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(125,255,168,0.08)'
      for (let x = 0; x < W; x += 20) ctx.fillRect(x, 0, 1, H)
      for (let y = 0; y < H; y += 16) ctx.fillRect(0, y, W, 1)
    } else {
      ctx.fillStyle = '#040a06'
      ctx.fillRect(0, 0, W, H)
    }

    if (!analyser) {
      ctx.fillStyle = '#2b6b41'
      for (let x = 0; x < W; x++) {
        const y = H / 2 + Math.round(Math.sin(x * 0.2 + t * 2) * 0.6 + (Math.random() - 0.5))
        ctx.fillRect(x, y, 1, 1)
      }
      return
    }

    if (!buffers.current || buffers.current.freq.length !== analyser.frequencyBinCount) {
      buffers.current = {
        freq: new Uint8Array(analyser.frequencyBinCount),
        time: new Uint8Array(analyser.fftSize),
      }
    }
    const { freq, time } = buffers.current

    if (mode === 'spectrum') {
      analyser.getByteFrequencyData(freq)
      const nyquist = analyser.context.sampleRate / 2
      const barW = W / BARS
      for (let b = 0; b < BARS; b++) {
        // Log-spaced bands from 35 Hz to 16 kHz
        const f0 = 35 * Math.pow(16000 / 35, b / BARS)
        const f1 = 35 * Math.pow(16000 / 35, (b + 1) / BARS)
        const i0 = Math.floor((f0 / nyquist) * freq.length)
        const i1 = Math.max(i0 + 1, Math.floor((f1 / nyquist) * freq.length))
        let max = 0
        for (let i = i0; i < i1; i++) max = Math.max(max, freq[i])
        const level = max / 255
        const blocks = Math.round(level * (H / 3))
        for (let k = 0; k < blocks; k++) {
          const y = H - (k + 1) * 3
          ctx.fillStyle = k > 16 ? '#ff4d6d' : k > 12 ? '#ffb347' : '#7dffa8'
          ctx.fillRect(Math.floor(b * barW), y, Math.ceil(barW) - 1, 2)
        }
        peaks.current[b] = Math.max(level, peaks.current[b] - dt * 0.4)
        const py = H - Math.round(peaks.current[b] * (H / 3)) * 3 - 2
        ctx.fillStyle = '#e8fff0'
        ctx.fillRect(Math.floor(b * barW), py, Math.ceil(barW) - 1, 1)
      }
    } else {
      analyser.getByteTimeDomainData(time)
      // Rising zero-crossing trigger keeps the waveform steady
      let start = 0
      for (let i = 1; i < time.length / 2; i++) {
        if (time[i - 1] < 128 && time[i] >= 128) {
          start = i
          break
        }
      }
      const span = Math.min(time.length - start, 1024)
      ctx.fillStyle = '#7dffa8'
      let prevY = -1
      for (let x = 0; x < W; x++) {
        const v = time[start + Math.floor((x / W) * span)] / 255
        const y = Math.round((1 - v) * (H - 2)) + 1
        if (prevY < 0) prevY = y
        const top = Math.min(prevY, y)
        ctx.fillRect(x, top, 1, Math.abs(y - prevY) + 1)
        prevY = y
      }
    }
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="lcd overflow-hidden rounded-[3px] p-1">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          role="img"
          aria-label={mode === 'spectrum' ? 'Spectrum analyser' : 'Oscilloscope'}
          className="pixelated block aspect-[5/2] w-full"
        />
      </div>
      <Segmented
        label="Display"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'spectrum', label: 'FFT' },
          { value: 'scope', label: 'Scope' },
        ]}
      />
    </div>
  )
}
