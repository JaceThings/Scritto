import { DEFAULTS, build, toSvg, type Mark } from '../lib/slab'

const find = <T extends HTMLElement>(role: string) => document.querySelector<T>(`[data-role="${role}"]`)!

const mark: Mark = structuredClone(DEFAULTS)

/** `a.turn` reads and writes the nested slab; anything else is a field of the mark. */
const read = (key: string): number | string => {
  const [head, tail] = key.split('.')
  const slot = mark[head as keyof Mark]
  return tail ? (slot as Record<string, number>)[tail] : (slot as number | string)
}

const write = (key: string, value: number | string) => {
  const [head, tail] = key.split('.')
  if (tail) (mark[head as keyof Mark] as Record<string, number>)[tail] = value as number
  else (mark as Record<string, unknown>)[head] = value
}

const PRESETS: { name: string; of: Partial<Mark> }[] = [
  { name: 'tipped', of: { b: { turn: 0, tilt: 28, roll: 0 } } },
  { name: 'nudged', of: { b: { turn: 0, tilt: 14, roll: 0 } } },
  { name: 'quarter', of: { b: { turn: 0, tilt: 45, roll: 0 } } },
  { name: 'over', of: { b: { turn: 0, tilt: 64, roll: 0 } } },
  { name: 'back', of: { b: { turn: 0, tilt: -34, roll: 0 } } },
  { name: 'both ways', of: { a: { turn: 0, tilt: -14, roll: 0 }, b: { turn: 0, tilt: 30, roll: 0 } } },
  { name: 'turned', of: { b: { turn: 34, tilt: 22, roll: 0 } } },
  { name: 'leaning', of: { a: { turn: 0, tilt: 0, roll: -7 }, b: { turn: 0, tilt: 28, roll: -7 } } },
  { name: 'wide lens', of: { camera: 300, b: { turn: 0, tilt: 30, roll: 0 } } },
  { name: 'long lens', of: { camera: 2800, b: { turn: 0, tilt: 30, roll: 0 } } },
  { name: 'slim', of: { depth: 10, gap: 42, b: { turn: 0, tilt: 28, roll: 0 } } },
  { name: 'heavy', of: { depth: 42, gap: 80, b: { turn: 0, tilt: 28, roll: 0 } } },
  { name: 'tight', of: { gap: 14, b: { turn: 0, tilt: 28, roll: 0 } } },
  { name: 'one camera', of: { focus: 'shared', b: { turn: 0, tilt: 28, roll: 0 } } },
  { name: 'drawn', of: { mode: 'outline', weight: 5, b: { turn: 0, tilt: 30, roll: 0 } } },
  { name: 'inked', of: { mode: 'both', weight: 3, shade: 0.55, b: { turn: 0, tilt: 30, roll: 0 } } },
]

const art = find('art')
const dims = find('dims')
const scale = find<HTMLInputElement>('scale')
const mirror = find<HTMLInputElement>('mirror')
const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')]

const show = () => {
  if (mirror.checked) mark.b = { turn: -mark.a.turn, tilt: -mark.a.tilt, roll: -mark.a.roll }
  art.innerHTML = toSvg(mark)
  const { box } = build(mark)
  const k = Number(scale.value)
  dims.textContent = `${Math.round(box.width)} × ${Math.round(box.height)} · PNG ${Math.round(box.width * k)} × ${Math.round(box.height * k)}`
  for (const input of inputs) {
    const key = input.dataset.key!
    const value = read(key)
    if (input.value !== String(value)) input.value = String(value)
    const out = document.querySelector(`[data-out="${key}"]`)
    if (out) out.textContent = typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value)
  }
  const out = document.querySelector('[data-out="scale"]')
  if (out) out.textContent = `${k}×`
}

for (const input of inputs) {
  input.addEventListener('input', () => {
    const key = input.dataset.key!
    write(key, input.type === 'range' ? Number(input.value) : input.value)
    show()
  })
}

scale.addEventListener('input', show)
mirror.addEventListener('change', show)

const apply = (of: Partial<Mark>) => {
  Object.assign(mark, structuredClone(DEFAULTS), structuredClone(of))
  mirror.checked = false
  show()
}

const presets = find('presets')
for (const preset of PRESETS) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'studio-preset'
  const shot = { ...structuredClone(DEFAULTS), ...structuredClone(preset.of), pad: 16 }
  button.innerHTML = `${toSvg(shot, preset.name)}<span>${preset.name}</span>`
  button.addEventListener('click', () => apply(preset.of))
  presets.append(button)
}

const between = (lo: number, hi: number, step = 1) => Math.round((lo + Math.random() * (hi - lo)) / step) * step

find('shuffle').addEventListener('click', () => {
  apply({
    depth: between(8, 46),
    gap: between(14, 120),
    camera: between(240, 2400, 10),
    a: { turn: 0, tilt: between(-10, 10), roll: 0 },
    b: { turn: between(-12, 12), tilt: between(-45, 62), roll: 0 },
  })
})

find('reset').addEventListener('click', () => apply({}))

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  URL.revokeObjectURL(url)
}

find('svg').addEventListener('click', () => {
  save(new Blob([toSvg(mark)], { type: 'image/svg+xml' }), 'scritto-mark.svg')
})

find('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(toSvg(mark))
  const button = find('copy')
  button.textContent = 'Copied'
  setTimeout(() => (button.textContent = 'Copy SVG'), 1200)
})

find('png').addEventListener('click', async () => {
  const { box } = build(mark)
  const k = Number(scale.value)
  const url = URL.createObjectURL(new Blob([toSvg(mark)], { type: 'image/svg+xml' }))
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(box.width * k)
  canvas.height = Math.round(box.height * k)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  if (blob) save(blob, `scritto-mark@${k}x.png`)
})

show()
