# dnslat

Monorepo:

- **`packages/planeweb`** — shared charts/formatters for browser apps (bundled with [esbuild](https://esbuild.github.io/), no npm).
- **`packages/planeweb-go`** — WebSocket broadcast helper for Go servers embedding planeweb UIs.
- **`speedplane/`** — speedtest tracker (uses planeweb + planeweb-go).
- **`cmd/dnslat`** — DNS latency dashboard against multiple resolvers.

## Build

```bash
# dnslat binary + embedded UI
make dnslat

# speedplane
make speedplane
```

Requires `esbuild` on `PATH` and Go 1.24+.

## Run dnslat

```bash
./dnslat --listen-port 8090 --data-dir ./dnslat-data
```

Open http://127.0.0.1:8090 — run tests, view per-resolver and combined latency charts.

### Config file (`dnslat.config`)

JSON fields (similar to speedplane’s `speedplane.config`):

| Field | Description |
|--------|-------------|
| `data_dir` | State directory (defaults to the config file’s directory if omitted). |
| `db_path` | SQLite database file path (absolute or relative to the config file). |
| `listen_addr` | HTTP bind address, e.g. `:8090`, `0.0.0.0:8989`, `127.0.0.1:8090`. |
| `public_dashboard` | If `false`, only **loopback** clients (`127.0.0.1` / `::1`) may use the UI and API (no remote access). Default `true` if omitted. |
| `save_manual_runs` | Persist manual “Run now” probes. |
| `default_query_domain` | Default DNS query name for scheduled/manual runs. |
| `schedules` / `last_run` | Scheduler state (managed by the app). |

CLI flags `--listen`, `--listen-port`, `--db`, and `--data-dir` **override** the file when you pass them (cobra “changed” semantics for listen).

## Workspace

`go.work` includes the root module, `speedplane`, and `planeweb-go`.
