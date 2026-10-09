# Riparr

Hands-off downloads for your *arr stack. Point Riparr at a **container** (a link-protector or paste page that lists file-host links) and it keeps watching it: when new links appear, Riparr downloads them from the host, verifies them, extracts archives and files everything under the folder and naming scheme you chose.

- **Containers:** Click'n'Load pages, `.dlc` containers, plain paste pages (rentry, pastebin, …), and links pushed from your browser's Click'n'Load button
- **Hosts:** pixeldrain, gofile and MEGA, including folders and passwords, with optional accounts
- **Preferred hosts:** each file is downloaded from your favourite host that has it; the other mirrors are kept as fallbacks
- **Downloads:** resume after restarts, size and checksum checks, per-host limits, speed limit, low-disk guard
- **Archives:** zip, 7z and RAR/RAR5, including multi-part sets and passwords
- **Extras:** FlareSolverr for Cloudflare-protected pages, webhook/Discord/Apprise notifications, REST API, single-user login

## Quick start (Docker)

```yaml
services:
  riparr:
    image: riparr:latest
    build: .
    container_name: riparr
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - UMASK=002
      - TZ=Etc/UTC
    volumes:
      - ./config:/config
      - /path/to/media:/downloads   # the same media root your *arr apps use
    ports:
      - "7676:7676"   # web UI
      - "9666:9666"   # Click'n'Load listener
```

```sh
docker compose up -d --build
```

