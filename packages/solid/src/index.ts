import '@scritto/core/ssr.css'

export { default } from './Scritto'
export type * from '@scritto/core'

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'scritto-text': JSX.HTMLAttributes<HTMLElement>
    }
  }
}
