# Slack Posts Exporter

Chrome extension (MV3) that scrapes messages from a Slack channel via virtual-list scrolling and exports to CSV.

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.
4. Pin the extension to your toolbar.

## Use

1. Open `app.slack.com` and navigate to a channel.
2. Click the extension icon → **Detect** → **Export Posts**.
3. **Keep the popup open** until export finishes (see [Known issues](#known-issues)).
4. **Download CSV** when prompted. Output: `slack_posts_<channel>_<date>.csv` (Author, Date, Message).

## Repo layout

```
extension/   Chrome extension (load this folder in chrome://extensions)
scripts/     Playwright dev scripts for DOM/selector inspection
.env.example Template — copy to .env, fill SLACK_URL for the dev scripts
```

## Dev scripts

```bash
cp .env.example .env          # set SLACK_URL=https://app.slack.com/client/T.../C...
npm install
node --env-file=.env scripts/test-scroll.mjs           # full extraction smoke test
node --env-file=.env scripts/inspect-posts-dom.mjs     # log selectors / DOM structure
node --env-file=.env scripts/inspect-messages-detail.mjs
```

First run opens a Chromium window; sign in to Slack once. Session is saved to `./playwright-profile/` (gitignored) — subsequent runs reuse it.

## Known issues

- **Popup must stay open during export.** Messages are buffered in the popup's memory (`extension/popup.js`); if you click on Slack to watch progress, Chrome closes the popup and `EXPORT_COMPLETE` is dropped. Long channels truncate silently to whatever count was reached when the popup closed. Fix is to move buffering into the service worker — TODO.
- **Bounce-back protection caps at iteration 3** (`extension/content.js`). On layouts where Slack snaps the scroll position, extraction can stall.
