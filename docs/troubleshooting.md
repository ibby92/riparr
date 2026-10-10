# Troubleshooting

Start with the **dashboard** (titles that need a look show their reason), the **Queue** (what's waiting and why) and the title's **History** tab. Most problems explain themselves there.

- [Source messages](#source-messages)
- [Link and download messages](#link-and-download-messages)
- [Archives](#archives)
- [System](#system)

## Source messages

### "Blocked by an anti-bot challenge (Cloudflare/DDoS-Guard) — configure FlareSolverr in Settings…"

The site served a Cloudflare or DDoS-Guard challenge page instead of the source page.

- Set up [FlareSolverr](user-guide.md#flaresolverr) and Riparr will retry through it.
- If you see **"Still blocked … after going through FlareSolverr"**, the challenge needs a person. Open the page in your browser and send the links with [Click'n'Load](user-guide.md#clicknload).

### "Captcha required — solve it in a browser and use Click'n'Load"

The page shows a real captcha (reCAPTCHA, hCaptcha, Turnstile), which neither Riparr nor FlareSolverr can solve.

- Solve it in your browser and click Click'n'Load. The links land in this source's title.
- Untick **Check the page for new links** on the source so it stops trying.

### "Container is password-protected — set its password" / "Container rejected the password"

Set or correct the password on the source (title page → **Sources** → **Manage**).

### "This page no longer exists on the site (HTTP 404/410)"

The source page was removed. Replace its URL with the new page, or remove the source. Riparr stops checking it until you do.

### "Container site rate-limited us (retry in …s)"

This is informational, not an error. The site asked Riparr to slow down, so the next check happens after the time it gave. If you see it often, increase the source's check interval; many container sites limit repeat visits.

### Fetch errors / "HTTP 403" / the site works in your browser but not in Riparr

Some networks block specific sites, often by filtering on the site name during the secure connection setup.

Symptoms:
- The check fails with a connection or TLS error, such as `ERR_SSL_WRONG_VERSION_NUMBER`.
- Other sites on the same host work.

Fixes:
- Route container sites through a VPN with the [proxy setting](user-guide.md#proxy-and-vpn), e.g. your gluetun's HTTP proxy. **Test proxy** confirms traffic leaves through the VPN.
- Or allow the site in whatever filters it: your router's security or parental-control features, your firewall, or your DNS filter.

Changing DNS servers doesn't help when the filtering happens on the connection itself.

### "DLC: …"

The page's only link source was a DLC file, and it couldn't be decrypted.

- **"JDownloader's DLC service is unreachable"**: `service.jdownloader.org` is down or blocked from your network. Riparr retries on the next check.
- **"…rejected this container (expired or corrupted)"**: download a fresh `.dlc` in your browser and import it on the title page, or use Click'n'Load.

### "Container's DLC export is unavailable"

A viewcrate-style site didn't offer its DLC export. Check the page in a browser; the page may have been removed or emptied.

### "Found Click'n'Load data but couldn't decrypt it"

The page's Click'n'Load data is in an unexpected format. Use the Click'n'Load button in your browser instead. If this happens on every page from a site, the site has probably changed and Riparr needs updating.

### The source is OK but finds no links

- **Check the page in a browser.** It may genuinely be empty, or show its links only after a login.
- **Only unsupported hosts:** if the page's links are all on hosts Riparr doesn't support, they show as *ignored*.
- **The site may have changed its page format.** Riparr reads several kinds of pages (see [How polling works](user-guide.md#how-polling-works)), but sites change. As a workaround, paste the links on the title page or use Click'n'Load.

## Link and download messages

### "Riparr can't download from … yet"

That host isn't supported; only gofile, pixeldrain and MEGA are. The link is set aside and not retried. If the same file exists on a supported host, that copy is used.

### A copy shows *standby*

Another host higher in your **preferred hosts** list has the same file. This copy is a fallback and takes over automatically if needed.

### "Rate limited (…)" / "pixeldrain daily transfer limit" / "Waiting on <host>"

The host is throttling you.
- A limit of 2 minutes or more puts the whole host in **cooldown**: the Queue shows *Waiting on <host>* with a countdown, and the sidebar shows the host as limited. Every download on it pauses and resumes where it stopped when the limit ends. **Try now** ends the cooldown early (if the host still refuses, it starts again).
- If another host has the file, that copy is used meanwhile.
- Shorter limits only make that link wait.
- A pixeldrain API key, or a gofile premium token (**Settings → Hosts**), raises the limits.

### "…(captcha or premium API key needed)" (pixeldrain)

pixeldrain wants a captcha for this file, usually because it's very popular or you've hit a transfer limit. Add a pixeldrain API key, or let another host's copy be used.

### gofile folders fail

**"gofile: API rejected the request (website-token salt may be outdated…)"**

gofile's API needs a token that's computed from a secret value gofile changes every few months.

- **Short term:** add a gofile premium token in **Settings → Hosts**, or rely on another host's copy.
- **Proper fix:** when the new value is known (projects like gofile-downloader publish it), enter it as **Website token salt** under the gofile account.

Other gofile messages:

| Message | Fix |
| --- | --- |
| "folder password required" / "wrong folder password" | Set the source's password |
| "folder is private" | Only the owner can download it |
| "content not found or deleted" | The link is offline |

### "mega: …"

| Message | Meaning |
| --- | --- |
| "link has no decryption key" / "bad decryption key" | The link is incomplete. MEGA links need the part after `#`. |
| Rate limited (transfer quota) | MEGA's free quota is used up. The link waits for the time MEGA reports. |

MEGA account login isn't supported yet.

### "Size mismatch…" / "…checksum mismatch…"

The downloaded data didn't match what the host reported. Riparr retries; a checksum failure starts the file over. Repeated mismatches usually mean the host is serving a broken file, and another host's copy will be used.

### "Stalled: No data for …s"

The download stopped receiving data. Riparr restarts it from where it stopped (it shows under **Retrying** in the Queue). Frequent stalls point at the host or your connection; raise or turn off **Stall timeout** in **Settings → Downloads** if a slow host trips it.

### Downloads don't start

- **Disk space:** the title's root folder is below **Keep free (GB)**. The dashboard and **System → Status** show free space per root folder. Free some space or lower the threshold.
- **Paused title:** the title isn't monitored.
- **Host cooldown:** the Queue shows *Waiting on <host>*.
- **Waiting for selection:** Riparr chooses between mirrors only once all of a title's fresh links are resolved. This normally takes seconds.
- **Retry delay:** the Queue lists it under **Retrying** with the next attempt.

### "A root folder isn't reachable" / files have nowhere to go

The root folder's path doesn't exist inside the container or isn't writable by `PUID`:`PGID`. Check the volume mount in your compose file and the folder's permissions; **System → Status** and **Settings → Media Management** show each root folder's state. After an upgrade from a pre-v1 install, keep the old `/downloads` mount until you've moved those titles to new root folders.

## Archives

| Archive status | Fix |
| --- | --- |
| *incomplete* | Parts are missing. Extraction runs again when more of the title's downloads finish. |
| *wrong password* | Set the password on the source. Saving it retries the archive, or use **Retry failed** under **Files → Archives** on the title page. |
| *failed* | Read the error shown. Archives with links pointing outside their folder are deliberately refused. |

**"7-Zip not found; archives won't be extracted"** only happens outside the Docker image. Install `7z` with RAR support (`p7zip-full` + `p7zip-rar` on Debian) or set `RIPARR_7Z`.

## System

### The sidebar says the worker is offline

The background worker isn't running. `docker logs riparr` usually shows why. The container restarts itself if either process exits, and the Docker health check reports it as unhealthy.

### Locked out

Start with `RIPARR_AUTH=none`, set a new password under **Settings → Security**, then remove the variable and restart.

### Click'n'Load does nothing

- **Settings → Media Management:** the Click'n'Load listener must be on. Restart Riparr after changing it.
- **Port:** 9666 must be published.
- **Browser on another machine:** it sends to its own `127.0.0.1:9666`. Forward the port or use a userscript; see [Click'n'Load from another machine](user-guide.md#using-clicknload-from-another-machine).

### Notifications don't arrive

Use **Send test notification** in **Settings → Notifications**. It shows each target's error. Also check that the event is ticked.

### Proxy test says "IP is unchanged"

The proxy works, but traffic isn't leaving through a VPN. Check that gluetun is connected (`docker logs gluetun`).
