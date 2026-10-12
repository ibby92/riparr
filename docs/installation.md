# Installation

Riparr runs in Docker like Sonarr and Radarr: one image, a `/config` volume for its database, and your media library mounted inside. The image runs two processes, the web UI and a background worker.

## Requirements

- Docker with Compose, on the machine that will build and run Riparr. The image is built locally; nothing is published.
- Your media library mounted into the container, e.g. your NAS `Videos` share.
- Optional services you can point Riparr at by URL:
  - [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr), for container pages behind a Cloudflare challenge;
  - an HTTP or SOCKS5 proxy, such as [gluetun](https://github.com/qdm12/gluetun)'s, for container sites your network blocks.

## Build the image

From the repository:

```sh
npm install
npm run release
```

`npm run release` runs lint, typecheck and the full test suite, including the 7-Zip tests inside Docker. It then builds `riparr:<version>` and tags it `riparr:latest`.

## Run it

```yaml
# docker-compose.yml
services:
  riparr:
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
      - /path/to/Videos:/media   # your media library
    ports:
      - "7676:7676"   # web UI
      - "9666:9666"   # Click'n'Load listener
```

```sh
docker compose up -d
```

Open `http://<host>:7676`. The first visit asks you to create the login. (Port 7878 is Radarr's, so Riparr uses 7676.)

To keep machine-specific bits (your media path, extra networks) out of `docker-compose.yml`, put them in a `docker-compose.override.yml` next to it. Docker Compose merges it in automatically, and it's git-ignored. For example:

```yaml
services:
  riparr:
    volumes:
      - /mnt/storage/Videos:/media
```

## Volumes

| Path | Contents |
| --- | --- |
| `/config` | `riparr.db` (titles, sources, history, settings, credentials), `backups/`, and `MediaCover/` (cached posters) |
| Your media mount (e.g. `/media`) | Your library. Root folders are chosen inside it; see First run. Partial downloads live in a hidden `.riparr-partial` folder in each root folder. |

Files are created as `PUID`:`PGID` with the given `UMASK`, so Plex, Jellyfin and your *arr apps can read them.

## First run

1. **Create your login** on the setup page.
2. **Settings → Media Management:** add your **root folders**, the library folders as seen inside the container (e.g. `/media/Kdrama`, `/media/Movies`). The folder browser lists what's mounted. Then pick the default root folder for new shows and movies, and whether new shows get season folders.
3. **Settings → Connections:** add your **TMDB API key** (free from themoviedb.org) so adding a title can search TMDB and show posters and episode counts. If you use them, add your FlareSolverr URL and proxy URL here too. Each field has a **Test** button.
4. **Settings → Downloads:** check the download limits, the free-space floor (default 5 GB per root folder) and the **preferred hosts** order.
5. **Settings → Notifications:** add a webhook (Discord works) or an Apprise URL, and send a test.
6. **Add title:** search TMDB, choose the root folder and season folders, then paste the title's container page(s) as sources.

Files land at `<root folder>/<title folder>/Season 01/<file>`, where Plex and Jellyfin pick them up on their next scan.

## Using your existing gluetun and FlareSolverr

Riparr doesn't start its own VPN or FlareSolverr. You enter their URLs in **Settings → Connections**. One thing to get right is Docker networking: inside Riparr's container, `127.0.0.1` is Riparr itself, not the host. So either:

- **Join their network (recommended).** Then use their container names, e.g. `http://gluetun:8888` and `http://flaresolverr:8191`. For a gluetun on a network called `vpn_proxy`, add to Riparr's service in `docker-compose.yml`:
  ```yaml
      networks: [default, vpn_proxy]
  # …and at the top level:
  networks:
    vpn_proxy:
      external: true
  ```
  Optionally set `RIPARR_PROXY_URL=http://gluetun:8888` under `environment:` instead of entering the proxy in Settings.
- **Or use the host's address** where those services publish their ports, e.g. `http://192.168.1.10:8888`, as you would in Sonarr or Radarr. The port has to be published on that address: a mapping like `127.0.0.1:8888:8888` (common for gluetun's proxy) only listens on the host's loopback, which other containers can't reach. Publish it as `8888:8888` instead, and consider gluetun's `HTTPPROXY_USER`/`HTTPPROXY_PASSWORD` since the proxy is then open to your LAN.

gluetun needs `HTTPPROXY=on` for its proxy. **Test proxy** shows the exit IP, so you can confirm requests leave through the VPN.

The proxy covers container sites only by default. Your downloads keep using your normal connection unless you switch the scope to *Everything*.

## Health check

The image has a Docker `HEALTHCHECK` that calls `/api/health` (no login needed). It reports unhealthy if the web server, the database or the worker stops responding. **System → Status** shows the same information in the UI.

## Upgrading

```sh
git pull
npm run release
docker compose up -d
```

Riparr backs up the database to `/config/backups/riparr-v<old version>-<date>.db` and then upgrades it automatically, keeping your titles, sources, history and settings. The newest 5 backups are kept, and **System → Backups** lists them.

**Rolling back:** retag the previous image and restart, then restore the matching backup (see below):

```sh
docker tag riparr:<previous version> riparr:latest
docker compose up -d
```

## Backups and restore

- **Back up now** under **System → Backups**, or copy `/config/riparr.db` while Riparr is stopped.
- **Restore:**
  1. Stop Riparr (`docker compose stop riparr`).
  2. Copy the backup over `/config/riparr.db`.
  3. Delete `riparr.db-wal` and `riparr.db-shm` if they're there.
  4. Start it again.

Downloaded files are already in your library and don't depend on Riparr.

## Locked out

Start the container with `RIPARR_AUTH=none`, sign in without a password, set a new password under **Settings → Security**, then remove the variable and restart.

## Upgrading from a pre-v1 install

Older versions downloaded into a `/downloads` volume and tracked "containers". On first start the new version:
- turns each container into a title with one source, keeping its links and history;
- makes the old downloads folder its first root folder.

Keep the old `/downloads` mount until you've moved those titles to your new root folders (Edit title), or files for them will have nowhere to go.
