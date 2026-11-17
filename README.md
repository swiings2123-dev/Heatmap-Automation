# Shopify Heatmaps (self-hosted, local-first)

See where shoppers click and how far they scroll on your **real** Shopify product pages, drawn on a screenshot of that page per device. One `<script>` tag, runs entirely on your machine, no cloud account.

```
 Shopify product page                         your computer (or a server later)
┌──────────────────────┐   batched POST    ┌──────────────────────────────────────────┐
│ <script tracker.js>  │ ───/api/collect──▶│ Fastify server ──▶ Storage interface      │
│  clicks (DOM-anchored)│  (sendBeacon)    │                     └─ SQLite (data/*.db) │
│  scroll 25/50/75/100 │                   │                        (Postgres later)   │
└──────────────────────┘                   │        ▲                                  │
                                           │        │ /api/pages /api/heatmap /api/stats│
 Dashboard (React) ◀───────────────────────┤        │                                  │
  screenshot + canvas heat                 │ Screenshot worker (Playwright/Chromium)   │
                                           │  data/screenshots/<store>/<page>/<device>/│
                                           │     <version>.jpg + <version>.layout.json │
                                           └──────────────────────────────────────────┘
```

## Quick start (5 minutes, zero setup)

Requires Node 20+.

```bash
npm install
npx playwright install chromium     # once: the screenshot browser
npm run dev                         # builds tracker + dashboard, starts http://localhost:3000
```

1. Open the demo product page: <http://localhost:3000/demo/products/demo-product> and click around (add to cart, sizes, the sticky bar after scrolling…).
2. Open the dashboard: <http://localhost:3000>. Pick **Mobile**, click **Capture screenshot**.
3. Want more data? Click **Generate fake data** (dev only) or `curl -X POST localhost:3000/api/seed`.

`npm run demo` does the same as `npm run dev` without file watching.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Build tracker + dashboard, run server (restarts on server code changes) |
| `npm run dev:ui` | Dashboard with hot reload on :5173 (proxies to the running server) |
| `npm start` | Run the server (production: set `NODE_ENV=production` + `DASHBOARD_TOKEN`) |
| `npm run capture -- <url> [--device mobile] [--force]` | Screenshot one page (all devices with traffic by default) |
| `npm run capture:all [-- --force]` | Re-check every known page × device; stores a new version only if the layout changed |
| `npm run watch` | `capture:all` every `CAPTURE_INTERVAL_HOURS` (default 6). Not needed while the server runs with auto-capture on |
| `npm run build` | Typecheck + build tracker (fails if > 4 KB gzipped) + dashboard |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end test (Playwright): demo click → capture → heatmap API |
| `npm run lint` | oxlint |

## How accuracy works

- **Clicks are anchored to the DOM, not page percentages.** For each click the tracker finds the element the shopper meant (`button`, `a`, `label`… even when they tapped an SVG `<path>` inside it), records a stable CSS selector, a label, and *where inside the element* they clicked (0..1).
- **Every screenshot comes with a `layout.json`**: the rect of every selector seen in recent clicks, measured in the same browser session as the screenshot.
- **Resolving**: `x = rect.x + x_in_el × rect.w` (same for y) using the layout of the *same device bucket* (mobile < 768 px ≤ tablet < 1024 px ≤ desktop). Mobile clicks never appear on the desktop screenshot.
- **Fallback**: if a selector isn't in the layout (element removed, A/B test…), the click is placed by its page-relative position. The dashboard shows how many clicks used this fallback ("97% pinned to the exact element").
- **Fixed elements** (sticky add-to-cart bars, chat buttons) don't scroll with the page, so they're drawn in a floating layer that stays at the bottom/top of the dashboard's phone-sized viewport, like on a real phone, with a dashed outline. `position: sticky` elements are drawn where they sit in the page.
- **Shopify theme ids are normalised.** Section ids like `Quantity-template--28679080870169__main` contain a number that changes when a theme is duplicated or published; selectors use `[id^="Quantity-template--"][id$="__main"]` instead, so clicks keep matching after theme changes.
- **Screenshots are automatic.** The first time a page gets traffic on a device, the server screenshots it (once, deduplicated), and every `CAPTURE_INTERVAL_HOURS` it re-checks all pages. Turn off with `AUTO_CAPTURE=false`.
- **Screenshots are versioned.** `capture:all` hashes page height + interactive elements' positions; a theme change creates a new version, old versions stay on disk.

## Testing on your real Shopify store (same computer)

