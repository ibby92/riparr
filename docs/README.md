# Riparr documentation

Riparr watches **containers** (link-protector or paste pages that list file-host links) and downloads whatever new content appears on them. It downloads from gofile, pixeldrain and MEGA, extracts archives, and files everything under the folder and naming scheme you choose. It runs alongside your *arr stack in Docker.

## Using Riparr

| Guide | What's in it |
| --- | --- |
| [Installation](installation.md) | Docker setup, volumes, environment variables, first run, upgrades and backups |
| [User guide](user-guide.md) | Containers, how polling works, Click'n'Load and DLC, preferred hosts, archives, notifications, proxies |
| [Configuration reference](configuration.md) | Every setting and environment variable, with defaults |
| [REST API](api.md) | Endpoints for scripts and dashboard widgets |
| [Troubleshooting](troubleshooting.md) | What each status and error message means and what to do about it |

## Working on Riparr

| Guide | What's in it |
| --- | --- |
| [Architecture](architecture.md) | Processes, the download pipeline, state machines, data model, extension points |
| [Development](development.md) | Local setup, tests, builds, conventions, and how to add a host or container source |
