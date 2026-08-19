/**
 * Rasterises a live `<scritto-text>` over nothing, at any scale.
 *
 * The browser is the only thing that knows what the roll looks like right now,
 * so the host is flattened — shadow tree and all — into plain markup carrying
 * its own computed style, handed to an `<svg><foreignObject>` and drawn to a
 * canvas. An SVG image cannot fetch anything, so the page's font travels with
 * it as base64; emoji come from the system font, which is already there.
 */

const PROPS = [
  'align-items',
  'align-self',
  'background-color',
  'border-radius',
  'bottom',
  'box-sizing',
  'color',
  'direction',
  'display',
  'filter',
  'flex',
  'flex-direction',
  'font-kerning',
  'font-optical-sizing',
  'font-family',
  'font-feature-settings',
  'font-size',
  'font-style',
  'font-variant-numeric',
  'font-variation-settings',
  'font-weight',
  'gap',
  'height',
  'inset-inline-end',
  'inset-inline-start',
  'isolation',
  'justify-content',
  'left',
  'letter-spacing',
  'line-height',
  'margin',
  'mask-clip',
  'mask-composite',
  'mask-image',
  'mask-mode',
  'mask-origin',
  'mask-position',
  'mask-repeat',
  'mask-size',
  'mix-blend-mode',
  'opacity',
  'overflow',
  'padding',
  'pointer-events',
  'position',
  'right',
  'rotate',
  'scale',
  'text-align',
  'text-indent',
  'text-shadow',
  'text-transform',
  'top',
  'transform',
  'transform-origin',
  'translate',
  'vertical-align',
  'white-space',
  'width',
  'will-change',
  'writing-mode',
  'z-index',
]

const styleOf = (el: Element) => {
  const css = getComputedStyle(el)
  let out = ''
  for (const prop of PROPS) {
    const value = css.getPropertyValue(prop)
    if (value && value !== 'none' && value !== 'normal' && value !== 'auto') out += `${prop}:${value};`
  }
  return out
}

/** Pseudo-elements do not clone, and the roll leans on one to hold its baseline. */
const pseudo = (el: Element, where: '::before' | '::after') => {
  const css = getComputedStyle(el, where)
  const content = css.content
  if (!content || content === 'none' || content === 'normal') return null
  const span = document.createElement('span')
  span.setAttribute('style', `display:${css.display};`)
  span.textContent = content.replace(/^["']|["']$/g, '')
  return span
}

const flatten = (el: Element): Element => {
  const shadow = el instanceof HTMLElement ? el.shadowRoot : null
  const out = document.createElement(shadow ? 'div' : el.tagName.includes('-') ? 'span' : el.tagName)
  out.setAttribute('style', styleOf(el))
  const before = pseudo(el, '::before')
  if (before) out.append(before)
  const children = [...(shadow ?? el).children]
  if (!children.length && !before) {
    out.textContent = (shadow ?? el).textContent ?? ''
    return out
  }
  for (const child of children) out.append(flatten(child))
  const after = pseudo(el, '::after')
  if (after) out.append(after)
  return out
}

let embedded: Promise<string> | null = null

/** Every same-origin face the page loaded, inlined so the SVG can use them. */
const fontCss = () => {
  embedded ??= (async () => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules]
      } catch {
        return []
      }
    })
    const faces = rules.filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
    const wanted = faces.filter((face) => /latin/.test(face.style.getPropertyValue('src')))
    const parts = await Promise.all(
      wanted.map(async (face) => {
        const src = face.style.getPropertyValue('src')
        const url = /url\(["']?([^"')]+)["']?\)/.exec(src)?.[1]
        if (!url) return ''
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        const descriptors = ['font-family', 'font-style', 'font-weight', 'font-display', 'unicode-range']
          .map((prop) => {
            const value = face.style.getPropertyValue(prop)
            return value ? `${prop}:${value};` : ''
          })
          .join('')
        return `@font-face{${descriptors}src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2')}`
      }),
    )
    return parts.join('')
  })()
  return embedded
}

const load = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })

/**
 * `extra` is CSS the SVG needs and the page cannot supply, such as an
 * `@font-face` for an uploaded font. The clone forces itself visible so the
 * caller can hide the live host while driving it; hidden still has layout.
 */
export const captureHost = async (host: HTMLElement, scale: number, pad: number, extra = '') => {
  const box = host.getBoundingClientRect()
  const width = Math.max(1, Math.round((box.width + pad * 2) * scale))
  const height = Math.max(1, Math.round((box.height + pad * 2) * scale))

  const body = flatten(host)
  body.setAttribute(
    'style',
    `${body.getAttribute('style') ?? ''}position:absolute;left:${pad}px;top:${pad}px;visibility:visible;opacity:1;`,
  )

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${box.width + pad * 2} ${box.height + pad * 2}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${box.width + pad * 2}px;height:${box.height + pad * 2}px">` +
    `<style>${await fontCss()}${extra}</style>${new XMLSerializer().serializeToString(body)}` +
    `</div></foreignObject></svg>`

  const img = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (img && ctx) ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

export const download = (canvas: HTMLCanvasElement, name: string) => {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    // Revoking in the same task can beat the browser to reading it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, 'image/png')
}
