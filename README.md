# ⚓ Sea Trader

A real-time multiplayer shipping game in the spirit of the Amiga classic _Ports of Call_. Every player
runs a shipping company: buy freighters, take charters between 25 world ports, bunker fuel, dodge storms
and pirates, and steer ships into harbour yourself to save the tug fee. Time runs continuously
(1 game day = 1 real day by default), so a voyage takes days and you check in when a ship needs orders.

- **Multiplayer, multi-game.** Run a separate game for each group of friends, all on one server.
- **Any device.** Username and password login; the same account works on desktop, phone (installable PWA)
  and the Omarchy status bar, all at the same time.
- **Notifications.** Web Push to phones and desktops, plus an Omarchy bar widget with desktop notifications.
- **Admin panel.** Create and configure games (time scale, starting cash, deadlines, length), invite
  players with links, and manage users.
- **Pixel look** that nods to the original: bitmap fonts, bevelled windows, and a 1° pixel world map.
- **Modern map option.** Players can switch to a zoomable street map (OpenStreetMap data via OpenFreeMap, no API key) per device, in Settings or from the map's title bar.

## Architecture

```
packages/shared   game rules: sea routing, economy, charters, events, deterministic mini-games (pure TS, tested)
apps/server       Node + Colyseus 0.18 (one room per game) + Express REST + Postgres (Drizzle) + Web Push
apps/web          Preact + Vite PWA: world map, fleet, port office, shipyard, bank, admin panel, mini-games
integrations/omarchy   Omarchy shell plugin (or Waybar module), floating-window launcher, installer
deploy/           Portainer stacks (plain and Traefik)
```

- The server is authoritative. Each game room advances its clock on a timer and fast-forwards after
  restarts, so ships keep sailing while nobody is online.
- Mini-games run the same fixed-point physics on client and server. The client sends only its key
  presses, and the server replays them to decide the outcome.
- Public state (positions, rankings, news) syncs with Colyseus schema. Each player's private data (cash,
  loans, cargo) goes only to that player's connections.

## Gameplay

1. Buy a first ship in the **Shipyard**: a new build, or a cheaper second-hand one.
2. **Bunker** fuel, then pick a **Charter** in the port office. Each offer shows an estimated profit for
   the selected speed. Higher speed arrives sooner but burns fuel with the cube of speed.
3. The ship loads, sails and unloads in real time. On the way you may get:
   - **storms** and **engine failures**: delays and damage
   - **pirates**: pay the ransom or try to outrun them
   - **reefs and ice**: navigate them yourself (mini-game) or take a detour
   - **distress calls**: divert to rescue and earn salvage
4. On arrival, **steer her in** yourself (harbour mini-game) or hire tugs.
5. Get paid, less any late penalty. **Repair** in drydock, take **loans** from the bank and grow your fleet.
   Rankings are by net worth.

If you don't answer a decision in time (24 game hours by default), the captain picks the safe option.

## Quick start

```sh
cp .env.example .env         # set ADMIN_PASSWORD, POSTGRES_PASSWORD, PUBLIC_URL
docker compose up -d --build
open http://localhost:2567    # sign in as admin → Admin → create a game → Invite link
```

- Deployment on Portainer and GitHub Pages: [docs/deployment.md](docs/deployment.md)
- Reverse proxy setup (Caddy, Nginx, Nginx Proxy Manager, Traefik): [docs/reverse-proxy.md](docs/reverse-proxy.md)
- Omarchy status bar and floating window: [integrations/omarchy/README.md](integrations/omarchy/README.md)

## Development

```sh
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass123 npm run dev   # server :2567, web :5173 (needs Postgres)
npm test                                                        # rules, mini-games, server integration
npm run lint                                                    # prettier + typecheck
```

CI (`.github/workflows`):

- `ci.yml`: lint, tests against Postgres, and build
- `docker.yml`: multi-arch image to GHCR, with an optional Portainer webhook
- `pages.yml`: web client to GitHub Pages (manual only; not needed when self-hosting)

The world map comes from [Natural Earth](https://www.naturalearthdata.com/) (public domain), rasterised to 1°.
