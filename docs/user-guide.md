# User guide

- [Concepts](#concepts)
- [Containers](#containers)
- [How polling works](#how-polling-works)
- [Click'n'Load](#clicknload)
- [DLC files and adding links by hand](#dlc-files-and-adding-links-by-hand)
- [Preferred hosts and mirrors](#preferred-hosts-and-mirrors)
- [Downloads and the queue](#downloads-and-the-queue)
- [Archives](#archives)
- [Notifications](#notifications)
- [Proxy and VPN](#proxy-and-vpn)
- [FlareSolverr](#flaresolverr)
- [Host accounts](#host-accounts)
- [Security](#security)

## Concepts

| Term | Meaning |
| --- | --- |
| **Container** | A page that lists download links for a release, such as a link protector (mkvdrama, viewcrate…) or a paste page. Riparr watches it for new content. |
| **Link** | A host URL found in a container, e.g. `https://gofile.io/d/abc`. One link can hold several files (a folder). |
| **File** | One downloadable file behind a link. |
| **Host** | The service the file is stored on: gofile, pixeldrain or MEGA. Other hosts are recognized but set aside. |
| **Mirror** | The same file offered on several hosts. Riparr downloads one copy. |

## Containers

**Containers → Add container**:

| Field | Notes |
| --- | --- |
| Name | Shown in the UI, and available as `{container}` in templates |
| Container URL | The page to watch |
| Password | Optional. Used for password-protected container pages, gofile folder passwords and archive extraction. |
| Poll every (minutes) | Between 5 minutes and 1 week. Default 60. Container sites rate-limit frequent visits, so keep this generous. |
| Target directory | Relative to `/downloads`, e.g. `tv/My Show` |
| File naming template | Where each file goes inside the target directory (see below) |
| Enabled | Off pauses the container: no polling, no new downloads, and running downloads are stopped. They resume where they left off when you re-enable it. |
| Poll the page | Off means Riparr never fetches the page. Links arrive only through [Click'n'Load](#clicknload) or by hand. Use this for captcha-protected pages. |

### Naming templates

The template sets the path of each file inside the container's target directory. A `/` creates folders.

| Token | Value |
| --- | --- |
| `{filename}` | File name with extension |
| `{name}` | File name without extension |
| `{ext}` | Extension without the dot |
| `{dir}` | Sub-folder inside a remote folder (empty for single files) |
| `{container}` | Container name |
| `{host}` | Host id, e.g. `pixeldrain` |
| `{date}`, `{year}`, `{month}` | When the link was discovered (`YYYY-MM-DD`, `YYYY`, `MM`) |

The template must contain `{filename}` or `{name}`. The default, `{dir}/{filename}`, keeps a remote folder's structure and collapses to just the file name for single files. Every path segment is cleaned (characters that are invalid on Windows/SMB are removed, reserved names like `CON` are prefixed), and nothing can escape the downloads folder.

If a different file already exists at the destination, the new one is saved as `name (1).ext`. An identical file (same size) is skipped.

### Container status

| Status | Meaning |
| --- | --- |
| Pending | Not checked yet |
| OK | Last check succeeded, even if it found nothing new |
| Needs attention | A person has to step in: a captcha, a password, a challenge FlareSolverr couldn't pass, or a failed DLC. The reason is shown on the container and the dashboard. |
| Error | The last check failed, e.g. the site was down. Riparr retries automatically with growing delays (up to 6 hours between checks). |
| Paused | The container is disabled |

## How polling works

Every check fetches the container page **as it is now**, reads all the links it currently offers, and queues only links Riparr hasn't seen before. When a site adds an episode, the next check picks it up. Links that disappear from a page are kept in Riparr's history, not deleted.

Riparr reads a page in this order and uses the first approach that finds links:

1. **Script-loaded link lists**:
   - *mkvdrama-style:* the page loads an encrypted link list with JavaScript. Riparr fetches and decrypts it the same way, without a browser.
   - *viewcrate-style:* the page offers a **DLC export** for download managers. Riparr fetches a fresh copy each check. viewcrate's on-page links go through a resolver that refuses automated access, so Riparr doesn't use that.

   Both keep each link's **release name, episode, quality and size**, shown in the links table.
2. **Click'n'Load data** embedded in the page.
3. **The page's `.dlc` file**, if it has one.
4. **Plain host links** anywhere in the page.

If a container site answers "too many requests", Riparr waits as long as the site asks before checking again. This doesn't count as an error.

Links on hosts Riparr can't download from (e.g. send.now, vikingfile, fileditch) are listed as *ignored* with "Riparr can't download from … yet". They aren't failures and don't trigger notifications.

## Click'n'Load

Riparr speaks JDownloader's Click'n'Load protocol on port **9666**. When you click a container's Click'n'Load button in your browser, the links go to Riparr:

- **From a page you already watch:** the links go into that container, with its folder and template.
- **From any other page:** Riparr creates a new container for it with **Poll the page** turned off. Its folder and template come from **Settings → Click'n'Load**.
- **With no source page:** the links go into a shared *Click'n'Load* container.
- **Archive passwords** sent along with the links are kept and used when extracting.

This is how to handle **captcha-protected** containers: solve the captcha in your browser, then click Click'n'Load.

Supported endpoints: `/flash/addcrypted2` (encrypted CNL2), `/flash/add` (plain list) and `/flash/addcrypted` (a DLC container).

### Using Click'n'Load from another machine

Click'n'Load buttons send links to `127.0.0.1:9666`, which is the computer running the browser. If Riparr runs on a server, forward that port to it:

```sh
ssh -N -L 9666:localhost:9666 you@server
```

Alternatively, use a userscript that redirects Click'n'Load requests to your server, such as *Click'n'Load Interceptor*.

## DLC files and adding links by hand

On a container's page, **Add links by hand or import a .dlc** offers two ways in:

- **Paste links:** paste host URLs, separated by whitespace, optionally with an archive password. Anything that isn't a link is ignored, and duplicates are skipped.
- **Import a .dlc file:** upload a DLC container that you downloaded in your browser. This works even if Riparr itself can't reach the site.

DLC files are decrypted the way JDownloader and pyLoad do it, which takes one request to **JDownloader's DLC service** (`service.jdownloader.org`). If that service is down, DLC import fails with a clear message, and polled pages fall back to their plain links.

Pushed or uploaded DLC and Click'n'Load data is a snapshot of that moment. To keep receiving new content, make sure the container is polled.

## Preferred hosts and mirrors

Containers usually offer each file on several hosts. Under **Settings → Downloads → Preferred hosts**, order the hosts with the ↑/↓ buttons. The default order is gofile, pixeldrain, MEGA.

How Riparr picks a copy:

1. It first **resolves** every new link, asking each host which files the link holds, without downloading.
2. When all of a container's fresh links are resolved, it groups identical files (same name, ignoring case, and same size) across hosts.
3. Each file is downloaded from the highest-ranked host that has it. The other copies wait on **standby**.

Fallback is automatic:

| Situation | What happens |
| --- | --- |
| Preferred copy is removed (offline) | Next host's copy is used |
| Preferred host errors | Next host's copy is used while the preferred link waits for its retry |
| Preferred host rate-limits you | Next host's copy is used instead of waiting out the limit |
| Preferred link gives up (5 attempts) | Its files are released for good, and other copies are used |

A link whose files all came from other hosts ends as **mirror**.

Different qualities (720p and 1080p) are different files, so both are downloaded if the container lists both.

## Downloads and the queue

The **Queue** page lists active and waiting links and recently finished ones. The dashboard shows what's downloading, total speed and free disk space.

| Link status | Meaning |
| --- | --- |
| new | Just discovered |
| resolving | Asking the host which files the link holds |
| queued | Waiting for a download slot or a retry. *standby* means another host's copy is preferred. |
| downloading | In progress, with speed and time remaining |
| done | All its files are downloaded (some may have come from mirrors) |
| mirror | Not needed: every file came from a preferred host |
| offline | The host says the file is gone |
| failed | Gave up after 5 attempts, or needs your attention (e.g. a password) |
| ignored | You ignored it, or Riparr can't download from that host |

**Retry** clears a link's attempt count and backoff. **Ignore** stops it, cancelling a running download.

### Retries

- **Ordinary errors** are retried 5 times, waiting 1, 2, 4 and 8 minutes between attempts (capped at 6 hours).
- **Rate limits** wait as long as the host asks and don't count as an attempt.
- **Removed files** aren't retried.
- **Downloads resume** where they stopped, after a restart or a pause, when the host supports it.
- **Checks:** size is checked when the host reports it. A checksum is checked when the host provides one (pixeldrain single files, gofile).

### Limits

Configured under **Settings → Downloads**:

| Limit | Applies to |
| --- | --- |
| Simultaneous downloads | All links, across hosts |
| Per host | Links from a single host |
| Speed limit | Each download separately, not the total |
| Keep free (GB) | New downloads wait while the downloads volume has less free space than this. Running downloads finish, and you're notified once. |

## Archives

Once all of a container's downloads have settled, Riparr extracts finished archives in place. It handles zip, 7z and RAR (including RAR5), in single or multi-part sets.

- **Passwords tried, in order:** no password, then the container's password, then any password that arrived with Click'n'Load or with pasted links.
- **Missing parts:** a set with parts missing is extracted after more parts arrive.
- **Wrong or missing password:** a set that needs a password raises *needs attention*. Set the password on the container; saving it retries the archive. The container page also has **Retry failed**.
- **Results** for each archive are listed under **Archives** on the container page.
- **Deleting archives** after a successful extraction is optional (**Settings → Archives**).
- **Path traversal:** extracted files can't escape the folder, and symlinks are dropped.

## Notifications

**Settings → Integrations**:

- **Webhook URL:** receives JSON:
  ```json
  { "event": "download_done", "title": "Riparr: Download finished", "message": "...", "container": { "id": 1, "name": "..." }, "timestamp": "..." }
  ```
  Discord webhook URLs are detected and sent as Discord messages.
- **Apprise API URL**, e.g. `http://apprise:8000/notify/riparr`, which fans out to ntfy, Gotify, Telegram, email and others.
- **Events:** new links found, download finished, download failed, container needs attention.

**Send test notification** uses the saved settings.

## Proxy and VPN

If your network blocks a container site, Riparr can reach it through a proxy. Set it under **Settings → Integrations → Proxy**, or with `RIPARR_PROXY_URL`; the setting wins if both are set.

| Format | Example |
| --- | --- |
| HTTP proxy | `http://gluetun:8888` |
| HTTP proxy with login | `http://user:pass@host:8888` |
| SOCKS5 | `socks5://user:pass@host:1080` |

| Scope | Goes through the proxy |
| --- | --- |
| Container sites only (default) | Container pages, their link lists and DLC exports. Downloads use your own connection. |
| Everything | The above, plus host APIs and downloads. MEGA always connects directly. |

**Test proxy** compares your public IP address with and without the proxy. If they match, traffic isn't leaving through a VPN. The proxy password is never sent to the browser.

See [installation](installation.md#behind-a-vpn-or-proxy) for gluetun setups.

## FlareSolverr

For container pages behind a Cloudflare or DDoS-Guard *challenge*, run FlareSolverr and set its URL (e.g. `http://flaresolverr:8191`) under **Settings → Integrations**:

- Riparr only uses it when a page is actually challenged.
- It then reuses the clearance cookies until they expire.
- FlareSolverr can't solve real captchas (reCAPTCHA, hCaptcha, Turnstile); use Click'n'Load for those.
- **Test FlareSolverr** checks the connection.

## Host accounts

**Settings → Host accounts**:

| Host | Account | Effect |
| --- | --- | --- |
| pixeldrain | API key | Higher limits |
| gofile | Account token | Premium access. Leave empty to use a guest account. |
| gofile | Website token salt | Only needed if gofile changes its token salt and folders start failing (see [troubleshooting](troubleshooting.md#gofile-folders-fail)) |
| MEGA | None | Public links only; account login isn't supported |

Saved secrets are never shown again: leaving a field empty keeps the saved value, and the checkbox clears it. Credentials are stored unencrypted in `/config/riparr.db`.

## Security

- **Login:**
  - Riparr has a single login, created on first visit.
  - Sessions last 30 days, and changing the password signs out every other session.
  - After 10 failed logins from one address, logins from it are blocked for 15 minutes.
- **Settings → Security** has:
  - **Change password.**
  - **Disable authentication**, only for when Riparr sits behind another login such as an auth proxy.
  - **The API key**, with a button to regenerate it.
- **Port 9666 (Click'n'Load) has no login.** Anyone who can reach it can add links, so don't expose it beyond your LAN.
