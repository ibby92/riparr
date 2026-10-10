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
| 400 | `{"error": "Invalid request", "details": {"field": ["message"]}}`, or `{"error": "Body must be a JSON object"}` |
| 401 | `{"error": "Unauthorized"}` |
| 404 | `{"error": "Container not found"}` / `{"error": "Link not found"}` |
| 409 | `{"error": "Already watched as \"Name\"", "details": {"id": 3}}`, or `{"error": "Container is paused or not polled"}` |
| 500 | `{"error": "Internal error"}` |

Timestamps are Unix milliseconds.

## Endpoints

### `GET /status`

Summary for dashboards, e.g. Homepage or Homarr custom widgets.

```json
{
  "version": "0.1.0",
  "worker": { "online": true, "last_seen_ms": 1200 },
  "containers": { "total": 4, "enabled": 3, "needs_attention": 0, "error": 0 },
  "links": { "downloading": 1, "queued": 5, "done": 120, "failed": 0, "offline": 2 },
  "speed_bps": 10485760,
  "disk": { "free_bytes": 912345678901, "total_bytes": 4000000000000, "low": false }
}
```

`disk` is `null` until the worker's first free-space check.

### `GET /containers`

Returns an array of containers:

```json
[{
  "id": 1, "name": "Doctor X", "url": "https://mkvdrama.net/c/…",
  "poll_interval_min": 60, "enabled": true, "poll": true,
  "target_dir": "tv/Doctor X", "path_template": "{dir}/{filename}",
  "status": "ok", "last_error": null,
  "last_checked_at": 1791578179000, "last_changed_at": 1791578179000, "next_check_at": 1791581779000,
  "created_at": 1791578100000, "link_count": 6, "done_count": 1, "has_password": false
}]
```

Container passwords are never returned; `has_password` says whether one is set.

### `POST /containers`

Creates a container and checks it straight away if it's enabled and polled.

```sh
curl -H "X-Api-Key: $KEY" -H 'content-type: application/json' \
  -d '{"name":"Doctor X","url":"https://mkvdrama.net/c/…","target_dir":"tv/Doctor X"}' \
  http://riparr:7676/api/v1/containers
```

| Field | Required | Default |
| --- | --- | --- |
| `name` | yes | |
| `url` | yes | http(s) only |
| `target_dir` | yes | Relative to `/downloads` |
| `path_template` | no | `{dir}/{filename}` |
| `password` | no | none |
| `poll_interval_min` | no | `60` (5–10080) |
| `enabled` | no | `true` |
| `poll` | no | `true` |

Returns `201` with the container, or `409` if the URL is already watched.

### `GET /containers/{id}`

Returns the container plus `links`: every link with its status and progress (`host`, `status`, `error`, `label`, `episode`, `quality`, `size_text`, `file_count`, `files_done`, `files_standby`, `bytes_done`, `bytes_total`, `speed_bps`, …).

### `DELETE /containers/{id}`

Stops watching the container and cancels its downloads. Files already downloaded are kept. Returns `204`.

### `POST /containers/{id}/check`

Polls the container now. Returns `202`, or `409` if the container is paused or not polled.

### `POST /containers/{id}/links`

Adds host links by hand, as if the container's page had listed them.

```json
{ "urls": ["https://pixeldrain.com/u/abc", "https://gofile.io/d/xyz"] }
```

Takes 1–500 http(s) URLs. Returns `201 {"received": 2, "added": 1}`; already-known links aren't added again.

### `GET /queue`

```json
{ "active": [ /* links new, resolving, queued or downloading */ ], "recent": [ /* last 50 done, failed, offline or mirror */ ] }
```

Each link has the same fields as in `GET /containers/{id}`, plus `container_name`.

### `POST /links/{id}/retry`

Clears the link's attempts and backoff, and puts it back in the queue. Returns `202`.

### `POST /links/{id}/ignore`

Marks the link ignored and cancels its download if one is running. Returns `{"ok": true}`.
