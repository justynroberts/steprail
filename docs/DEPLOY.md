<!-- MIT License - Copyright (c) fintonlabs.com -->

# Deploying steprail

steprail is a single Node process plus a data directory. There's nothing to
cluster and no config files to hand-edit — everything past startup is set in the
UI. This guide covers running it locally, self-hosting it for a team, and
publishing your own image.

---

## 1. One command (local, fastest)

Needs only Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/justynroberts/steprail/main/install.sh | sh
```

The installer fetches the repo, starts steprail + a demo Postgres, pulls the
prebuilt multi-arch image when it can (else builds once), seeds the demo data,
waits for health, and opens **http://localhost:8452**. Works on macOS and Linux
(Windows via WSL2).

## 2. From a clone

```bash
git clone https://github.com/justynroberts/steprail && cd steprail
make up          # docker compose up -d  (pull-or-build)
make seed        # load the demo Postgres (optional)
make logs        # follow logs
make down        # stop, keep data
make clean       # stop AND wipe data volumes (destructive)
```

No `make`? `docker compose up --build -d` does the same; `make help` lists every
target.

## 3. Without cloning (compose only)

If you only want the runtime (no demo Postgres, no seed):

```bash
docker run -d --name steprail -p 8452:8452 \
  -v steprail-data:/app/data \
  -e STEPRAIL_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  ghcr.io/justynroberts/steprail:latest
```

That's a complete, persistent install. Open `http://localhost:8452`.

---

## Configuration (environment)

Everything else lives in the UI. These are the only environment knobs, all
optional:

| Variable | Purpose |
|---|---|
| `PORT` | API/web port (default `8452`). |
| `STEPRAIL_ENCRYPTION_KEY` | 32-byte hex key that encrypts saved secrets. **Set this in production** (from a secret store). If unset, one is generated into `data/.encryption-key` and a warning is logged. |
| `STEPRAIL_ENCRYPTION_KEY_PREVIOUS` | The old key during a rotation — reads fall back to it and every secret re-encrypts to the new key on boot. Remove once rotation completes. |
| `STEPRAIL_DATA_DIR` | Where the SQLite DB + encryption key live (default `./data`). |
| `STEPRAIL_DB_URL` | Use Postgres instead of the default SQLite (`postgres://user:pass@host:5432/db`). External, backup-friendly; still single-instance. |
| `STEPRAIL_TRUST_PROXY` | Set only behind a real reverse proxy, so the rate limiter reads `X-Forwarded-For`. |
| `NODE_ENV` | `production` enables prod-only warnings (e.g. missing encryption key). |

## Persistence & backups

- **SQLite (default).** One WAL database at `$STEPRAIL_DATA_DIR/steprail.db`
  holds flows, settings, versions, projects, and the run queue. The bundled
  compose mounts a named volume (`newflow-data:/app/data`) — back it up by
  copying the volume, or `docker cp steprail:/app/data ./backup`.
- **Postgres (optional).** Set `STEPRAIL_DB_URL` and steprail keeps its state in
  an external, managed database you back up like any other. The encryption key
  still lives in `STEPRAIL_DATA_DIR` (or the env var) — keep it safe; without it
  the saved secrets can't be decrypted.

## Optional host mounts

The bundled `docker-compose.yml` also mounts, for convenience:

- `${HOME}/.ssh:/root/.ssh:ro` — so `infra.ssh` steps can use your keys.
- `/var/run/docker.sock` — so `infra.docker` builds against the host daemon.

Both are optional. Remove them if you don't use those step types or don't want
the container touching the host.

---

## Production checklist

steprail's flow author is a trusted operator (a `node:vm` sandbox and open HTTP
egress are deliberate). Before exposing it beyond your network:

1. **Set `STEPRAIL_ENCRYPTION_KEY`** from a secret store — don't rely on the
   auto-generated file.
2. **Set an access token** (Setup → the whole API is locked with a constant-time
   check; `/hooks/*` stay open for external senders to gate by path secrecy).
3. **Terminate TLS at a reverse proxy** (nginx/Caddy/Traefik) and set
   `STEPRAIL_TRUST_PROXY` so rate limits key on the real client IP.
4. **Persist the data volume** and back it up (above).
5. `restart: unless-stopped` (already set in the compose file) so it survives
   reboots.

See the full security posture in the [README](../README.md#security-posture)
and the roadmap to dependable production in
[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## Publishing your own image

CI (`.github/workflows/docker-publish.yml`) builds and pushes a multi-arch
(`amd64` + `arm64`) image to GHCR on every push to `main`, on `v*` tags, and via
manual dispatch:

- `main` → `ghcr.io/<owner>/steprail:latest`
- `v1.2.3` tag → `ghcr.io/<owner>/steprail:v1.2.3` (+ `:latest`)

**Make the package public** once (GitHub → Packages → steprail → Package
settings → Change visibility → Public) so `install.sh` and `docker pull` work
without authentication. Until then, deployers fall back to building from source
(slower first run, otherwise identical).

### Cutting a release

```bash
git tag v0.2.0 && git push --tags   # CI builds + pushes the tagged image
```

That's the whole release process — no separate build step.
