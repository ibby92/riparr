# Configuration reference

Most configuration lives in the web UI (**Settings**) and is stored in the database. A few things are set with environment variables.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | `1000` | User id that owns created files and `/config` |
| `PGID` | `1000` | Group id for the same |
| `UMASK` | `002` | File creation mask |
| `TZ` | (container default) | Time zone for logs and `{date}` tokens |
| `PORT` | `7676` | Web UI port inside the container |
| `RIPARR_CONFIG_DIR` | `/config` (image), `./config` (dev) | Where `riparr.db` lives |
| `RIPARR_DOWNLOADS_DIR` | `/downloads` (image), `./downloads` (dev) | Download root |
| `RIPARR_CNL_PORT` | `9666` | Click'n'Load listener port |
| `RIPARR_PROXY_URL` | (unset) | Proxy for container sites. Used when no proxy is set in Settings. |
| `RIPARR_AUTH` | (unset) | `none` turns login off. For recovering from a lost password. |
| `RIPARR_7Z` | (auto) | Path to a 7-Zip binary. By default `7z`, `7zz` or `7za` is found on `PATH`, preferring one with RAR5 support. |

For the gluetun compose overrides (`.env`):

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NORDVPN_USER`, `NORDVPN_PASSWORD` | `docker-compose.vpn.yml` | NordVPN service credentials |
| `NORDVPN_COUNTRY` | `docker-compose.vpn.yml` | VPN server country (default `Canada`) |
| `GLUETUN_NETWORK` | `docker-compose.existing-gluetun.yml` | Docker network of your existing gluetun (default `vpn_proxy`) |

## Settings

### Downloads

| Setting | Default | Notes |
| --- | --- | --- |
| Simultaneous downloads | 3 | Across all hosts (1–20). Changes apply without a restart. |
| Per host | 2 | For each host (1–10) |
| Speed limit per download (MB/s) | 0 (unlimited) | Applies to each download separately |
| Keep free (GB) | 5 | New downloads wait below this; 0 turns the check off |
| Preferred hosts | gofile, pixeldrain, MEGA | Order used to choose between [mirrors](user-guide.md#preferred-hosts-and-mirrors) |

### Archives

| Setting | Default | Notes |
| --- | --- | --- |
| Extract archives | On | zip, 7z, RAR/RAR5, single or multi-part |
| Delete archives after extraction | Off | Only after a successful extraction |

### Click'n'Load

| Setting | Default | Notes |
| --- | --- | --- |
| Listen on port 9666 | On | Restart Riparr to apply |
| Folder for links from unknown pages | `clicknload` | Relative to `/downloads` |
| Naming template | `{container}/{dir}/{filename}` | For containers Click'n'Load creates |

### Integrations

| Setting | Default | Notes |
| --- | --- | --- |
| Proxy | (empty) | `http://`, `https://` or `socks5://`, with optional `user:pass@`. Overrides `RIPARR_PROXY_URL`. |
| Proxy scope | Container sites only | Or *Everything*: also host APIs and downloads, except MEGA |
| FlareSolverr URL | (empty) | e.g. `http://flaresolverr:8191` |
| Webhook URL | (empty) | JSON POST; Discord webhooks are detected |
| Apprise API URL | (empty) | e.g. `http://apprise:8000/notify/riparr` |
| Events | Finished, failed, needs attention | *New links found* is also available |

### Host accounts

| Host | Fields |
| --- | --- |
| pixeldrain | API key |
| gofile | Account token, website token salt |

### Security

Covers turning authentication on or off, the login (username and password), and the API key. See [Security](user-guide.md#security).

## Per-container settings

These are set on each container's edit page and described in the [user guide](user-guide.md#containers): name, URL, password, poll interval (5 minutes to 1 week), target directory, naming template, enabled, poll the page.

## Fixed behaviour

These aren't configurable, but are useful to know:

| Behaviour | Value |
| --- | --- |
| Worker tick | Every 2 s |
| Download retries | 5 attempts, 1 m → 2 m → 4 m → 8 m between attempts (cap 6 h); rate limits don't count |
| Failed container checks | Interval doubles per consecutive failure, capped at 6 h; ±10 % jitter on every schedule |
| Container site rate limit | Next check after the site's `Retry-After` (default 15 min) |
| Free-space check | Every 30 s |
| Activity log retention | 30 days |
| Login throttle | 10 failures per IP per 15 minutes |
| Session lifetime | 30 days |
