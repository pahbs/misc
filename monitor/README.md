# Site monitor

A private dashboard of unique visitors to my GitHub Pages sites, using [GoatCounter](https://pahbs.goatcounter.com).

GoatCounter's API doesn't accept requests from web pages, so:

1. `.github/workflows/monitor.yml` runs `fetch_stats.py` every 4 hours, and on demand with **Run workflow**.
2. The script reads the stats with the `GOATCOUNTER_TOKEN` secret. It encrypts them with `MONITOR_PASSPHRASE` (PBKDF2-SHA256 → AES-256-GCM) and commits `data/stats.enc.json`, but only when the numbers changed.
3. `index.html` downloads that file and decrypts it in the browser with the passphrase.

The file in the repo is unreadable without the passphrase. The passphrase is remembered in each browser until you press **Lock**.

## One-time setup

In **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Value |
|---|---|
| `GOATCOUNTER_TOKEN` | GoatCounter API key with **Read statistics** permission |
| `MONITOR_PASSPHRASE` | A passphrase you make up. Use a long one: anyone could try to guess it against the public file. |

Then go to **Actions → Update site monitor → Run workflow**.

## Tracking a new page

Add this line just before `</body>`:

```html
<script data-goatcounter="https://pahbs.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
```

## Not counting yourself

Tick **Don't count my visits on this browser** on the monitor page, once on each device. It sets GoatCounter's `skipgc` flag for `pahbs.github.io`.
