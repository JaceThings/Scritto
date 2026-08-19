// Files for discrete events, a synth for the slider tick (dozens a second on a
// drag), and a silent loop keeping iOS on the session the silent switch spares.

const SOUND_FILES = ['/click.webm', '/copy-success.webm', '/pill-select.webm', '/silent.webm'] as const

for (const src of SOUND_FILES) {
  const a = new Audio(src)
  a.preload = 'auto'
}

const playFile = (src: string, volume: number) => {
  const inst = new Audio(src)
  inst.volume = volume
  inst.play().catch(() => {})
}

export const playClick = () => playFile('/click.webm', 0.6)
export const playCopySuccess = () => playFile('/copy-success.webm', 0.5)
export const playPillSelect = () => playFile('/pill-select.webm', 0.6)

const TICK_VOLUME = 0.075
const TICK_FREQ = 5500
const TICK_DECAY_SEC = 0.006
const NOISE_DURATION_SEC = 0.002
const NOISE_LEVEL = 0.85
const NOISE_Q = 18

let ctx: AudioContext | null = null
const audio = () => {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' })
  return ctx
}

declare global {
  interface Navigator {
    /** Safari only; setting `type` keeps WebAudio off the muted ringer session. */
    audioSession?: { type: string }
  }
}

// Two iOS quirks, both only fixable inside a gesture: the context starts
// suspended, and WebAudio takes the muted ringer session without a live
// HTML5 source.
const unlock = () => {
  try {
    const c = audio()
    c.resume().catch(() => {})
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, 22050)
    src.connect(c.destination)
    src.start(0)

    if (navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback'
      } catch {}
    }

    const silent = new Audio('/silent.webm')
    silent.loop = true
    silent.setAttribute('playsinline', '')
    silent.volume = 0.0001
    silent.play().catch(() => {})
  } catch {
    // Let the next gesture retry — don't strip the listeners.
    return
  }
  window.removeEventListener('pointerdown', unlock)
  window.removeEventListener('keydown', unlock)
}
window.addEventListener('pointerdown', unlock)
window.addEventListener('keydown', unlock)

let noiseBuffer: AudioBuffer | null = null
const getNoise = (c: AudioContext) => {
  if (noiseBuffer) return noiseBuffer
  const samples = c.sampleRate * 0.5
  noiseBuffer = c.createBuffer(1, samples, c.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1
  return noiseBuffer
}

// ~25 Hz: past that the ear smears the clicks into a buzz.
const TICK_MIN_GAP_SEC = 0.04
const MAX_QUEUE_AHEAD_SEC = 0.04
let nextTickTime = 0

type PendingTick = { when: number; osc: OscillatorNode; noise: AudioBufferSourceNode }
let pending: PendingTick[] = []

const scheduleOneTick = (c: AudioContext, when: number) => {
  const master = c.createGain()
  master.gain.value = TICK_VOLUME
  master.connect(c.destination)

  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = TICK_FREQ
  const oscEnv = c.createGain()
  oscEnv.gain.setValueAtTime(1, when)
  oscEnv.gain.exponentialRampToValueAtTime(0.0005, when + TICK_DECAY_SEC)
  osc.connect(oscEnv).connect(master)
  osc.start(when)
  osc.stop(when + TICK_DECAY_SEC + 0.02)

  const noise = c.createBufferSource()
  noise.buffer = getNoise(c)
  const nGain = c.createGain()
  nGain.gain.setValueAtTime(NOISE_LEVEL, when)
  nGain.gain.exponentialRampToValueAtTime(0.0005, when + NOISE_DURATION_SEC)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = TICK_FREQ
  filter.Q.value = NOISE_Q
  noise.connect(nGain).connect(filter).connect(master)
  noise.start(when)
  noise.stop(when + NOISE_DURATION_SEC + 0.01)

  pending.push({ when, osc, noise })
}

/** One already sounding keeps its decay; cutting it reads as a glitch. */
export const cancelPendingTicks = () => {
  if (!ctx) return
  const now = ctx.currentTime
  for (const p of pending) {
    if (p.when > now) {
      try {
        p.osc.stop()
      } catch {}
      try {
        p.noise.stop()
      } catch {}
    }
  }
  pending = []
  nextTickTime = now
}

export const playTick = () => {
  try {
    const c = audio()
    const now = c.currentTime
    const when = Math.max(now, nextTickTime)
    if (when - now > MAX_QUEUE_AHEAD_SEC) return
    scheduleOneTick(c, when)
    nextTickTime = when + TICK_MIN_GAP_SEC
  } catch {}
}