Open `http://<host>:7676` and create your login. (Port 7878 is Radarr's, so Riparr uses 7676.)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` / `PGID` | `1000` | Owner of downloaded files and `/config` |
| `UMASK` | `002` | File creation mask |
| `RIPARR_AUTH` | (unset) | `none` disables login; use it to recover from a forgotten password |
| `RIPARR_CNL_PORT` | `9666` | Click'n'Load listener port inside the container |
| `RIPARR_7Z` | (auto) | Path to a 7-Zip binary, if not the bundled `7z` |

`/config` holds the SQLite database (settings, history, host credentials). Back it up like any other *arr config folder.

## Using it

### Containers

Under **Containers → Add container**, give it:

- **URL:** the container page
- **Target directory:** relative to `/downloads`, e.g. `tv/My Show`
- **Naming template:** where each file goes inside that directory; `/` makes folders

| Token | Value |
| --- | --- |
| `{filename}` | file name with extension |
| `{name}` / `{ext}` | name without extension / extension without the dot |
| `{dir}` | sub-folder inside a remote folder (empty for single files) |
| `{container}` | container name |
| `{host}` | file host, e.g. `pixeldrain` |
| `{date}` / `{year}` / `{month}` | when the link was found |

The default `{dir}/{filename}` keeps a remote folder's structure and collapses to just the file name for single files. Every path segment is sanitized, and nothing can escape the downloads folder.

Every poll re-reads the page as it is now and queues only links it hasn't seen before. New episodes or files added to a container are picked up on the next check. Links are read in this order:

1. **Script-loaded link lists**, as on mkvdrama.net. The page fetches an encrypted list with JavaScript. Riparr does the same without a browser, and keeps each link's release name, episode, quality and size. These sites rate-limit repeat visits, so Riparr waits as long as the site asks.
2. **Click'n'Load data** embedded in the page.
3. **The page's `.dlc` file.**
4. **Plain host links** in the HTML.

Hosts Riparr can't download from yet are set aside ("Riparr can't download from … yet"), not reported as failures.

**Poll the page** fetches the URL on the interval you set. Untick it for pages Riparr can't read itself (captchas) and feed those via Click'n'Load instead. **Add links by hand** on a container's page accepts pasted host links or an uploaded `.dlc` file. Uploading the `.dlc` works even when Riparr itself can't reach the container site.

A container whose page shows a captcha, an anti-bot challenge or a password prompt is marked **Needs attention** on the dashboard, with the reason.

### Click'n'Load

Riparr speaks JDownloader's Click'n'Load protocol on port 9666. Click the CNL button on a container page and the links land in Riparr:

- From a page you already watch, they go into that container, with its folder and template.
- From any other page, Riparr creates a new, non-polled container. Its folder and template come from **Settings → Click'n'Load**.
- Archive passwords sent along with the links are kept and used for extraction.

This is how captcha-protected containers work: solve the captcha in your browser, then click Click'n'Load.

> **Browser on a different machine?** CNL buttons post to `127.0.0.1:9666`, which is the computer running the browser. Forward that port to the Riparr host, for example `ssh -N -L 9666:localhost:9666 you@homelab`, or use a userscript such as *Click'n'Load Interceptor* that redirects the request.

### DLC containers

`.dlc` files are decrypted the way JDownloader and pyLoad do it, which needs one request to JDownloader's DLC service (`service.jdownloader.org`). A `.dlc` can come from three places:
- the container page, when Riparr polls it;
- a file you upload on the container page;
- a Click'n'Load v1 button, which posts the DLC to the listener.

If JDownloader's service is unreachable, Riparr falls back to the page's plain links, or marks the container as needing attention.

### Preferred hosts

Containers usually list the same files on several hosts. Under **Settings → Downloads → Preferred hosts**, order the hosts; the default is gofile, then pixeldrain, then MEGA.
- **Choosing a copy:** Riparr resolves a container's new links first, matches identical files by name and size, and downloads each file from the highest-ranked host that has it.
- **Fallbacks:** the other copies are kept on standby. If the chosen host goes offline, keeps failing or rate-limits you, the next copy takes over.
- **Mirror links:** a link whose files all came from other hosts is marked **mirror**.

### Hosts and accounts

| Host | Links | Account (Settings → Host accounts) |
| --- | --- | --- |
| pixeldrain | `/u/<id>` files, `/l/<id>` lists | API key (raises limits) |
| gofile | `/d/<code>` folders, recursive, passwords | premium token (optional) |
| MEGA | file and folder links, including legacy `#!` forms | none; public links only |

Rate limits are respected: the link waits, and the wait doesn't count as a failed attempt. Removed files are marked **offline**. Other errors are retried 5 times with backoff, then marked **failed**, and you can retry them from the queue.

gofile's API needs a "website token" built from a value that gofile changes every few months. If gofile folders suddenly fail with an auth error, update **Website token salt** under the gofile account.

Saved credentials are stored unencrypted in the database under `/config`.

### Archives

After a container's downloads settle, Riparr extracts finished archives in place. It tries no password, then the container's password, then any password that arrived with Click'n'Load. A set that's still missing parts waits for them. A set that needs a password shows up under **Archives** on the container page; set the password on the container and the archive is retried. Deleting the archives after extraction is optional (**Settings → Archives**).

### FlareSolverr

If container pages sit behind a Cloudflare or DDoS-Guard challenge, run [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) and set its URL in **Settings → Integrations**:

```yaml
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    restart: unless-stopped
```

The URL is then `http://flaresolverr:8191`. Riparr reuses the clearance cookies until they expire. FlareSolverr can't solve real captchas (reCAPTCHA, hCaptcha); use Click'n'Load for those.

### Notifications

Under **Settings → Integrations**, set a **webhook URL** (JSON, with Discord webhook URLs detected and formatted) and/or an **Apprise API** endpoint such as `http://apprise:8000/notify/riparr`. Then choose which events send: new links, download finished, download failed, needs attention.

## API

Send the API key from **Settings → Security** as an `X-Api-Key` header or an `?apikey=` query parameter.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/status` | Worker state, counts, current speed, free disk space |
| GET | `/api/v1/containers` | All containers (passwords are never returned) |
| POST | `/api/v1/containers` | Create: `{name, url, target_dir, path_template?, password?, poll_interval_min?, enabled?, poll?}` |
| GET | `/api/v1/containers/{id}` | One container with its links |
| DELETE | `/api/v1/containers/{id}` | Stop watching (downloaded files are kept) |
| POST | `/api/v1/containers/{id}/check` | Poll now |
| POST | `/api/v1/containers/{id}/links` | Add links by hand: `{urls: [...]}` |
| GET | `/api/v1/queue` | Active and recently finished links |
| POST | `/api/v1/links/{id}/retry` | Retry a link |
| POST | `/api/v1/links/{id}/ignore` | Ignore (and cancel) a link |
| GET | `/api/health` | Unauthenticated liveness check (used by the Docker healthcheck) |

```sh
curl -H "X-Api-Key: $KEY" http://homelab:7676/api/v1/status
```

## Development

Requires Node 24 (Riparr uses the built-in `node:sqlite`).

```sh
npm install
npm run dev        # Next dev server + worker (watch mode); data in ./config and ./downloads
npm test           # vitest; 7-Zip tests run when a 7z binary is installed
npm run typecheck
npm run lint
npm run build      # Next standalone build + bundled worker (dist/worker.mjs)
```

Riparr runs as two processes that share one SQLite database:

- **Web** (`app/`, Next.js): the UI, Server Actions, the REST API, and `proxy.ts` for auth.
- **Worker** (`worker/`): polls containers, runs the download pipeline, extracts archives and serves Click'n'Load.

The UI talks to the worker through a `commands` table. Shared code lives in `lib/`: crawlers, host resolvers, the downloader, path templates and data access.
