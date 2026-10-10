# REST API

Base path: `/api/v1`. All requests and responses are JSON.

## Authentication

Send the API key from **Settings → Security** either way:

```sh
curl -H "X-Api-Key: $KEY" http://riparr:7676/api/v1/status
curl "http://riparr:7676/api/v1/status?apikey=$KEY"
```

A signed-in browser session also works. Without either you get `401 {"error": "Unauthorized"}`. With authentication disabled, no key is needed.

`GET /api/health` (outside `/v1`) needs no key. It returns `{"status": "ok"}`, or `503` with `worker_down` or `db_error`.

## Errors

| Status | Body |
| --- | --- |
| 400 | `{"error": "Invalid request", "details": {"field": ["message"]}}`, or a plain message such as `{"error": "Root folder not found"}` |
| 401 | `{"error": "Unauthorized"}` |
| 404 | `{"error": "Title not found"}`, `"Source not found"`, `"Link not found"`… |
| 409 | Conflicts, e.g. `{"error": "Already in the library as \"Doctor X\"", "details": {"id": 3}}` or `"That URL is already a source"` |
| 500 | `{"error": "Internal error"}` |

Timestamps are Unix milliseconds.

## Concepts

- **Title:** a show or movie you track. It lives in a **root folder**, in its own folder.
- **Source:** a container page (e.g. on mkvdrama or viewcrate) that lists download links for a title. A title can have several sources.
- **Link:** a host URL found on a source. Links are unique per title, so two sites listing the same file share one link.

## Status

### `GET /status`

Summary for dashboards such as Homepage or Homarr custom widgets.

```json
{
  "version": "0.1.0",
  "schema_version": 8,
  "worker": { "online": true, "last_seen_ms": 1200 },
  "titles": { "total": 6, "shows": 5, "movies": 1, "monitored": 5, "needs_attention": 0, "error": 0 },
  "links": { "downloading": 1, "queued": 5, "done": 120, "failed": 0, "offline": 2 },
  "speed_bps": 10485760,
  "disk": {
    "low": false,
    "root_folders": [{ "path": "/media/Kdrama", "free_bytes": 912345678901, "total_bytes": 4000000000000, "low": false }]
  }
}
```

`disk` is `null` until the worker's first free-space check.

## Titles

### `GET /titles`

Returns every title; `?type=show` or `?type=movie` filters by type. Each title:

```json
{
  "id": 3, "type": "show", "name": "Doctor X", "year": 2024, "tmdb_id": 12345,
  "overview": "…", "poster_path": "/abc.jpg", "total_episodes": 10,
  "root_folder_id": 1, "root_path": "/media/Kdrama", "folder": "Doctor X",
  "season_folders": true, "naming": "{filename}", "monitored": true,
  "status": "ok", "last_error": null,
  "source_count": 2, "link_count": 18, "done_count": 6,
  "episodes_done": 6, "episodes_seen": 9,
  "last_checked_at": 1791578179000, "last_changed_at": 1791578179000,
  "created_at": 1791578100000, "updated_at": 1791578100000
}
```

`status` rolls up the title's sources, worst first: `needs_attention`, then `error`, then `pending`, then `ok`. A paused title is `paused`.

### `POST /titles`

Creates a title, optionally together with its sources.

```sh
curl -H "X-Api-Key: $KEY" -H 'content-type: application/json' -d '{
  "type": "show", "name": "Doctor X", "year": 2024,
  "sources": [{ "url": "https://mkvdrama.net/c/…" }]
}' http://riparr:7676/api/v1/titles
```

| Field | Default |
| --- | --- |
| `type` | `show` (`show` or `movie`) |
| `name` | required |
| `year`, `tmdb_id`, `overview`, `poster_path`, `total_episodes` | none |
| `root_folder_id` | the default root folder for the type (Settings → Media Management), else the first one |
| `folder` | the name; movies with a year get `Name (Year)` |
| `season_folders` | the Media Management default (shows only; movies never use them) |
| `naming` | `{filename}` |
| `monitored` | `true` |
| `sources` | `[]`; each entry is `{url, password?, poll_interval_min? (60), enabled? (true), poll? (true)}` |

Returns `201` with the title and its `sources`. Returns `409` if the TMDB id is already in the library, or if a source URL already belongs to another title.

### `GET /titles/{id}`

Returns the title plus its `sources` and `links` (each link with its status, host, `label`, `episode`, `quality`, `size_text`, and progress fields).

### `PATCH /titles/{id}`

Partial update: send only the fields to change. Setting `monitored: false` also stops the title's running downloads. Changing the folder only affects future downloads.

### `DELETE /titles/{id}`

Removes the title, its sources and its history from Riparr. Files already downloaded stay on disk. Returns `204`.

### `POST /titles/{id}/check`

Checks every polled source of the title now. Returns `202`, or `409` if the title is paused.

### `POST /titles/{id}/links`

Adds host links by hand, as if a source had listed them.

```json
{ "urls": ["https://pixeldrain.com/u/abc"], "archive_password": "optional" }
```

Takes 1–500 http(s) URLs. Returns `201 {"received": 1, "added": 1}`; links the title already has aren't added again.

### `GET /titles/{id}/poster`

The title's TMDB poster image, downloaded once and cached in `/config/MediaCover`. Returns `404` when the title has no TMDB poster.

## Sources

### `GET /titles/{id}/sources` · `POST /titles/{id}/sources`

Lists or adds sources. The body is `{url, password?, poll_interval_min?, enabled?, poll?}`. Passwords are never returned; `has_password` says whether one is set. A new polled source is checked right away.

### `PATCH /sources/{id}`

Partial update. Leaving out `password` keeps the saved one, and `""` clears it.

### `DELETE /sources/{id}`

Removes the source. Links it found stay with the title. Returns `204`.

### `POST /sources/{id}/check`

Checks this source now. Returns `202`, or `409` if it's disabled, not polled, or its title is paused.

## Root folders

### `GET /rootfolders`

```json
[{ "id": 1, "path": "/media/Kdrama", "free_bytes": 912345678901, "total_bytes": 4000000000000, "accessible": true, "title_count": 4 }]
```

### `POST /rootfolders`

Adds a root folder: `{"path": "/media/Kdrama"}`. The path must be absolute, exist inside Riparr's container, and be writable by `PUID`/`PGID`. Otherwise you get `400` with the reason.

### `DELETE /rootfolders/{id}`

Removes a root folder. Returns `409` while titles still use it.

### `GET /filesystem?path=/media`

The sub-folders of `path` (default `/`), for picking root folders. Hidden folders are skipped.

```json
{ "path": "/media", "parent": "/", "dirs": [{ "name": "Kdrama", "path": "/media/Kdrama" }] }
```

## Queue and links

### `GET /queue`

```json
{ "active": [ /* links new, resolving, queued or downloading */ ], "recent": [ /* last 50 done, failed, offline or mirror */ ] }
```

Each link has the fields shown in `GET /titles/{id}`, plus `title_name`.

### `POST /links/{id}/retry`

Clears the link's attempts and backoff, and puts it back in the queue. Returns `202`.

### `POST /links/{id}/ignore`

Marks the link ignored and stops its download if one is running. Returns `{"ok": true}`.
