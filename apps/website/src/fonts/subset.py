#!/usr/bin/env python3
"""Rebuild the committed Inter subsets next to this file.

Needs fonttools and brotli; produced with pyftsubset 4.62.1
at /opt/homebrew/bin/pyftsubset.

  # keep the full wght axis (100–900). Pinning it to the inherited italic
  # weights changes how instances inside that range resolve, so the glyphs
  # no longer match fontsource's original italic face.
  pyftsubset inter-latin-wght-italic.woff2 \
    --unicodes=U+0020-007E \
    --layout-features='*' \
    --flavor=woff2 \
    --output-file=inter-latin-italic.woff2

  pyftsubset inter-latin-ext-wght-normal.woff2 \
    --unicodes=U+02C8 \
    --layout-features='*' \
    --flavor=woff2 \
    --output-file=inter-stress.woff2

Italic is a closed Basic Latin corpus; roman is left on fontsource's full
latin file. U+02C8 is hosted alone so latin-ext is never requested.
"""

from pathlib import Path
from shutil import which
from subprocess import check_call

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / 'node_modules' / '@fontsource-variable' / 'inter' / 'files'
OUT = Path(__file__).resolve().parent
PYFTSUBSET = which('pyftsubset') or '/opt/homebrew/bin/pyftsubset'


def subset(src: Path, dest: Path, unicodes: str, features: str) -> None:
  check_call(
    [
      PYFTSUBSET,
      str(src),
      f'--unicodes={unicodes}',
      f'--layout-features={features}',
      '--flavor=woff2',
      f'--output-file={dest}',
    ]
  )


def main() -> None:
  subset(
    PACKAGE / 'inter-latin-wght-italic.woff2',
    OUT / 'inter-latin-italic.woff2',
    'U+0020-007E',
    'kern,liga,calt',
  )

  subset(
    PACKAGE / 'inter-latin-ext-wght-normal.woff2',
    OUT / 'inter-stress.woff2',
    'U+02C8',
    '*',
  )


if __name__ == '__main__':
  main()
