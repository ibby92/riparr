# Riparr

Hands-off downloads for your *arr stack. Add a show or movie, give it the page (a link protector or paste page) that lists its file-host links, and Riparr keeps watching it: when new episodes appear, it downloads them from your preferred host, verifies them, extracts archives and files them in your library like Sonarr and Radarr do.

- **Library:** shows and movies matched on TMDB, with posters and a calendar of upcoming episodes, in *arr-style root folders (`/media/Kdrama/Doctor X/Season 01/…`); season folders optional per show
- **Sources:** several pages per title. mkvdrama-style encrypted lists, viewcrate-style DLC exports, filecrypt and other Click'n'Load pages, `.dlc` files, plain paste pages, and links pushed from your browser's Click'n'Load button (captcha-protected containers such as gated filecrypt ones go this way)
- **Hosts:** gofile, pixeldrain and MEGA, including folders and passwords, with optional accounts
- **Preferred hosts:** each file is downloaded once, from your favourite host that has it; other mirrors are kept as fallbacks
- **Downloads:** resume after restarts and stalls, host-wide cooldowns for transfer limits, size and checksum checks, per-host limits, speed limit, free-space guard per root folder
- **Archives:** zip, 7z and RAR/RAR5, including multi-part sets and passwords
- **Extras:** light and dark themes, a queue that explains every wait, history, FlareSolverr, proxy/VPN for blocked sites, webhook/Discord/Apprise notifications, REST API, single-user login, automatic database backups before upgrades

Full documentation is in [`docs/`](docs/README.md): [installation](docs/installation.md), [user guide](docs/user-guide.md), [configuration](docs/configuration.md), [API](docs/api.md), [troubleshooting](docs/troubleshooting.md), [architecture](docs/architecture.md) and [development](docs/development.md).

## Quick start (Docker)

The image is built locally:

```sh
npm install
npm run release    # checks + tests, then builds riparr:<version> and riparr:latest
```

```yaml
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

Open `http://<host>:7676` and create your login. (Port 7878 is Radarr's, so Riparr uses 7676.) Then:

1. **Settings → Media Management:** add your root folders, e.g. `/media/Kdrama` and `/media/Movies`.
2. **Settings → Connections:** add a free TMDB API key, and your proxy or FlareSolverr if you use them.
3. **Add title:** search TMDB, pick the root folder, paste the title's source page(s).

`/config` holds the database (titles, settings, history, host credentials), its backups and cached posters. Back it up like any other *arr config folder. See [installation](docs/installation.md) for gluetun, upgrades and restores.

## How it works

Every check re-reads each source page as it is now and queues only links the title hasn't seen before, so new episodes are picked up on the next check. Riparr then asks each host which files a link holds, matches identical files across hosts by name and size, and downloads each from the highest-ranked host in **Settings → Downloads → Preferred hosts** (default gofile, pixeldrain, MEGA). When a host hits a transfer limit, its downloads pause until the limit ends and other hosts' copies take over. Finished files land at `<root folder>/<title folder>/[Season NN/]<file>`, and archives are extracted once the title's downloads settle.

Pages with captchas can't be read automatically: solve the captcha in your browser and send the links with Click'n'Load (port 9666). Container sites that your network blocks can be reached through a proxy such as gluetun's (**Settings → Connections → Proxy**).

## API

Send the API key from **Settings → Security** as an `X-Api-Key` header or an `?apikey=` query parameter. Endpoints cover status, titles, sources, root folders, the queue and links; see [docs/api.md](docs/api.md).

```sh
curl -H "X-Api-Key: $KEY" http://homelab:7676/api/v1/status
```

## Development

Requires Node 24 (Riparr uses the built-in `node:sqlite`).

```sh
npm install
npm run dev        # Next dev server + worker (watch mode); data in ./config
npm test           # vitest; 7-Zip tests run when a 7z binary is installed
npm run typecheck
npm run lint
npm run build      # Next standalone build + bundled worker (dist/worker.mjs)
```

Riparr runs as two processes that share one SQLite database:

- **Web** (`app/`, Next.js): the UI, Server Actions, the REST API, and `proxy.ts` for auth.
- **Worker** (`worker/`): checks sources, runs the download pipeline, extracts archives and serves Click'n'Load.

The UI talks to the worker through a `commands` table. Shared code lives in `lib/`: crawlers, host resolvers, the downloader, path templates and data access.
