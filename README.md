# Home Network Topology

Self-hosted home network topology app for OpenWrt-based discovery and manual topology correction. The production path is Docker-first: one Node 22 container builds the React frontend, runs the Fastify backend, serves the built frontend, and stores SQLite data on a persistent volume.

## Stack choices

- **Runtime:** Node 22 pinned with Volta
- **Package manager:** pnpm workspace
- **Frontend:** React + Vite + TypeScript
- **Backend:** Fastify + TypeScript
- **Persistence:** SQLite on a mounted Docker volume
- **Discovery:** read-only OpenWrt SSH commands

## Quick start with Docker Compose

1. Copy and edit the example config if needed. Keep secret values out of YAML; use environment variable names such as `OPENWRT_IDENTITY_FILE` for mounted SSH keys.

   ```bash
   cp config.example.yaml config.local.yaml
   ```

2. Point Compose at the config you want to mount. The checked-in `docker-compose.yml` mounts `config.example.yaml` by default for demonstration; for real deployments, change the volume to `./config.local.yaml:/config/config.yaml:ro`.

3. Export any mounted identity-file paths referenced by your config. Example:

   ```bash
   export OPENWRT_IDENTITY_FILE='/run/secrets/openwrt_identity'
   ```

4. Build and start the app:

   ```bash
   docker compose up --build
   ```

5. Open <http://localhost:3000>. The backend health endpoint is <http://localhost:3000/api/health>.

## Runtime configuration

The backend reads YAML from `TOPOLOGY_CONFIG_PATH` when set. In Docker Compose this is mounted at `/config/config.yaml` and bootstraps router definitions into SQLite on startup.

Supported top-level keys:

- `dataDirectory`: directory for `topology.sqlite` when `TOPOLOGY_DB_PATH` is not set. In Docker this defaults to `/data`.
- `discoveryIntervalSeconds`: documented operator cadence for manual/scheduled discovery; v1 does not run background scheduling.
- `ui.defaultView`: `topology` or `setup`.
- `ui.setupHelpText`: operator-facing help text shown on the setup screen.
- `routers`: optional router definitions with `id`, `label`, `baseUrl`, `username`, optional `sshHost`, `sshPort`, `identityFileEnvVar`, and reserved `passwordEnvVar` metadata.

Secrets are resolved indirectly. `identityFileEnvVar` is the name of an environment variable whose value is a mounted private-key path, not key contents. `passwordEnvVar` is optional reserved metadata only; v1 runs OpenSSH in batch mode and does not implement password-based SSH. Do not commit real passwords or private key contents.

## Persistence and volumes

SQLite data lives under `TOPOLOGY_DATA_DIR` unless `TOPOLOGY_DB_PATH` points at a specific database file. The Compose file mounts the named volume `topology-data` at `/data`; keep this volume for router definitions, snapshots, overlays, and WAL sidecar files.

Useful commands:

```bash
docker compose ps
docker compose logs -f topology
docker compose down
docker volume ls | grep topology
```

Use `docker compose down -v` only when you intentionally want to delete persisted topology data.

## SSH secret handling

- Use SSH key or agent-based authentication for router discovery; password-based SSH is not implemented in v1.
- Mount SSH private keys read-only from outside the repo/image and point `OPENWRT_IDENTITY_FILE` at the in-container path.
- The app stores env var names for mounted identity files; it does not need plaintext passwords in YAML examples or API responses.
- Discovery uses read-only OpenWrt commands and should connect with the least-privileged router account that can run the required read commands.

## Operator UX

The **Discovery setup** screen lets an operator:

1. create or update a router connection,
2. test SSH reachability,
3. run discovery,
4. see mounted-config status and operation feedback.

The topology viewer/editor remains separate and continues to support manual switches, links, positions, labels, notes, tags, and hide/show overlay state.

## Local development

Docker Compose is the primary deployment path. For development only:

```bash
pnpm install
pnpm dev
```

Verification commands:

```bash
pnpm test
pnpm typecheck
pnpm build
docker compose up --build
```

## Known limitations

- v1 is single-user and self-hosted; it has no authentication or RBAC.
- There is no GraphQL, websocket feed, SNMP scanner, cloud sync, Kubernetes manifest, or client agent.
- `discoveryIntervalSeconds` is config metadata for operators; automatic scheduled discovery is out of scope for v1.
- Unmanaged L2 topology cannot be inferred perfectly from router data, so manual switch/link correction remains necessary.
