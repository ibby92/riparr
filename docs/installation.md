# Installation

Riparr ships as a single Docker image that runs two processes: the web UI and a background worker.

## Requirements

- Docker with Compose.
- A downloads folder, ideally the same media root your *arr apps use.
- Optional extras:
  - [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr), for container pages behind a Cloudflare challenge.
  - [gluetun](https://github.com/qdm12/gluetun) or another proxy, if your network blocks container sites.

## Quick start

```yaml
# docker-compose.yml
services:
  riparr:
    build: .
    image: riparr:latest
    container_name: riparr
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - UMASK=002
      - TZ=Etc/UTC
    volumes:
      - ./config:/config
      - /path/to/media:/downloads
    ports:
      - "7676:7676"   # web UI
      - "9666:9666"   # Click'n'Load listener
```

```sh
docker compose up -d --build
```

Open `http://<host>:7676`. The first visit asks you to create the login.

> Port 7878 belongs to Radarr, so Riparr uses **7676**.

## Volumes

| Path | Contents |
| --- | --- |
| `/config` | `riparr.db`: the SQLite database holding containers, link history, settings and host credentials |
| `/downloads` | Download root. Each container's *target directory* is relative to it. Partial downloads live in `/downloads/.riparr-partial/`. |

Files are created as `PUID`:`PGID` with the given `UMASK`, so Sonarr, Radarr and your media server can read them.

## Ports

| Port | Purpose |
| --- | --- |
| 7676 | Web UI and REST API |
| 9666 | Click'n'Load listener. Only needed if you push links from a browser; see [Click'n'Load](user-guide.md#clicknload). |

## Environment variables

See the [configuration reference](configuration.md#environment-variables) for the full list. The most common ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of created files |
| `UMASK` | `002` | File creation mask |
| `RIPARR_PROXY_URL` | (unset) | Proxy for container sites, e.g. `http://gluetun:8888` |
| `RIPARR_AUTH` | (unset) | `none` disables login, for recovery |

## Behind a VPN or proxy

Some networks block particular container sites, for example by filtering on the site name. Riparr can send its requests to those sites through a proxy while downloads stay on your normal connection.

### You already run gluetun

gluetun must have `HTTPPROXY=on`. Join Riparr to gluetun's Docker network with the bundled override:

```sh
docker compose -f docker-compose.yml -f docker-compose.existing-gluetun.yml up -d
```

The override expects the gluetun container to be named `gluetun` and its network to be `vpn_proxy`. Set `GLUETUN_NETWORK` if your network is called something else.

### Start a gluetun for NordVPN

Put your NordVPN **service credentials** (not your account email and password) in `.env`:

```sh
cp .env.example .env   # NORDVPN_USER, NORDVPN_PASSWORD, NORDVPN_COUNTRY
docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
```

Service credentials are on the Nord dashboard under *Set up NordVPN manually*. Any other provider gluetun supports works with the same pattern.

Once it's running, **Settings → Integrations → Test proxy** confirms that requests leave through the VPN; the IP it reports should differ from your direct one. See [Proxy](user-guide.md#proxy-and-vpn) for scopes and SOCKS5.

## First run

1. **Create your login** on the setup page.
2. **Settings → Downloads:** check the concurrency limits, the free-space floor (default 5 GB) and the **preferred hosts** order.
3. **Settings → Integrations:** add a notification target (webhook, Discord or Apprise) and send a test.
4. **Containers → Add container:** paste a container URL and choose a target directory.

## Health check

The image has a Docker `HEALTHCHECK` that calls `/api/health` (no login needed). It reports unhealthy if the web server, the database or the worker stops responding.

## Upgrading

```sh
git pull
docker compose up -d --build
```

Database migrations run automatically when the new version starts. Back up `/config` first; see below.

## Backups

All state is in `/config/riparr.db`. Stop the container, or use SQLite's backup command, then copy the file:

```sh
sqlite3 /path/to/config/riparr.db ".backup '/backups/riparr-$(date +%F).db'"
```

Downloaded files are already in your media folders and don't need Riparr to stay usable.

## Locked out

Start the container with `RIPARR_AUTH=none`, sign in without a password, set a new password under **Settings → Security**, then remove the variable and restart.
