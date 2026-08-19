# numeric-text (vendored)

Unmodified copy of `packages/core/src` from
[shizukushq/numeric-text](https://github.com/shizukushq/numeric-text) at
`bea3fc5` (2026-03-27), the upstream this repo forked. MIT, same copyright
holder as this repo's own LICENSE.

It is here so `/versus` can run both engines on one page and one timer. Nothing
else imports it, and it ships only on that page. It registers `<numeric-text>`,
so it does not collide with our `<scritto-text>`.

Do not fix anything in here. Its whole value is being exactly what upstream
does; refresh it with

    git show upstream/main:packages/core/src/index.ts > index.ts
