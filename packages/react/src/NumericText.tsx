'use client';

import '@scritto/core';
import { type NumericTextProps, type NumericText as NumericTextElement, BROWSER } from '@scritto/core';
import { type HTMLAttributes, useLayoutEffect, useRef } from 'react';

type Props = NumericTextProps & HTMLAttributes<HTMLElement>;
const NumericText = ({ value, trend, transition, respectMotionPreference, animated = true, ...rest }: Props) => {
  const ref = useRef<NumericTextElement>(null);
  const isMounted = useRef(false);

  useLayoutEffect(() => {
    if (ref.current) ref.current.update(value, isMounted.current && animated);
    if (!isMounted.current) isMounted.current = true;
  }, [value]);

  useLayoutEffect(() => {
    if (ref.current) ref.current.setOptions({ trend, transition, respectMotionPreference });
  }, [trend, transition, respectMotionPreference]);

  return (
    <numeric-text
      ref={ref}
      role="img"
      aria-label={value + ''}
      {...rest}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BROWSER ? '' : value }}
    />
  );
};

export default NumericText;
