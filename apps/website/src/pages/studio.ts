import { DEFAULTS, build, matchScale, slab, toSvg, type Mark } from '../lib/slab'

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
  { name: 'tipped', of: { b: slab(0, 28) } },
  { name: 'nudged', of: { b: slab(0, 14) } },
  { name: 'quarter', of: { b: slab(0, 45) } },
  { name: 'over', of: { b: slab(0, 64) } },
  { name: 'back', of: { b: slab(0, -34) } },
  { name: 'matched', of: { b: slab(0, 34, 0, 0.78) } },
  { name: 'both ways', of: { a: slab(0, -14), b: slab(0, 30) } },
  { name: 'turned', of: { b: slab(34, 22) } },
  { name: 'leaning', of: { a: slab(0, 0, -7), b: slab(0, 28, -7) } },
  { name: 'wide lens', of: { camera: 300, b: slab(0, 30) } },
  { name: 'long lens', of: { camera: 2800, b: slab(0, 30) } },
  { name: 'slim', of: { depth: 10, gap: 42, b: slab(0, 28) } },
  { name: 'heavy', of: { depth: 42, gap: 80, b: slab(0, 28) } },
  { name: 'tight', of: { gap: 14, b: slab(0, 28) } },
  { name: 'one camera', of: { focus: 'shared', b: slab(0, 28) } },
  { name: 'drawn', of: { mode: 'outline', weight: 5, b: slab(0, 30) } },
  { name: 'inked', of: { mode: 'both', weight: 3, shade: 0.55, b: slab(0, 30) } },
]

const art = find('art')
const dims = find('dims')
const scale = find<HTMLInputElement>('scale')
const mirror = find<HTMLInputElement>('mirror')
const match = find<HTMLSelectElement>('match')
const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')]

const show = () => {
  if (mirror.checked) mark.b = { ...mark.b, turn: -mark.a.turn, tilt: -mark.a.tilt, roll: -mark.a.roll }
  if (match.value === 'height' || match.value === 'width') {
    mark.b.scale = matchScale(mark, mark.b, mark.a, match.value)
  }
  // Height first, then the edge on its own: one factor cannot hold both, since a
  // slab scaled down to the same height draws a thinner bar than the one beside it.
  if (match.value === 'both') {
    mark.b.scale = matchScale(mark, mark.b, mark.a, 'height')
    mark.b.thick = matchScale(mark, mark.b, mark.a, 'width', 'thick')
  }
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
match.addEventListener('change', show)

const apply = (of: Partial<Mark>) => {
  Object.assign(mark, structuredClone(DEFAULTS), structuredClone(of))
  mirror.checked = false
  match.value = 'off'
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
    a: slab(0, between(-10, 10)),
    b: slab(between(-12, 12), between(-45, 62)),
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
