# Equinox Plank Ledger

An interactive dashboard for our plank support group: fall equinox (Sept 22, 2026) to spring equinox (Mar 20, 2027), 180 seconds a day.

**In the black / in the red:** each planker's balance is total seconds planked minus 180 × days elapsed. At or above zero is in the black. Below zero is in the red and is shown in accounting parentheses, like `(1,835)`.

## What's on the page

- **Replay slider:** rewind the books to any day, or press Replay to watch the whole challenge play out. Every view follows the selected day.
- **Everyone's ledger:** each person's balance and current streak, alphabetical by default. Sort by balance to see the line between black and red. Click a name to follow that person everywhere.
- **Balances over time:** everyone's running balance, total against the pace line, or recent rhythm (7-day average). Lines turn red below the line.
- **Daily books:** a heatmap of every planker × every day.
- **Group volume, When we plank, Weekly statements, Your account** (with a finish-line projection), **Shout-outs**, and **Chatter**.

## Data

`app.js` first tries to read the Google Sheet live (tab `Form Responses 1`) through the public `gviz` CSV endpoint. That only works if the sheet is shared as **Anyone with the link → Viewer**. If it isn't, the page falls back to the snapshot in `data/planks.csv`.

To refresh the snapshot by hand, open the sheet's `Form Responses 1` tab, choose **File → Download → CSV**, and replace `data/planks.csv` with it. Keep the header row.

Add `?data=snapshot` to the URL to force the snapshot.

### Cleaning rules

- The plank date is "What day did you plank?" when it's filled in. Otherwise it's the submission date.
- A date after the submission date is booked on the submission day, since you can't plank in the future.
- Typo years like `0026` are read as `2026`.
- Planks before Sept 22 are booked on day 1.

Totals match the sheet's Leaderboard tab.

## Settings

The challenge start, length, daily minimum and sheet ID are in the `CFG` block at the top of `app.js`.

## GitHub Pages

Settings → Pages → Deploy from branch → `main` / root. The dashboard is then at `https://pahbs.github.io/misc/workouts/plank/`.
