# Deployment

Two ways to run Sea Trader:

- **A. All-in-one (recommended).** One container serves the API, the WebSockets and the web app. You run it
  with Docker Compose or as a Portainer stack.
- **B. Split.** The web app is served from GitHub Pages and talks to the same server container running elsewhere.

Either way you need the server container, Postgres, and HTTPS in front (see [reverse-proxy.md](reverse-proxy.md)).

## Environment variables

| Variable                                 | Default                                        | Purpose                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | `postgres://postgres@localhost:5432/seatrader` | Postgres connection. The stack files build it from `POSTGRES_*`.                                                                |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`      | –                                              | Creates (or promotes) this admin account on start.                                                                              |
| `PUBLIC_URL`                             | `http://localhost:5173`                        | Public URL of the web app. Used in push notification links and allowed for CORS.                                                |
| `CORS_ORIGINS`                           | –                                              | Extra comma-separated browser origins allowed to call the server (for example your GitHub Pages origin). `*` allows any origin. |
| `TRUST_PROXY`                            | –                                              | Set to `1` behind a reverse proxy.                                                                                              |
| `SERVE_WEB`                              | `true`                                         | Serve the bundled web app. Set to `false` for an API-only server.                                                               |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated                                      | Web Push keys. If you leave them empty, a pair is generated once and stored in the database. `npm run vapid` prints a new pair. |
| `VAPID_SUBJECT`                          | `mailto:admin@example.com`                     | Contact address for push services.                                                                                              |
| `OPEN_REGISTRATION`                      | `false`                                        | Allow sign-up without an invite code.                                                                                           |
| `TICK_MS`                                | `5000`                                         | Real-time interval between game clock ticks.                                                                                    |
| `SESSION_DAYS`                           | `180`                                          | Lifetime of browser logins. API tokens don't expire; revoke them in Settings.                                                   |
| `PORT`                                   | `2567`                                         | Listen port.                                                                                                                    |

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

The workflow `.github/workflows/pages.yml` builds the web app and publishes it to Pages.

1. Deploy the server as in A (it can keep serving its own copy of the web app).
2. In GitHub → **Settings → Pages**, set _Source_ to **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**:
   - `SEA_TRADER_SERVER_URL` = `https://seatrader.example.com` (required)
   - `PAGES_CNAME` = `play.example.com` (optional custom domain; the app is then built for `/` instead of `/sea-trader/`)
4. On the server, allow the Pages origin: `CORS_ORIGINS=https://ulfendk.github.io` (or your custom domain).
5. Push to `main` or run the workflow manually.

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
