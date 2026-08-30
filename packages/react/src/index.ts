import '@scritto/core/ssr.css';

export { default } from './Scritto';
export type * from '@scritto/core';

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        'scritto-text': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      }
    }
  }
}
