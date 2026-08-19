# Flow: the words around the value

A `<scritto-text>` on its own animates its own box, and whatever follows it in
the line moves when the browser reflows the line — which is to say, instantly.
Wrapping the line in `<scritto-flow>` makes the neighbours move on the same
clock as the roll.

```html
<scritto-flow>
  You have <scritto-text id="n"></scritto-text> unread messages.
</scritto-flow>
```

## Words become elements

On connect, the flow walks its text nodes and wraps every run of non-whitespace
in an inline-block span. Those spans are what it animates; the whitespace stays
as text so the line still breaks normally.

A lone token counts. The full stop after a value is its own word, and if it is
left as bare text it jumps to its new place in a single frame while every word
around it slides — a 7px teleport on a homepage counter, which is exactly the
kind of thing nobody can name but everybody sees.

The list of words is captured once, at connect. Anything that replaces a word's
element afterwards — writing `textContent` over a container, for instance —
leaves the flow animating a node that is no longer on the page. Write into the
word, not over it.

## Two reads, one clock

The flow measures every visible word before the change and again after, in
flow-relative coordinates rather than viewport ones. The two reads straddle a
layout change, and a scroll in between would look like every word on the page
changing line at once.

Only the visible slice is measured. A long article with a counter in the third
paragraph does not pay for the words below the fold.

## A word that keeps its line slides along it

That is the easy case: measure the two positions, animate the difference.

## A word that changes line hands off

Flying a word diagonally from the end of one line to the start of the next drags
the reader's eye through unrelated text. Instead the word is handed off between
two ghosts: one carries on past the end of the line it left, the other arrives
from before the start of the line it joined. Both are dissolved by a mask on the
flow's edges, so the word reads as going around the corner rather than across
the paragraph.

Words that wrap together travel as a group, sharing one shift per line — the
width of everything joining or leaving that line. A word sliding out by its own
width alone would still be on the line when it finished fading.

## The gutters

The edge mask lives in the gutters past the text, not on the content box. One
rem of fade is exactly a 16px stage padding; more than that and the card clips
it.

## Ghosts and interruption

A word mid-handoff is `visibility: hidden` at its destination while two ghosts
draw it elsewhere. That gap between where a word's box is and where the reader
sees it is real — measured at 30–34px — and an interruption that re-measures the
box restarts the slide from a place nothing was drawn.

That is a known rough edge. It settles correctly and leaves nothing behind; it
just looks wrong for a few frames if you interrupt a wrap mid-flight.
