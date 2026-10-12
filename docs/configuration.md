# Configuration reference

Most configuration lives in the web UI (**Settings**) and is stored in the database. A few things are set with environment variables.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | `1000` | User id that owns created files and `/config` |
| `PGID` | `1000` | Group id for the same |
| `UMASK` | `002` | File creation mask |
| `TZ` | (container default) | Default time zone when none is chosen in Settings → General |
| `PORT` | `7676` | Web UI port inside the container |
| `RIPARR_CONFIG_DIR` | `/config` (image), `./config` (dev) | Where `riparr.db`, backups and cached posters live |
| `RIPARR_CNL_PORT` | `9666` | Click'n'Load listener port |
| `RIPARR_PROXY_URL` | (unset) | Proxy for container sites. Used when no proxy is set in Settings. |
| `RIPARR_AUTH` | (unset) | `none` turns login off. For recovering from a lost password. |
| `RIPARR_LOG_LEVEL` | (unset) | `debug` keeps debug logging on regardless of the System → Logs switch, e.g. to see start-up in detail. |
| `RIPARR_7Z` | (auto) | Path to a 7-Zip binary. By default `7z`, `7zz` or `7za` is found on `PATH`, preferring one with RAR5 support. |
| `RIPARR_DOWNLOADS_DIR` | `/downloads` | Only used when upgrading a pre-v1 database: that folder becomes the first root folder. |

Your media lives wherever you mount it, e.g. `/path/to/Videos:/media`. Riparr doesn't assume a path; you add root folders under it in **Settings → Media Management**.

Riparr doesn't start a VPN itself; point it at your existing proxy (see [installation](installation.md#using-your-existing-gluetun-and-flaresolverr)).

## Settings

Each heading below is a page under **Settings**.

### General

| Setting | Default | Notes |
| --- | --- | --- |
| Time zone | The container's `TZ` (UTC if unset) | Zone for every time and day shown, and the `{date}` naming token. |

### Media Management

| Setting | Default | Notes |
| --- | --- | --- |
| Root folders | none | Absolute paths inside the container, e.g. `/media/Kdrama`. They must exist and be writable by `PUID`/`PGID`. A folder still used by titles can't be removed. |
| Root folder for new shows / movies | First root folder | Preselected when adding a title |
| Season folders for new shows | On | Each show can turn it off. On: `Show/Season 01/<file>`; off: `Show/<file>`. Movies never use them. |
| Click'n'Load listener | On | Port 9666. Links from a page you don't track yet become a new show in the default show root folder. Restart Riparr to apply. |

### Downloads

| Setting | Default | Notes |
| --- | --- | --- |
| Simultaneous downloads | 3 | Across all hosts (1–20). Changes apply without a restart. |
| Per host | 2 | For each host (1–10) |
| Speed limit per download (MB/s) | 0 (unlimited) | Applies to each download separately |
| Keep free (GB) | 5 | Checked per root folder. New downloads into a folder wait below this; 0 turns the check off. |
| Stall timeout | 3 minutes | A download with no new data for this long is restarted from where it stopped; 0 turns it off |
| Preferred hosts | gofile, pixeldrain, MEGA | Order used to choose between [mirrors](user-guide.md#preferred-hosts-and-mirrors) |
| Extract archives | On | zip, 7z, RAR/RAR5, single or multi-part |
| Delete archives after extraction | Off | Only after a successful extraction |

### Hosts

| Host | Fields |
| --- | --- |
| pixeldrain | API key |
| gofile | Account token, website token salt |

### Connections

| Setting | Default | Notes |
| --- | --- | --- |
| TMDB API key | (empty) | Free from themoviedb.org. Used to search when adding a title, and for posters and episode counts. Never shown again once saved. |
| TMDB language | `en-US` | Language of titles and overviews |
| Proxy | (empty) | `http://`, `https://` or `socks5://`, with optional `user:pass@`. Overrides `RIPARR_PROXY_URL`. |
| Proxy scope | Container sites only | Or *Everything*: also host APIs and downloads, except MEGA |
| FlareSolverr URL | (empty) | e.g. `http://flaresolverr:8191` |

Each one has a **Test** button.

### Notifications

| Setting | Default | Notes |
| --- | --- | --- |
| Webhook URL | (empty) | JSON POST; Discord webhooks are detected |
| Apprise API URL | (empty) | e.g. `http://apprise:8000/notify/riparr` |
| Events | Finished, failed, needs attention | *New links found* is also available |

### Security

Covers turning authentication on or off, the login (username and password), and the API key. See [Security](user-guide.md#security).

## Per-title and per-source settings

- **Title** (Add title / Edit title):
  - type, name, year and TMDB match;
  - root folder and folder name;
  - season folders, naming template, monitored.
- **Source** (on the title's page): page URL, password, check interval (5 minutes to 1 week), enabled, and whether to check the page for new links.

## Fixed behaviour

These aren't configurable, but are useful to know:

| Behaviour | Value |
| --- | --- |
| Worker tick | Every 2 s |
| Download retries | 5 attempts, 1 m → 2 m → 4 m → 8 m between attempts (cap 6 h); rate limits don't count |
| Host cooldown | A host limit of 2 minutes or more pauses every download on that host until it ends; shorter waits affect only that link |
| Failed source checks | Interval doubles per consecutive failure, capped at 6 h; ±10 % jitter on every schedule |
| Container site rate limit | Next check after the site's `Retry-After` (default 15 min) |
| Free-space check | Every 30 s per root folder |
| Title folder rescan | When a title is added or edited, after a check finds new links, and every 30 minutes |
| Database backups | Before every upgrade, in `/config/backups`; the newest 5 are kept |
| Log retention | 30 days; debug entries 3 days |
| Login throttle | 10 failures per IP per 15 minutes |
| Session lifetime | 30 days |
