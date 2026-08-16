import '@scritto/core/ssr.css'

export { default } from './NumericText'
export type * from '@scritto/core'

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'numeric-text': JSX.HTMLAttributes<HTMLElement>
    }
  }
}