Your store is `https://…` and the collector is `http://localhost:3000`. Chrome allows this from your own computer, with one permission prompt.

1. `npm run dev` and keep it running.
2. Shopify admin → **Online Store → Themes** → on your theme **⋯ → Duplicate**. On the copy: **⋯ → Edit code** → `layout/theme.liquid` → paste right before `</head>`:
   ```html
   <script src="http://localhost:3000/tracker.js" async></script>
   ```
   Save. (The dashboard's **Snippet** tab has a copy button and a **Test connection** button.)
3. On the duplicated theme click **⋯ → Preview**. It opens a new tab. Use that tab: the theme *editor* runs the page inside an iframe that Chrome won't allow to reach localhost.
4. Open a product page in that preview tab. Chrome asks to let the site **access other apps and services on this device / your local network**: click **Allow**. (Missed it? Click the icon left of the address bar → Site settings → *Local network access* → Allow, then reload.)
5. Click around on your phone layout too: DevTools → device toolbar (Ctrl+Shift+M) → reload. Clicks count as mobile when the viewport is < 768 px.
6. In the dashboard (<http://localhost:3000>) your store and product appear within ~3 s. Click **Capture screenshot**.
   - Testing an **unpublished** theme? The screenshot must show that theme too. Capture from a terminal with the preview URL:
     `npm run capture -- "https://yourstore.com/products/your-handle?preview_theme_id=123456789"`
   - **Password-protected store** (development stores): the capture browser sees the password page. Remove the password while testing, or test on a live store.

Check it works: DevTools → Network → filter `collect`. You should see `collect` requests with status 204. Nothing is sent for bots, `navigator.webdriver`, Do-Not-Track or Global Privacy Control browsers.

## Getting real visitor traffic (expose the collector)

Real shoppers can't reach your `localhost`. You need an **https** URL.

**Option A: Cloudflare quick tunnel (free, no account, for a test day)**
```bash
cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
```
Then in `.env`:
```ini
PUBLIC_URL=https://<random>.trycloudflare.com
TRUST_PROXY=true                       # rate-limit by real visitor IP (CF-Connecting-IP)
ALLOWED_ORIGINS=https://www.yourstore.com,https://yourstore.myshopify.com
NODE_ENV=production
DASHBOARD_TOKEN=<long random string>   # e.g. node -e "console.log(crypto.randomUUID())"
```
Restart (`npm start`), update the script tag in your theme to the tunnel URL. The random URL changes each time, so use a named tunnel (free Cloudflare account) or ngrok with a reserved domain for anything longer.

**Option B: deploy** to any small VPS / Fly.io / Render / Railway with a **persistent disk** mounted at `DATA_DIR` (SQLite + screenshots live there). Run `npm ci && npx playwright install --with-deps chromium && npm run build && npm start`, plus `npm run watch` as a second process for screenshots. Put it behind https.

**Option C: hosted Postgres/Supabase**: implement the `Storage` interface (`server/src/storage/types.ts`) in `server/src/storage/postgres.ts` and return it from `createStorage()` when `DATABASE_URL` is set. Routes, worker and dashboard don't change. The SQL in `sqlite.ts` is portable (`json_each` → `json_array_elements_text`).

**Production mode** (`NODE_ENV=production`): every read endpoint and screenshot needs `DASHBOARD_TOKEN` (the dashboard asks for it once); `/api/seed` and the demo page are disabled; `/api/collect` stays public but validated, CORS-restricted and rate-limited.

## Adding a store

Paste the same script tag in the other store's theme. Stores are told apart by hostname automatically; the store picker appears when there's more than one. In production add its origins to `ALLOWED_ORIGINS`.

## Scheduling screenshots

`npm run watch` re-checks every page every `CAPTURE_INTERVAL_HOURS` and only saves a new version when the layout changed. To run it without a terminal open:

- **Windows Task Scheduler**: `schtasks /Create /SC HOURLY /MO 6 /TN "Heatmap capture" /TR "cmd /c cd /d \"C:\path\to\shopify-heatmap\" && npm run capture:all"`
- **macOS/Linux cron**: `0 */6 * * * cd /path/to/shopify-heatmap && npm run capture:all >> data/capture.log 2>&1`
- **GitHub Actions**: only useful once the database is hosted (Option C) or the collector is deployed, since Actions can't see your laptop. Run `npm ci && npx playwright install --with-deps chromium && npm run build:tracker && npm run capture:all` on a `schedule:` cron with `DATABASE_URL` as a secret.

## Configuration (`.env`, see `.env.example`)

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Use `HOST=0.0.0.0` on a server/container |
| `PUBLIC_URL` | `http://localhost:3000` | What the snippet points to |
| `NODE_ENV` | `development` | `production` requires `DASHBOARD_TOKEN` |
| `DASHBOARD_TOKEN` | – | Protects read APIs in production |
| `ALLOWED_ORIGINS` | `*` | Comma-separated store origins allowed to send data |
| `COLLECT_RATE_LIMIT` | `120` | Requests per IP per minute |
| `TRUST_PROXY` | `false` | `true` behind cloudflared / a reverse proxy |
| `DATA_DIR` | `./data` | SQLite DB + screenshots |
| `ATC_LABELS` | `add to cart,buy now,add to bag,buy it now` | Labels counted as add-to-cart (plus `[name=add]`, submit buttons in `/cart/add` forms, `data-heatmap-atc`) |
| `CAPTURE_HIDE_SELECTORS` | – | Extra popups/widgets to hide in screenshots |
| `CAPTURE_DEVICES` | `mobile,desktop` | Tablet is added automatically when it has traffic |
| `CAPTURE_INTERVAL_HOURS` | `6` | Periodic re-check (server auto-capture and `npm run watch`) |
| `AUTO_CAPTURE` | `true` | Screenshot new pages/devices on first traffic + periodic re-check |

Snippet options: `data-endpoint="https://…"` (or `window.HEATMAP_ENDPOINT`), `data-all-pages="true"` (also track non-product pages), `data-heatmap-label="…"` on elements for friendlier names, `window.HEATMAP_OPTOUT = true` to disable (e.g. until cookie consent).

## Stats explained

- **ATC click rate**: sessions with at least one add-to-cart click ÷ sessions on that page/device/range/source.
- **Rage click**: 3+ clicks within 1 s within 40 px. **Dead click**: a click on a non-interactive element after which neither the page structure nor the URL changed within 700 ms.
- **Scroll funnel**: % of sessions that reached 25/50/75/100% of the page.
- **Top elements**: by clicks (with % of visitors who clicked) or by clicks per clicking session (high = repeated tapping).
- Dates are stored in UTC; the dashboard sends your browser's time zone so "Today" and per-day bars use your local midnight.

## Privacy

No input values, no text from form fields, no query strings, referrer stored as hostname only, no cookies (an anonymous id in localStorage). Bots, automation, Do-Not-Track and Global Privacy Control are ignored.

## Troubleshooting

| Symptom | Fix |
|---|---|
| One phone/browser never shows up | Open `<collector-url>/check` on that phone. It says whether Do-Not-Track, Global Privacy Control (Brave, DuckDuckGo) or an ad-blocker/private DNS is stopping the tracker. |
| No `collect` requests on the real store | Check the Network tab: `tracker.js` blocked → allow local network access (step 4) or use the Preview tab, not the theme editor. Is it a `/products/…` page? |
| `ERR_CONNECTION_REFUSED` / blocked to localhost | Server not running, or Chrome's local network permission was denied (site settings → Local network access). Other browsers (Safari/Firefox) may block https→localhost: test in Chrome. |
| Clicks appear but no heatmap | No screenshot for that device yet → **Capture screenshot**. |
| Low "pinned to element" % | The theme changed since the screenshot → **Re-capture** (or `npm run capture:all`). |
| Screenshot shows a popup | Add its CSS selector to `CAPTURE_HIDE_SELECTORS`. |
| Capture fails: "Could not start Chromium" | `npx playwright install chromium` |
| Screenshot is the password page | Store is password-protected; remove the password while testing. |
| 401 in the dashboard | Production mode: enter `DASHBOARD_TOKEN`. |
| `better-sqlite3` install error | It ships prebuilt binaries for Node 20+/win/mac/linux; make sure you use a supported Node LTS (`node -v`). |

## Project layout

```
tracker/src/      tracker.js (index.ts) + layout probe used by the worker; dom.ts is shared by both
server/src/       Fastify app, config, demo page
  storage/        Storage interface + SQLite adapter (swap point for Postgres)
  lib/            validation (zod), point resolving, fake-data seeding
  worker/         Playwright capture, queue, CLI (capture / capture:all / watch)
dashboard/src/    React + Tailwind dashboard (canvas heat renderer in lib/heat.ts)
shared/types.ts   wire format + API types
tests/  e2e/      Vitest unit tests, Playwright end-to-end test
data/             (git-ignored) heatmap.db + screenshots/
```
