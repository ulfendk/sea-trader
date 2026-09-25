# Reverse proxy

Sea Trader is a single Node process listening on port **2567**. It serves the REST API (`/api/*`),
Colyseus matchmaking (`/matchmake/*`), the game WebSockets, and (unless `SERVE_WEB=false`) the web app.
Put any reverse proxy in front of it; it only needs to forward one host to one port.

## What must be configured

| Requirement                                                               | Why                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **HTTPS** with a valid certificate                                        | Browsers only install PWAs, run service workers and deliver Web Push on secure origins.                                |
| **WebSocket upgrade** (`Upgrade` / `Connection` headers) on **all paths** | Colyseus opens a WebSocket per game on paths like `/<processId>/<roomId>`. Don't restrict upgrades to a sub-path.      |
| **Long read/idle timeout** (≥ 1 h, or disable)                            | Game sockets stay open while a player has the game open. The server pings every 15 s, so 60 s is the absolute minimum. |
| Forward `X-Forwarded-For` / `-Proto` / `-Host` and set `TRUST_PROXY=1`    | Correct client IPs for login rate limiting and correct `https` detection.                                              |
| Request body size ≥ 1 MB                                                  | Mini-game input logs are posted as JSON (a few KB normally).                                                           |
| **No response buffering / caching** for `/api` and `/matchmake`           | Responses are per-user; the server sets `Cache-Control` on static assets itself.                                       |
| **One upstream instance**                                                 | Game rooms live in memory in one process. Don't load-balance across several replicas.                                  |

App settings that relate to the proxy:

- `PUBLIC_URL=https://seatrader.example.com` — used in push notification links and allowed for CORS.
- `CORS_ORIGINS=https://<you>.github.io` — only when the web client is hosted elsewhere (GitHub Pages).
- `TRUST_PROXY=1` — number of proxy hops to trust (or `true`).

If you expose the app only through the proxy, remove the `ports:` mapping from the stack and put the proxy
on the same Docker network.

## Caddy

```caddyfile
seatrader.example.com {
	reverse_proxy app:2567
}
```

Caddy handles certificates, WebSocket upgrades and forwarded headers automatically, with no idle timeout on
WebSockets by default. Use `localhost:2567` instead of `app:2567` if Caddy isn't on the stack network.

## Nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name seatrader.example.com;

    ssl_certificate     /etc/letsencrypt/live/seatrader.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seatrader.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:2567;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}

server {
    listen 80;
    server_name seatrader.example.com;
    return 301 https://$host$request_uri;
}
```

## Nginx Proxy Manager (common with Portainer)

1. **Hosts → Proxy Hosts → Add Proxy Host**
   - Domain: `seatrader.example.com`
   - Scheme `http`, Forward Hostname `app` (container name if NPM shares the stack network) or the Docker host IP, Forward Port `2567`
   - Enable **Websockets Support** and **Block Common Exploits**
2. **SSL** tab: request a Let's Encrypt certificate, enable **Force SSL** and **HTTP/2**.
3. **Advanced** tab, custom Nginx configuration:

   ```nginx
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   proxy_buffering off;
   client_max_body_size 2m;
   ```

## Traefik

Use [`deploy/portainer-stack.traefik.yml`](../deploy/portainer-stack.traefik.yml). It attaches the app to an
existing external Traefik network and adds router labels. Set `SEA_TRADER_HOST`, and if yours differ from
the defaults, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT` and `TRAEFIK_CERTRESOLVER`. Traefik passes WebSocket
upgrades and forwarded headers automatically. If your entrypoint sets a short `respondingTimeouts.idleTimeout`,
raise it to at least 1 h.

## Cloudflare Tunnel / Cloudflare proxy

WebSockets are supported. Point the tunnel (or proxied DNS record) at `http://app:2567`. Cloudflare closes
idle WebSockets after about 100 s. The server's 15 s pings keep them alive, so no change is needed.

## Checking it works

```sh
curl -I https://seatrader.example.com/api/health      # 200
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGVzdA==" \
  https://seatrader.example.com/                         # a 101/400 from Node, not a 502/504 from the proxy
```

In the browser, the game's top bar shows **OFFLINE** if the WebSocket can't connect.
