# User guide

- [Concepts](#concepts)
- [Root folders](#root-folders)
- [Titles](#titles)
- [Calendar](#calendar)
- [Sources and how polling works](#sources-and-how-polling-works)
- [Click'n'Load](#clicknload)
- [DLC files and adding links by hand](#dlc-files-and-adding-links-by-hand)
- [Preferred hosts and mirrors](#preferred-hosts-and-mirrors)
- [The queue and host limits](#the-queue-and-host-limits)
- [Archives](#archives)
- [History and notifications](#history-and-notifications)
- [Proxy and VPN](#proxy-and-vpn)
- [FlareSolverr](#flaresolverr)
- [Host accounts](#host-accounts)
- [Themes](#themes)
- [Security](#security)

## Concepts

| Term | Meaning |
| --- | --- |
| **Root folder** | A top-level library folder, as in Sonarr and Radarr, e.g. `/media/Kdrama` or `/media/Movies`. |
| **Title** | A show or a movie you track. It lives in its own folder under a root folder. |
| **Source** | A page that lists download links for a title, such as a link protector (mkvdrama, viewcrate…) or a paste page. A title can have several sources. Riparr watches them for new content. |
| **Link** | A host URL found on a source, e.g. `https://gofile.io/d/abc`. One link can hold several files (a folder). |
| **File** | One downloadable file behind a link. |
| **Host** | The service the file is stored on: gofile, pixeldrain or MEGA. Other hosts are recognized but set aside. |
| **Mirror** | The same file offered on several hosts. Riparr downloads one copy. |

## Root folders

**Settings → Media Management** lists your root folders with their free space. Add one by typing its path or with **Browse**, which lists the folders mounted in the container. A root folder must exist and be writable by `PUID`:`PGID`. A root folder that titles still use can't be removed.

The same page sets the defaults for new titles:

- the root folder for new shows and for new movies;
- whether new shows use season folders.

## Titles

**Add title** (top of the dashboard, Shows or Movies) works in two steps:

1. **Find it on TMDB.** Type a name. Pick a result to fill in the type, name, year, poster and episode count. Without a TMDB key, use **Add without TMDB** and enter the name yourself.
2. **Where it goes.**

   | Field | Notes |
   | --- | --- |
   | Root folder | Defaults from Media Management |
   | Folder | `Doctor X` for shows, `Parasite (2019)` for movies. Editable. |
   | Season folders | Shows only. On: `Doctor X/Season 01/<file>`; off: `Doctor X/<file>`. |
   | Naming | The file name inside the folder (see below). Default `{filename}`, the original name. |
   | Monitor | Off pauses the title: no checks and no new downloads. |
   | Sources | Paste one or more source pages, with a password and check interval each. |

   A preview shows exactly where the first episode will be saved.

The title page shows progress (downloaded, in progress, waiting, missing) and has four tabs:

- **Episodes:** each episode by season, with status, host and size. "Also on gofile" means a mirror exists. Movies show their files instead.
- **Sources:** each source page with its last check, next check, links found and status, plus every link with **Retry** and **Ignore**. **Edit** changes a source's address, password, check interval and whether its page is read. On a source that needs attention the button reads **Replace URL**. The same list is on the title's **Edit** page.
- **Files:** every video file in the title's folder, by the last scan: which host Riparr downloaded it from, or *Added by hand*. **Rescan folder** scans it now, and the bin icon [deletes a file](#deleting-files). Below that, the archives Riparr extracted.
- **History:** this title's activity.

**Check now** checks every source of the title straight away. **Pause** / **Resume** toggles monitoring. **Edit** changes the title's settings; moving a title to another root folder or folder only affects files downloaded afterwards. **Delete title** (at the bottom of Edit) removes the title, its sources and its history from Riparr; files already downloaded stay on disk.

### Episodes

Riparr reads the season and episode from the source's metadata when it has them, otherwise from the file name: `S01E05`, `1x05`, or an episode marker on its own such as `E05`, `EP05` or `Episode 5` (season 1 is assumed). Files without a marker are listed under **Other files**. Shows with season folders put a file in `Season NN` only when its season is known.

An episode that no source offers on gofile, pixeldrain or MEGA shows as *Missing* with the hosts it is on, e.g. "Only on hosts Riparr can't download from: send.now, vikingfile.com". It's picked up if a supported copy appears later.

### The folder is the source of truth

What's on disk is what's in the title's folder. Riparr scans it for video files and every view (episodes, the Files tab, library and dashboard cards, the calendar) counts an episode as on disk only when the scan found a file for it. Riparr's own downloads are added the moment they finish, and extracted videos once an archive is unpacked. Archives themselves aren't scanned, since they're usually deleted after extraction; a finished archive download still counts for its episode.

The folder is scanned when a title is added or edited, when a check finds new links, after an extraction, and every 30 minutes. **Files → Rescan folder** scans it right away and updates the page. Hidden files and folders (such as `.riparr-partial`) are skipped. If the root folder itself is unreachable (e.g. an unmounted share), the last scan is kept so episodes don't suddenly look missing.

### Episodes already in the folder

Video files Riparr didn't download itself, such as episodes you had before adding the title or files you copied in by hand, count as on disk too. Riparr reads the episode number from the file name the same way (a bare `EP05` inside a `Season 02` folder is S02E05). Those episodes show as **In folder** and aren't downloaded again, even if a source offers them under a different name. For a movie, any video file in its folder counts.

### Deleting files

The bin icon on **Files** deletes a video file from the folder. Riparr asks whether to **Download it again**:

- **Ticked:** the episode goes back in the queue and is fetched from the preferred host.
- **Not ticked:** the episode shows as *Deleted* and Riparr won't download it again, from any host, until you click **Download again** on the episode (or the movie's **Download** card).

If you delete one of Riparr's downloads outside Riparr (in a file manager, or Plex), the next scan notices it's gone and downloads the episode again, unless another file in the folder still has that episode. Both kinds of delete appear in **History** under *Library changes*.

### Naming templates

The naming template sets the file's path inside the title's folder (and season folder). A `/` creates sub-folders.

| Token | Value |
| --- | --- |
| `{title}` | Show or movie name |
| `{season}`, `{episode}` | 2 digits, empty if unknown |
| `{year}` | Release year of the title (download year if unknown) |
| `{filename}` | File name with extension |
| `{name}` | File name without extension |
| `{ext}` | Extension without the dot |
| `{dir}` | Sub-folder inside a remote folder (empty for single files) |
| `{host}` | Host id, e.g. `pixeldrain` |
| `{date}`, `{month}` | Download date (`YYYY-MM-DD`, `MM`) |

The template must contain `{filename}` or `{name}`. For example, `{title} - S{season}E{episode}.{ext}` gives `Doctor X - S01E05.mkv`. Every path segment is cleaned (characters that are invalid on Windows/SMB are removed, reserved names like `CON` are prefixed), and nothing can escape the root folder.

If a different file already exists at the destination, the new one is saved as `name (1).ext`. An identical file (same size) is skipped.

### Archiving a title

When you're done with a title (it finished airing, or you've stopped following it) but don't want to delete it, **Archive** it from its page:

- Riparr stops checking its sources, downloading, and scanning its folder, and any download in progress stops.
- Its settings, sources, files on disk and history are all kept, and stay viewable: the title page, **Edit**, **Files** and **History** work as before.
- It leaves the dashboard, the counts and badges, and the default Shows/Movies views. Find it under the **Archived** filter (or by searching).
- **Unarchive** on its page brings it back, monitored, and checks its sources straight away.

Deleting a title, by contrast, removes its sources, links and file records from Riparr (files on disk stay, and its History entries remain without a link to it).

### Title status

A title's status comes from its sources:

| Status | Meaning |
| --- | --- |
| Healthy | Every source's last check succeeded, even if it found nothing new |
| Pending | A source hasn't been checked yet |
| Needs attention | A person has to step in: a captcha, a password, a page that's gone, a challenge FlareSolverr couldn't pass, or a failed DLC. The reason is shown on the title and the dashboard. |
| Error | A source's last check failed, e.g. the site was down. Riparr retries automatically with growing delays (up to 6 hours between checks). |
| Paused | The title isn't monitored |

Cards and the title page also show what's happening now: *Downloading*, or *Waiting on pixeldrain, resumes in 41m*.

## Calendar

**Library → Calendar** shows when your shows' episodes and your movies come out, using TMDB's schedule for every title matched on TMDB (archived titles are left out; paused ones are shown faded). Each entry is marked with what Riparr has of it:

| Mark | Meaning |
| --- | --- |
| Downloaded | Downloaded, or already in the title's folder |
| Downloading / On its way | Downloading now, or found on a source and queued |
| Missing | Aired, but not on disk yet |
| Airs today | Out today, not on disk yet |
| Upcoming | Not out yet |

Switch between **Week** (posters and episode names) and **Month**, and step with ← **Today** →. On a phone, either view becomes a day-by-day list. Days follow the time zone in Settings → General. Riparr reads each title's schedule from TMDB when it's added or re-matched, then twice a day, so new seasons and changed dates show up on their own (and the title's episode count stays current). Titles without a TMDB match aren't on the calendar; match them with **Edit**.

## Sources and how polling works

Each source has a URL, an optional password (for the page, gofile folder passwords and archives), a check interval (15 minutes to once a day; default every hour), and **Check the page for new links**. Turn that off for captcha-protected pages: links then arrive only through [Click'n'Load](#clicknload) or by hand. Container sites rate-limit frequent visits, so keep the interval generous.

Every check fetches the page **as it is now**, reads all the links it currently offers, and queues only links the title hasn't seen before. When a site adds an episode, the next check picks it up. Links that disappear from a page are kept, not deleted. Two sources listing the same host link share it, so nothing is downloaded twice.

Riparr reads a page in this order and uses the first approach that finds links:

1. **Script-loaded link lists**:
   - *mkvdrama-style:* the page loads an encrypted link list with JavaScript. Riparr fetches and decrypts it the same way, without a browser.
   - *viewcrate-style:* the page offers a **DLC export** for download managers. Riparr fetches a fresh copy each check. viewcrate's on-page links go through a resolver that refuses automated access, so Riparr doesn't use that.

   Both keep each link's **release name, episode, quality and size**.
2. **Click'n'Load data** embedded in the page.
3. **The page's `.dlc` file**, if it has one.
4. **Plain host links** anywhere in the page.

If a site answers "too many requests", Riparr waits as long as the site asks before checking again. This doesn't count as an error. A page that returns 404 or 410 is gone: the source needs attention until you replace or remove it.

**filecrypt** containers (`filecrypt.cc/Container/…`, also its mirror domains) can be sources:

- **Without a captcha**, Riparr reads the container's Click'n'Load buttons on every check, like any other page.
- **With a captcha** (a "Security Check — confirm you're not a robot" page), Riparr can't read it by itself, and doesn't try to get around the check. The source needs attention with a message saying so. Turn off **Check the page for new links** on the source, then when you want new episodes: open the container in your browser, pass the check and click **Click'n'Load**. The links are filed under the title that has this container as a source, whichever filecrypt domain or spelling of the address your browser uses. Downloading the container's `.dlc` and importing it on the title page works too.

Some sites hand out **temporary links**: mkvdrama's `/c/…` download pages expire after about a day, and a new one is only issued on the show's page, behind a check meant for people. When a link has expired, the source needs attention with "This link has expired on the site". Open the show's page in your browser, copy the new download-page link and paste it with **Replace URL**. The source keeps its links and history, and is checked again right away.

Links on hosts Riparr can't download from (e.g. send.now, vikingfile, fileditch) are listed as *ignored* with "Riparr can't download from … yet". They aren't failures and don't trigger notifications.

## Click'n'Load

Riparr speaks JDownloader's Click'n'Load protocol on port **9666** (turn it on or off in **Settings → Media Management**). When you click a page's Click'n'Load button in your browser, the links go to Riparr:

- **From a page that's already a source:** the links go to that source's title.
- **From any other page:** Riparr creates a new show in the default show root folder, with that page as a source that isn't checked automatically. Rename it, match it on TMDB or move it with **Edit**.
- **With no source page:** the links go to a shared *Click'n'Load* title.
- **Archive passwords** sent along with the links are kept and used when extracting.

This is how to handle **captcha-protected** pages: solve the captcha in your browser, then click Click'n'Load.

Supported endpoints: `/flash/addcrypted2` (encrypted CNL2), `/flash/add` (plain list) and `/flash/addcrypted` (a DLC container).

### Using Click'n'Load from another machine

Click'n'Load buttons send links to `127.0.0.1:9666`, which is the computer running the browser. If Riparr runs on a server, forward that port to it:

```sh
ssh -N -L 9666:localhost:9666 you@server
```

Alternatively, use a userscript that redirects Click'n'Load requests to your server, such as *Click'n'Load Interceptor*.

## DLC files and adding links by hand

On a title's page, **Add links by hand or import a .dlc** offers two ways in:

- **Paste links:** paste host URLs, separated by whitespace, optionally with an archive password. Anything that isn't a link is ignored, and duplicates are skipped.
- **Import a .dlc file:** upload a DLC container that you downloaded in your browser. This works even if Riparr itself can't reach the site.

DLC files are decrypted the way JDownloader and pyLoad do it, which takes one request to **JDownloader's DLC service** (`service.jdownloader.org`). If that service is down, DLC import fails with a clear message, and polled pages fall back to their plain links.

Pushed or uploaded DLC and Click'n'Load data is a snapshot of that moment. To keep receiving new content, give the title a source that's checked.

## Preferred hosts and mirrors

Pages usually offer each file on several hosts. Under **Settings → Downloads → Preferred hosts**, order the hosts with the ↑/↓ buttons. The default order is gofile, pixeldrain, MEGA.

How Riparr picks a copy:

1. It first **resolves** every new link, asking each host which files the link holds, without downloading.
2. When all of a title's fresh links are resolved (across all its sources), it groups identical files (same name, ignoring case, and same size) across hosts.
3. Each file is downloaded from the highest-ranked host that has it. The other copies wait on **standby**.

Fallback is automatic:

| Situation | What happens |
| --- | --- |
| Preferred copy is removed (offline) | Next host's copy is used |
| Preferred host errors | Next host's copy is used while the preferred link waits for its retry |
| Preferred host is rate-limited or in cooldown | Next host's copy is used instead of waiting out the limit |
| Preferred link gives up (5 attempts) | Its files are released for good, and other copies are used |

A link whose files all came from other hosts ends as **mirror**.

Different qualities (720p and 1080p) are different files, so both are downloaded if the page lists both.

## The queue and host limits

**Activity → Queue** groups everything that isn't finished:

- **Host strip:** each host's state (OK, Limited with a countdown, or Errors) and today's transfer.
- **Downloading:** progress, speed and time left.
- **Waiting on a host:** downloads paused by a host-wide limit, with when it ends and **Try now**.
- **Retrying:** downloads that failed and will try again, with the reason, the next attempt and **Retry now**. A *Stalled* download received no data for the stall timeout and is restarted from where it stopped.
- **Queued:** waiting for a free download slot.
- **Standby copies:** mirrors kept in reserve.

The sidebar shows the same host states and free space on every page. The dashboard shows what's downloading and a **Downloads** card:

- **This week:** data transferred in the last 7 days, the change against the week before, how many episodes and titles came in, and each host's share, beside a 14-day trend line.
- **Arrivals:** one column per day (the last 14, or 7 on a phone) listing the episodes that finished, edged in their host's colour. Click one to open its title.

Data figures everywhere (dashboard, sidebar, Queue) count bytes actually transferred from each host per day, in your time zone. So they include retried or restarted downloads and titles you've since deleted, and can be larger than the files you kept. Episodes found already in a folder aren't counted as downloads.

### Host cooldowns

When a host reports a limit of 2 minutes or more (pixeldrain's daily transfer limit, MEGA's transfer quota, gofile rate limits), Riparr pauses **every** download on that host until it ends, instead of letting each link run into the same wall. Meanwhile other hosts' copies are used. When the cooldown ends, downloads resume where they stopped. **Try now** ends a cooldown early. Shorter waits affect only that link. You can be notified about long limits (*Needs attention* event).

### Retries

- **Ordinary errors** are retried 5 times, waiting 1, 2, 4 and 8 minutes between attempts (capped at 6 hours).
- **Rate limits** wait as long as the host asks and don't count as an attempt.
- **Removed files** aren't retried.
- **Downloads resume** where they stopped, after a restart, a pause, a stall or a cooldown, when the host supports it.
- **Checks:** size is checked when the host reports it. A checksum is checked when the host provides one (pixeldrain single files, gofile).

### Limits

Configured under **Settings → Downloads**:

| Limit | Applies to |
| --- | --- |
| Simultaneous downloads | All downloads, across hosts |
| Per host | Downloads from a single host |
| Speed limit | Each download separately, not the total |
| Keep free (GB) | Checked per root folder. New downloads into a folder wait while it has less free space than this. Running downloads finish, and you're notified once. |
| Stall timeout | Minutes without data before a download is restarted |

## Archives

Once all of a title's downloads have settled, Riparr extracts finished archives in place. It handles zip, 7z and RAR (including RAR5), in single or multi-part sets.

- **Passwords tried, in order:** no password, then the passwords of the title's sources, then any password that arrived with Click'n'Load or with pasted links.
- **Missing parts:** a set with parts missing is extracted after more parts arrive.
- **Wrong or missing password:** a set that needs a password raises *needs attention*. Set the password on the source; saving it retries the archive. **Files → Archives** on the title page also has **Retry failed**.
- **Deleting archives** after a successful extraction is optional (**Settings → Downloads**).
- **Path traversal:** extracted files can't escape the folder, and symlinks are dropped.

## History and notifications

**Activity → History** is your activity feed: what Riparr downloaded, what changed in your library, and anything that needed you. It isn't the technical log (that's [System → Logs](#logs-and-debug-logging)), so worker restarts, retries and rescans don't appear here.

- **Summary** for the period: files downloaded and for how many titles, data, new links found, and problems.
- **Show:** *Everything*, *Downloads* (downloads, files already in the folder, new links, extracted archives), *Library changes* (titles and sources you added, edited, paused or removed, links you retried or ignored, settings changes with old → new values, files deleted or found missing from a folder) or *Problems* (sources needing attention or failing repeatedly, failed downloads, files with no working copy, archive problems, host limits, low disk space, and when those ended).
- **Rows** read as sentences with the title's poster, the episode, host and size, e.g. "Downloaded S01E16 of Irreplaceable · pixeldrain · 791 MB". A burst of downloads of one title becomes one row ("Downloaded 3 episodes of Irreplaceable (S01E14–E16)") with the files listed underneath.
- Filter by title and period. Each title page's **History** tab shows the same feed for that title.

Entries are kept for 30 days, and stay after their title is deleted.

### Logs and debug logging

**System → Logs** shows the full log for troubleshooting: every level, the area of Riparr each entry comes from (source checks, mirror selection, downloads, hosts, folder scans, extraction…), and the title. Filter by minimum level, area and title, or search the messages.

| Level | Used for |
| --- | --- |
| Debug | Step-by-step detail: each page request and its HTTP status, which reader found the links, how a link resolved, which copy was chosen and why, where each file went and how fast, host limits starting and ending. Off by default. |
| Info | What happened: titles and sources added or changed, links found, files downloaded or extracted, settings changed, sign-ins. |
| Warning | Something went wrong and Riparr is handling it (a retry, a host limit, a check that will be retried), or a source needs attention. |
| Error | Something failed for good or keeps failing: a download gave up, an archive can't be extracted, a source failed 3 checks in a row. |

To troubleshoot, click **Turn on debug logging** on System → Logs, reproduce the problem (for example **Check now** on the title), then read the entries with the level set to *Everything*. Debug entries are kept for 3 days; turn it off again when you're done. The same lines are written to the container output, so `docker logs riparr` shows them too. Logs never contain passwords, tokens, API keys or proxy credentials.

**Settings → Notifications**:

- **Webhook URL:** receives JSON:
  ```json
  { "event": "download_done", "title": "Riparr: Download finished", "message": "...", "media": { "id": 1, "name": "..." }, "timestamp": "..." }
  ```
  Discord webhook URLs are detected and sent as Discord messages.
- **Apprise API URL**, e.g. `http://apprise:8000/notify/riparr`, which fans out to ntfy, Gotify, Telegram, email and others.
- **Events:** new links found, download finished, download failed, needs attention.

**Send test notification** uses the saved settings. The bell in the top bar shows titles that need attention.

## Proxy and VPN

If your network blocks a container site, Riparr can reach it through a proxy. Set it under **Settings → Connections → Proxy**, or with `RIPARR_PROXY_URL`; the setting wins if both are set.

| Format | Example |
| --- | --- |
| HTTP proxy | `http://gluetun:8888` |
| HTTP proxy with login | `http://user:pass@host:8888` |
| SOCKS5 | `socks5://user:pass@host:1080` |

| Scope | Goes through the proxy |
| --- | --- |
| Container sites only (default) | Source pages, their link lists and DLC exports. Downloads use your own connection. |
| Everything | The above, plus host APIs and downloads. MEGA always connects directly. |

**Test proxy** compares your public IP address with and without the proxy. If they match, traffic isn't leaving through a VPN. The proxy password is never sent to the browser.

See [installation](installation.md#using-your-existing-gluetun-and-flaresolverr) for gluetun setups.

## FlareSolverr

For source pages behind a Cloudflare or DDoS-Guard *challenge*, run FlareSolverr and set its URL (e.g. `http://flaresolverr:8191`) under **Settings → Connections**:

- Riparr only uses it when a page is actually challenged.
- It then reuses the clearance cookies until they expire.
- FlareSolverr can't solve real captchas (reCAPTCHA, hCaptcha, Turnstile); use Click'n'Load for those.
- **Test FlareSolverr** checks the connection.

## Host accounts

**Settings → Hosts**:

| Host | Account | Effect |
| --- | --- | --- |
| pixeldrain | API key | Higher limits |
| gofile | Account token | Premium access. Leave empty to use a guest account. |
| gofile | Website token salt | Normally filled in by **Refresh salt** (or the automatic option); type a value only to override it (see [troubleshooting](troubleshooting.md#gofile-folders-fail)) |
| MEGA | None | Public links only; account login isn't supported |

Saved secrets are never shown again: leaving a field empty keeps the saved value, and the checkbox clears it. Credentials are stored unencrypted in `/config/riparr.db`.

## Time zone

**Settings → General → Time zone** sets the zone every time and day in Riparr is shown in: History and Logs, the dashboard's days, host limits ("resumes at 21:30"), backups, and the `{date}` naming token. **Use this browser's zone** fills in your device's zone. By default Riparr uses the container's `TZ` variable (UTC if it isn't set). Changing it doesn't rewrite anything recorded; times are just shown in the new zone.

## Themes

The top bar switches between **System** (the default, following your device), **Light** and **Dark**. The choice is remembered per browser. The sidebar can collapse to icons (the button next to the logo); on phones it opens from the menu button. Press `/` to jump to the title search.

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
