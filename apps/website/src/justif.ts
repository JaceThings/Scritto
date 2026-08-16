import { justify } from 'justif'
import { hyphenateEnUS } from 'justif/hyphenate/en-us'

export const bindJustif = (root: ParentNode = document) => {
  const paragraphs = [...root.querySelectorAll<HTMLElement>('p.text-justify')].filter(
    (p) => !p.closest('scritto-flow') && !p.querySelector('scritto-flow, scritto-text'),
  )
  if (!paragraphs.length) return
  return justify(paragraphs, { hyphenate: hyphenateEnUS })
}
