# Deployment

Two ways to run Sea Trader:

- **A. All-in-one (recommended).** One container serves the API, the WebSockets and the web app. You run it
  with Docker Compose or as a Portainer stack.
- **B. Split.** The web app is served from GitHub Pages and talks to the same server container running elsewhere.

Either way you need the server container, Postgres, and HTTPS in front (see [reverse-proxy.md](reverse-proxy.md)).

## Environment variables

| Variable                                 | Default                                        | Purpose                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                           | `postgres://postgres@localhost:5432/seatrader` | Postgres connection. The stack files build it from `POSTGRES_*`.                                                                           |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`      | –                                              | Creates (or promotes) this admin account on start.                                                                                         |
| `PUBLIC_URL`                             | `http://localhost:5173`                        | Public URL of the web app. Used in push notification links and allowed for CORS.                                                           |
| `CORS_ORIGINS`                           | –                                              | Extra comma-separated browser origins allowed to call the server (for example your GitHub Pages origin). `*` allows any origin.            |
| `TRUST_PROXY`                            | –                                              | Set to `1` behind a reverse proxy.                                                                                                         |
| `SERVE_WEB`                              | `true`                                         | Serve the bundled web app. Set to `false` for an API-only server.                                                                          |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated                                      | Web Push keys. If you leave them empty, a pair is generated once and stored in the database. `npm run vapid` prints a new pair.            |
| `VAPID_SUBJECT`                          | `mailto:admin@example.com`                     | Contact address for push services.                                                                                                         |
| `OPEN_REGISTRATION`                      | `false`                                        | Allow sign-up without an invite code.                                                                                                      |
| `TICK_MS`                                | `5000`                                         | Real-time interval between game clock ticks.                                                                                               |
| `SESSION_DAYS`                           | `180`                                          | Lifetime of browser logins. API tokens don't expire; revoke them in Settings.                                                              |
| `PORT`                                   | `2567`                                         | Listen port.                                                                                                                               |
| `EIA_API_KEY`                            | –                                              | Free key from [EIA open data](https://www.eia.gov/opendata/) for the daily Brent crude price. Without it, games use simulated fuel prices. |
| `FEEDS_ENABLED`                          | `true`                                         | Fetch live data: severe storms from [GDACS](https://www.gdacs.org/) (no key) and the Brent price.                                          |

## A. Docker Compose

```sh
cp .env.example .env    # set ADMIN_PASSWORD, POSTGRES_PASSWORD, PUBLIC_URL
docker compose up -d --build
```

Open `http://localhost:2567` and sign in as the admin.

## A. Portainer

Every push to `main` publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to
`ghcr.io/ulfendk/sea-trader:latest`. Version tags `vX.Y.Z` also publish `X.Y.Z` and `X.Y`.
If the package is private, make it public in GitHub (Packages → sea-trader → Package settings), or add a
GHCR registry with a personal access token (`read:packages`) under Portainer → Registries.

1. Portainer → **Stacks → Add stack**.
2. Either paste [`deploy/portainer-stack.yml`](../deploy/portainer-stack.yml) into the **Web editor**, or pick
   **Repository**: URL `https://github.com/ulfendk/sea-trader`, compose path `deploy/portainer-stack.yml`.
   You can enable GitOps updates to redeploy when the file changes.
3. Under **Environment variables** add at least:
   - `ADMIN_PASSWORD`: your admin password
   - `POSTGRES_PASSWORD`: a long random string
   - `PUBLIC_URL`: `https://seatrader.example.com`
   - optionally `APP_PORT` (host port, default `2567`), `CORS_ORIGINS`, `SEA_TRADER_IMAGE` (pin a version)
4. **Deploy the stack**, then point your reverse proxy at the host port or at `app:2567`.

**Updates.** In the stack, use **Pull and redeploy**. To automate this, create a stack webhook
(Stack → _Create a Stack webhook_) and save its URL as the repository secret `PORTAINER_WEBHOOK_URL`. The
Docker workflow calls it after each push to `main`.

**Traefik users** can use [`deploy/portainer-stack.traefik.yml`](../deploy/portainer-stack.traefik.yml) instead.

**Backups.** All game state is in the Postgres volume:

```sh
docker exec <db-container> pg_dump -U seatrader seatrader > seatrader-$(date +%F).sql
```

## B. Web client on GitHub Pages

The workflow `.github/workflows/pages.yml` builds the web app and publishes it to Pages. It only runs when started manually.

1. Deploy the server as in A (it can keep serving its own copy of the web app).
2. In GitHub → **Settings → Pages**, set _Source_ to **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**:
   - `SEA_TRADER_SERVER_URL` = `https://seatrader.example.com` (required)
   - `PAGES_CNAME` = `play.example.com` (optional custom domain; the app is then built for `/` instead of `/sea-trader/`)
4. On the server, allow the Pages origin: `CORS_ORIGINS=https://ulfendk.github.io` (or your custom domain).
5. Run the **GitHub Pages** workflow manually from the Actions tab (it does not run on push).

Notes:

- Logins use bearer tokens stored in the browser, not cookies, so cross-origin works without third-party cookies.
- Deep links such as `/sea-trader/game/<id>` work because the build also writes `404.html`.
- Web Push works from Pages as well. Notification links point to `PUBLIC_URL`, so set it to the address
  players actually use.

## Local development

```sh
npm install
# Postgres: docker run -d -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=seatrader postgres:16-alpine
ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass123 npm run dev
```

The API runs on `:2567` and the Vite dev server on `:5173`. Tests need a database called `seatrader_test`,
or set `TEST_DATABASE_URL`:

```sh
npm test
```

To try things quickly, create a game in the admin panel with a large time scale, for example `1440`
(one game day per real minute), or use **Skip days**.

## Modern map

Players can switch the world map to a modern street map in Settings (stored per device). It uses
[MapLibre GL](https://maplibre.org/) with the free [OpenFreeMap](https://openfreemap.org/) style, so there is
nothing to configure and no API key. Players' browsers then load map data from `tiles.openfreemap.org`; if that
host is unreachable the game falls back to the pixel map.

## Real weather and fuel prices

Each game has two switches (Admin → game → Settings; on by default for new games):

- **Real weather.** The server checks [GDACS](https://www.gdacs.org/) tropical cyclone alerts every 30 minutes.
  Only severe ones (orange and red alerts) are used. They appear on both maps, and a ship that sails into one
  stops and asks its owner to sail through (damage and delay) or go around (extra days). Random storms become
  rarer while real weather is on.
- **Real fuel prices.** With `EIA_API_KEY` set, the server fetches the daily Brent crude price every 6 hours and
  bunker prices follow it: at $75/bbl they are at their normal level, at $90 they are 20% higher.

The admin panel's **Live data** box shows the current storms, the Brent price, when each was last updated and any
errors. If a feed is unreachable, games keep their last data or fall back to simulation.

New storms, storms that strengthen or pass, and Brent moves of 5% or more are posted to each game's news.

## Conflict zones

There is no reliable open feed for maritime war-risk areas, so the admin keeps the list in **Admin → Conflict
zones** (it starts from a built-in list based on UKMTO/JMIC advisories: the Red Sea and Gulf of Aden, the Black
Sea, the Strait of Hormuz, the Gulf of Guinea and the Somali Basin). Each zone has a position (click the map),
radius, level (elevated, high, war) and the extra days a ship needs to avoid it. Zones are stored in the database
and apply to every game with **Conflict zones** switched on (the default for new games). A ship entering one can
pay war-risk cover (0.1%, 0.35% or 1% of its value) and sail through with a 2%, 6% or 15% chance of being
attacked, or avoid it. Adding, changing or removing a zone is announced in each game's news.
