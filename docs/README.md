# Documentation

Scritto rolls text in place: give an element a new value and the characters that
changed slide to what they became while the rest hold still. These pages are the
long version — what the matcher keeps and why, what SwiftUI does with the same
problem, and what sixty-five real value changes actually did when we measured
them.

Start with [how the roll works](how-it-works.md) if you want the algorithm, or
[the measured cases](cases.md) if you would rather see it behave first.

- [How the roll works](how-it-works.md) — the algorithm end to end: what gets
  kept, how it moves, and why the box behaves the way it does
- [What SwiftUI does](what-apple-does.md) — the Apple study, and the two places
  we deliberately differ
- [Measured cases](cases.md) — sixty-five value changes, each with what it kept
  and how far that travelled
- [Timing](timing.md) — the spring, the stagger, and what a duration buys you
- [Flow](flow.md) — the words beside the value, and how they move with it
- [Edges](masking.md) — how leaving ink is dissolved at a moving edge, and the
  rules that keep a fade from turning into a cut
- [API](api.md) — elements, options, events, framework packages
- [Testing](testing.md) — three harnesses and a studio
