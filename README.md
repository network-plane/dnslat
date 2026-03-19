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

## Workspace

`go.work` includes the root module, `speedplane`, and `planeweb-go`.
