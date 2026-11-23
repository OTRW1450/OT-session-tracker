# OT Progress Tracker

A simple occupational therapy progress tracker that works on iPad, phone and computer.
You enter a child's goals, tap to score each goal after a session, and see progress over time.

- **No accounts, no server, no tracking.** Everything is saved in this browser on this device.
- Plain HTML, CSS and JavaScript. No external libraries and no network requests.
- Works offline once opened from a website (see below).

> **Privacy:** Use initials or a nickname for each child, never a full name.

## Open the app

**On a computer:** download or clone this folder and double-click `index.html`.

**On an iPad or iPhone:** Safari can't open a local HTML file well, so put the folder on any
static web host. The host only delivers the app files. Your data never goes to it. The easiest
option is GitHub Pages:

1. In this repository on GitHub, go to **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, then pick the branch and `/ (root)`, and save.
3. After a minute, open the address GitHub shows (for example `https://<user>.github.io/OT-session-tracker/`) in **Safari**.

## Add it to the iPad Home Screen

1. Open the app's web address in **Safari**.
2. Tap the **Share** button (the square with an arrow).
3. Tap **Add to Home Screen**, then **Add**.

It then opens full screen like an app and keeps working without internet.

**Important:** the Home Screen app and Safari keep separate data. Pick one and always use it.
To move data between them, use Backup and Restore.

## Using it

1. **Children:** tap *Children* to add, rename, switch or delete a child. To delete, tap twice.
2. **Goals tab:** add a goal, choose an **area** (or "+ Add a new area") and how to score it:
   - *Progress scale*: No change, Emerging, Developing, Goal met
   - *Level of help needed*: Full assist through Independent
   - *Trials out of attempts*: for example 3 of 5 (60%)
   - *A number*: with a unit (%, minutes, times…) and an optional target

   You can only change the scoring method before the goal has been scored in a session.
   Each goal has **Ideas**: treatment ideas with text, links, and photos or videos.
3. **Score session tab:** check the date, tap a score for each goal you worked on (tap it again to
   unselect), add notes if you want, then tap **Save session**. Unsaved scores are kept as a draft
   even if you close the app.
4. **Progress tab:** shows the latest result and a trend chart for each goal, plus the session
   history, where you can edit or delete a session. **Print / save PDF** makes a clean report.

## Back up your data

Data lives only in this browser. Clearing website data, using private browsing, or losing the
device will erase it. **Back up regularly.** Tap **Backup**:

- **Download backup** saves a `.json` file. On iPad, **Share / Save to Files…** lets you choose where it goes.
- **Backup as text** shows the backup as text you can copy (for example into a private note).
  Use this if downloads are blocked, which can happen in the Home Screen app.
- **Restore** from a backup file, or paste backup text. Restoring **replaces** all data on this device.
  You'll be asked to tap twice to confirm.

**Backups do not include photos and videos.** They stay on the device where you added them.
After restoring on another device, they show as "Not on this device".

## Files

| File | Purpose |
|---|---|
| `index.html` | The page |
| `css/styles.css` | Styles: light and dark mode, print layout |
| `js/logic.js` | Scoring, grouping, charts range, backup checks (no DOM; unit-tested) |
| `js/media.js` | Photo and video storage in IndexedDB (photos resized to about 1280px JPEG; videos up to 200 MB) |
| `js/app.js` | The user interface |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home Screen and offline support |

## Tests

Requires [Node.js](https://nodejs.org) 18 or newer:

```sh
npm test          # unit tests for scoring and grouping logic
npm run test:ui   # optional browser run-through (requires Playwright); saves screenshots to screenshots/
```

The tests use made-up sample goals only. Never put real child data in code or tests.

## Updating the app

When you change the app files, also change `CACHE` in `sw.js` (for example to `ot-tracker-v2`)
so installed copies pick up the new version. Saved data is not affected.
