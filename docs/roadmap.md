# Roadmap: v1 "Daily driver"

Goal: deploy Riparr next to Sonarr and Radarr and leave it running. You track **shows and movies** (not "containers"), files land where Plex or Jellyfin already look, the UI works on a phone, and upgrades never cost you your setup.

This plan comes from the owner's notes in `wip.txt` and the design reference in `references/images/`. It has five phases:

| Phase | Theme | Depends on |
| --- | --- | --- |
| [A](#phase-a--data-model-v1-and-upgrade-safety) | Data model v1 and upgrade safety | none |
| [B](#phase-b--brand-design-system-and-mockups) | Brand, design system and mockups | none (runs alongside A) |
| [C](#phase-c--ui-rebuild) | UI rebuild | A, B |
| [D](#phase-d--host-limits-stalls-and-auto-resume) | Host limits, stalls and auto-resume | A (UI parts land in C) |
| [E](#phase-e--packaging-and-deployment) | Packaging and deployment | A, C, D |

A comes first because the database schema should be final **before** the first real deployment. After that, every change is an automatic, tested migration.

---

## Phase A — Data model v1 and upgrade safety

> *"The word containers should be changed… the media or tv show or movie is the main object we are tracking using containers."*
> *"We should nail down the db models so once it is deployed we aren't having to tear down all the settings and containers."*

### A1. Titles and sources

Replace the container-centric model with the one the *arr apps use:

```
Root folder ──< Title (show | movie) ──< Source (container URL)
                       │
                       └──< Link ──< File        (as today, but owned by the title)
```

- **Title**: what you track.
  - Fields: type (show or movie), name, year, **TMDB id**, root folder, folder name, season folders on/off, monitored (on/off), status.
  - The UI calls these *Shows* and *Movies*, together the *Library*.
  - **Metadata from [TMDB](https://www.themoviedb.org/):** poster, overview and year, plus a show's season and episode counts, so a title knows how many episodes to expect. TMDB fields stay optional, so a title without a match still works.
- **Source**: a container page that supplies a title.
  - Fields: URL, password, poll interval, poll on/off, health.
  - **A title can have several sources**, e.g. the same show on mkvdrama *and* viewcrate. Mirror selection and de-duplication then work across all of them: one copy of each episode, from your preferred host, whichever site listed it.
- **Episode tracking:** parse season and episode from link metadata and file names (`S01E05`, already captured by the crate-api and DLC readers). That gives "12 of 16 episodes downloaded" per show.
- **Migrating existing data:** each existing container becomes a title with one source, keeping all its links, files and history.

### A2. *arr-style file management

> *"If I change /path/to/media … to my NAS Videos directory then … select Videos/Kdrama/Doctor X/<media content> for each container."*

- **Root folders** (Settings → Media Management), as in Sonarr and Radarr:
  - Add `/media/Kdrama`, `/media/Movies`, and so on, i.e. paths inside the mounted media volume.
  - Each shows free space, and each can be a default for shows or for movies.
- **A title's path** is the root folder plus the title's folder, which defaults to `Doctor X` or `Movie Name (2024)`. It's editable, with a **folder browser** (server-side directory picker, like the *arr apps' path picker, including "new folder").
- **Season folders**: a per-title on/off switch, like Sonarr's. The default for new shows is set in Media Management.
  - On: `Doctor X/Season 01/<file>`.
  - Off: `Doctor X/<file>`.

  Movies never use season folders.
- **File naming** inside that folder defaults to the original file name. New tokens (`{title}`, `{season}`, `{episode}`, `{year}`) allow custom names.
- **Media servers:** files appear in the title folder, ready for Plex or Jellyfin to scan. Optionally Riparr also triggers a library refresh (see A5).

### A3. Upgrade safety

- **Freeze the schema as v1** at the end of this phase. After that:
  - migrations are append-only;
  - every migration ships with an upgrade test that runs it on a copy of the previous schema with data;
  - there are no destructive changes without a migration step that carries the data over.
- **Automatic backup before migrating:** copy `riparr.db` to `/config/backups/riparr-v<old>-<date>.db` before any migration runs, keeping the last 5.
- **Settings and library export/import** (JSON) as a second safety net, and for moving servers.
- **A version number** shown in the UI and API, and in the image tag.

### A4. Settings reorganization (backend)

Group settings into categories that map to the new settings pages (Phase C):
- General
- Media Management
- Downloads
- Hosts
- Connections
- Notifications
- Security
- System

### A5. TMDB connection

**Settings → Metadata** takes your TMDB API key; a free account provides one. Posters are cached under `/config/MediaCover`, as the *arr apps do, so pages don't fetch from TMDB each time. TMDB's attribution goes in Settings → About, as its terms require.

### A6. Optional, if cheap here

A *Connections* entry for **Jellyfin or Plex library refresh** after new files land. This is quick once root folders exist.

**Done when:** existing data has migrated into titles and sources, a title can target `Videos/Kdrama/Doctor X/Season 01/…`, and the v1 schema is tagged with an upgrade test and automatic backup.

---

## Phase B — Brand, design system and mockups

> *"…modern design like this… I would also like some mockups or good icons, logos and such as currently we are just reusing default nextjs stuff."*

### B1. Brand

- **Logo**: a mark plus wordmark for "Riparr", in the spirit of the *arr icons but its own, as SVG. **Favicon, app icons and a PWA manifest**, so it installs to a phone's home screen.
- **An icon set:** one consistent library, e.g. Lucide, for navigation and actions.

### B2. Design system

Modelled on the reference:
- **Surfaces:** a light, neutral background, white cards, soft borders, rounded corners.
- **Type:** serif display headings, a clean sans-serif for the UI, tabular numbers for stats.
- **Colour:** restrained accent colours, with one per host (gofile, pixeldrain, MEGA) for charts and badges.
- **Themes:** light and dark built together, following the **system setting** by default, with a manual override.
- **Components:**
  - app shell (sidebar and top bar);
  - stat card with a trend;
  - title card with poster and progress;
  - status badges;
  - progress bars;
  - empty states;
  - forms;
  - drawers and sheets for mobile.

### B3. Mockups for approval, before building

Desktop and phone versions of:
1. **Dashboard:** active titles with status and episodes downloaded, plus overall stats. No activity feed (it moves to its own page).
2. **Library** (shows and movies), and **Add title**, with the root folder picker and sources.
3. **Title detail:** episodes, sources, files, history.
4. **Queue**, showing active, waiting-on-host (with countdown), stalled and queued.
5. **Settings**: one category page.

They'll be delivered as clickable HTML mockups to review and comment on. The reference's charts are a style guide, not a requirement: only stats that help you run Riparr stay.

**Done when:** the logo, icons and mockups are approved.

---

## Phase C — UI rebuild

> *"I want a side accordion menu style dashboard UI… all the navigation on the side… mobile responsive."*

### C1. App shell

- **Sidebar**, collapsible to icons, with accordion groups:
  - **Library** (Shows, Movies)
  - **Activity** (Queue, History)
  - **Settings** (its categories)
  - **System** (Status, Logs, Backups)
- Badge counts, e.g. "needs attention" items or queue size.
- **Top bar:** search (titles), a notifications bell for needs-attention items, and the user menu (log out).
- **On phones:** the sidebar becomes a slide-out drawer, tables become cards, and touch targets get bigger.

### C2. Pages

| Page | Contents |
| --- | --- |
| **Dashboard** | Stat cards (active titles, episodes downloaded in the last 7 days, data downloaded, current speed, free space), then the **active titles** as cards: TMDB poster, status, `12 / 16 episodes` (the expected count comes from TMDB), last new episode, source health. Download throughput over time. |
| **Shows / Movies** | Poster grid or list with filters (status, monitored) |
| **Add title** | Search TMDB → choose the match → root folder, season folders, sources (container URLs) → add. As in Sonarr's *Add Series*. |
| **Title detail** | Episodes (downloaded, downloading, waiting, missing), sources with their health and last check, files on disk, history; plus check now, pause and edit |
| **Queue** | See Phase D |
| **History** | The activity log that's on the dashboard today, with filters by title, level and date |
| **Settings** | One page per category (from A4) |
| **System** | Worker health, version, disk, backups (A3), logs |

### C3. Quality bar

- Works with keyboard and screen readers.
- No horizontal scrolling at phone widths.
- Live updates without flicker.
- Every page has a sensible empty state.

**Done when:** every current feature is reachable in the new UI, the old pages are removed, and it's checked on desktop and phone sizes.

---

## Phase D — Host limits, stalls and auto-resume

> *"The queue should hold all the active downloads and any stalled or inactive downloads due to bandwidth constraints from the providers like pixel/mega/gofile… downloads should automatically resume once the timeout from their host has ended."*

Most of the mechanics exist already: rate limits set a `retry_at`, and partial files resume with Range requests. This phase makes them complete and visible:

- **Host limit tracking:** when a host reports a limit (pixeldrain transfer cap, MEGA quota, gofile rate limit), record **a host-level cooldown** with its reset time. Pause *all* of that host's downloads, not just the one that hit it. Resume them automatically at reset, from where they stopped.
- **Stall detection:** if a download makes no progress for N minutes, abort it and resume it from its partial file. After repeated stalls, prefer another mirror.
- **Mid-download limits:** keep partial files when a host cuts a transfer for quota reasons, and resume after the cooldown rather than starting over.
- **Queue page** with clear sections:
  - **Downloading:** speed, ETA.
  - **Waiting on host:** "pixeldrain limit — resumes in 42 min", with a live countdown.
  - **Stalled / retrying:** the reason, the next attempt time, Retry now.
  - **Queued:** waiting for a slot.
- **Host status widget** for the dashboard and the System page: each host's state (OK, limited until a given time, errors) and data used today.
- **Notifications:** only when a host stays limited unusually long, or a title can't progress on any host.

**Done when:** a simulated host cooldown pauses and auto-resumes every affected download without losing progress, and the queue shows why each item is waiting.

---

## Phase E — Packaging and deployment

> *"Deployed in the same format as sonarr or radarr… in a docker compose file… Things like gluetun, flaresolverr are already deployed… I would just point to those by providing their http addresses."*

- **Local image builds, nothing published:** one `npm run release` script, run on the server:
  1. lint, typecheck, and the full test suite (including 7-Zip, inside the build container);
  2. build the image and tag it `riparr:<version>` and `riparr:latest`.

  Compose uses `riparr:latest`; rolling back means retagging the previous version.
- **A compose file in *arr style:** `PUID`, `PGID`, `TZ`, `/config` and media volumes, port 7676. No bundled VPN or FlareSolverr: Riparr points at **your existing services by URL**.
  - **FlareSolverr URL**, e.g. `http://flaresolverr:8191`.
  - **Proxy URL**, e.g. `http://gluetun:8888`.
  - **Networking:** a service's hostname only resolves when Riparr shares its Docker network. Otherwise use the host address. `127.0.0.1` inside Riparr's container isn't the host.
  - Settings → Connections tests each URL.
  - The current `docker-compose.vpn.yml` (starts its own gluetun) is no longer the main path. It may be removed, or kept as an example.
- **First-run wizard:** login, then root folders, connections (proxy, FlareSolverr) and preferred hosts, then add your first title.
- **Docs updated** for titles, sources, root folders and the new UI.
- **Shakedown:** deploy on the server and track 2–3 real titles for a week. Watch real downloads, host cooldowns, archive extraction, a new episode arriving, and an upgrade to the next version with data intact.

**Done when:** it's running from a locally built image on the server, an upgrade has been done in place, and a week has passed with no manual intervention needed.

---

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | What the tracked object is called | **Title**, shown as *Shows* and *Movies* inside a *Library* |
| 2 | Several sources per title | **Yes** |
| 3 | Media folders | **One media volume with root folders inside it** (e.g. NAS `Videos` → `/media`, root `/media/Kdrama`) |
| 4 | Show layout | **Season folders on/off per title**, with a default in Media Management (Sonarr-style) |
| 5 | Name | **Keep "Riparr"**; design its logo and icons |
| 6 | Theme | **Light and dark built together; follow the system setting by default** |
| 7 | Posters and metadata | **TMDB**, in v1, with the user's own API key |
| 8 | Image distribution | **Built locally on the server; not published** |
