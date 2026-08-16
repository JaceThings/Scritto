'use client';

import '@scritto/core';
import { type ScrittoProps, type Scritto as ScrittoElement, BROWSER } from '@scritto/core';
import { type HTMLAttributes, useLayoutEffect, useRef } from 'react';

type Props = ScrittoProps & HTMLAttributes<HTMLElement>;
const Scritto = ({ value, trend, transition, respectMotionPreference, bounce, animated = true, ...rest }: Props) => {
  const ref = useRef<ScrittoElement>(null);
  const isMounted = useRef(false);

  useLayoutEffect(() => {
    if (ref.current) ref.current.update(value, isMounted.current && animated);
    if (!isMounted.current) isMounted.current = true;
  }, [value]);

  useLayoutEffect(() => {
    if (ref.current) ref.current.setOptions({ trend, transition, respectMotionPreference, bounce });
  }, [trend, transition, respectMotionPreference, bounce]);

  return (
    <scritto-text
      ref={ref}
      role="img"
      aria-label={value + ''}
      {...rest}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BROWSER ? '' : value }}
    />
  );
};

export default Scritto;
