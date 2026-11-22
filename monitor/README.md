# Site monitor

A private dashboard of unique visitors to my GitHub Pages sites, read from [GoatCounter](https://pahbs.goatcounter.com).

The page itself is public, like everything on GitHub Pages, but it shows nothing until you paste a GoatCounter API key. The key is stored only in that browser's localStorage and is sent only to `pahbs.goatcounter.com`. Use **Forget key** to remove it.

## Tracking a new page

Add this line just before `</body>`:

```html
<script data-goatcounter="https://pahbs.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
```

## Not counting yourself

Tick **Don't count my visits on this browser** on the monitor page. It sets GoatCounter's `skipgc` flag for `pahbs.github.io`. Do it once on each device you use.
