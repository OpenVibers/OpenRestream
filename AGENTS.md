# AGENTS.md — OpenRestream

## Project overview

OpenRestream (`https://openre.stream`) is the network's ingest and restream authority: a creator goes live
once from OBS or any RTMP/WHIP/MPEG-TS sender and OpenRestream fans the stream out to Twitch, YouTube,
Kick and any RTMP/RTMPS/SRT server, with OpenVibe Live on by default. It was extracted from Live so
transport workers survive API deploys (hazard H1: "restarting Live drops live RTMP streams").

- **API/UI:** `server/index.js` (`openre-api`, port `4500`), `server/app.js`, `server/api/v1.js`,
  `server/api/actor-limits.js`; pages under `server/ui/`; `server/registry/` (resource index/control).
- **Store:** `server/store/` — `definitions.js` (streams/keys), `sessions.js`, `outputs.js`,
  `workers.js`, `recordings.js`, `index.js` (SERIALIZABLE transactions).
- **Workers:** `workers/` — `coordinator.js` (leases, generations, drain, recording requests, event
  relay), `rtmp-ingest.js`, `restream-worker.js`, `jsmpeg.js`, `webrtc.js` (WHIP + mediasoup SFU),
  `thumbnails.js`, `restream/`.
- **Media:** `server/media-client.js` + `server/store/recordings.js` (Media records/finalises; Live
  wants the recording).
- **Ops:** `deploy/` (systemd units, nginx `deploy/nginx/openre.stream.conf`, `deploy/scripts/deploy.sh`
  and `workers.sh`), env `/etc/openvibe/openre.env`, database `ov_openre`, documents
  `docs/cutover.md`, `SECURITY.md`.

## Owns, does not own

Owns stream (input) definitions with a canonical `usr_…` owner and typed refs to other services'
entities (`live:managed_stream:12`, `live:user:45`); ingest keys (SHA-256 only, shown once, rotation
with immediate or grace revocation); ingest sessions (`starting → live → ending → ended | failed`, with
worker, generation and lease); transport workers and generations; destinations (URL + key sealed with
AES-256-GCM, never returned in full), outputs with health/progress/bounded logs and a per-destination
circuit breaker; recording requests to Media and the Live-id migration map; the lifecycle events
`openre.session.started|ended|failed`, `openre.output.healthy|failed`, `openre.recording.requested`,
`openre.key.rotated`.

Does not own: channel presentation, discovery, watch pages or the creator dashboard (Live); recording
bytes and finalisation (Media records, finalises, thumbnails, fires `vod.ready`); chat, money,
identity (Network).

## Processes and consistency model

`openre-api` (4500) + `openre-session-coordinator` + `openre-rtmp-ingest@`, `openre-jsmpeg@`,
`openre-webrtc@` and `openre-restream-worker@` share one PostgreSQL database (`ov_openre`, ADR-035)
through PgBouncer; every transaction is SERIALIZABLE. **No process depends on another at runtime:**
workers need only the database; restarting the API never touches a session. Each worker registers as
generation N+1; when it is `ready` the coordinator marks older ones `draining` (deadline
`OPENRE_DRAIN_MAX_MS`, default 24 h). Heartbeats every 2 s renew the worker and its sessions' leases;
a worker silent for `OPENRE_WORKER_LEASE_MS` (15 s) is `lost`, its sessions fail and its outputs go back
to `pending`. An output only ever changes its own row; a dead destination fails and the session stays
live. Valkey holds the API's per-actor limit counters; telemetry is aggregated by route template and
pruned after 14 days.

## Auth

Services use a Network client-credentials token for audience `openvibe.openre`, verified offline with
JWKS (a key rotation is honoured on an unknown `kid`); each route checks one capability:
`openre.stream.read/write`, `openre.key.rotate`, `openre.session.read/end`, `openre.output.read/write`,
`openre.resource.read`. A service may send `X-OV-Subject: usr_…` and is then limited to that owner's
streams. Browsers/owners use the Network user JWT (`ov_token` cookie from `/auth/login`, or Bearer;
service principals and typed tokens such as realtime tickets/FedCM assertions are refused) and act on
their own streams; Network role `admin` is staff. UI forms carry a CSRF token derived from the session
cookie; cookies are SameSite=Lax.

## Secrets and security

Ingest keys are 256-bit (`ork_` + 43 base64url), SHA-256 at rest, compared by indexed lookup inside the
RTMP handshake, never logged (last four only), never in an event or a URL after the publish is renamed
to the session id. Destination keys and SRT passphrases are AES-256-GCM (`OPENRE_SECRETS_KEY`, rotation
via `OPENRE_SECRETS_KEY_PREVIOUS`); APIs return `****` + last four; ffmpeg command lines are redacted.
Destination URLs must be `rtmp://`, `rtmps://` or `srt://` with a hostname, no credentials and no
loopback/private/link-local/CGNAT/multicast host — checked on write and again with DNS resolution right
before ffmpeg starts (`OPENRE_DEST_ALLOW_PRIVATE` is the LAN-box opt-out). The RTMP public listener
accepts publish only (play refused); loopback play/FLV ports accept only `/live/ses_<ULID>` paths.
`/internal/` answers only on loopback; deliveries carry a valid v2 signature.

## Deploy

Release layout: `/opt/openre.stream/repo`, `/opt/openre.stream/releases/<sha12>` (full checkout +
`node_modules`, owned by ubuntu), `current` → the release the API and coordinator run; env
`/etc/openvibe/openre.env`; store `ov_openre`; units in `deploy/systemd/`; nginx
`deploy/nginx/openre.stream.conf`; script `deploy/scripts/deploy.sh`. `sudo ovhost deploy openre` is
the release+API path (strategy `release-layout`); the wrapper keeps the old subcommands
(`release <ref>`, `api [sha]`, `rollback [sha]`, `plan`, `workers`, `status`). An API restart is refused
while an ingest session is open (`--wait-idle` holds, `--force` overrides); an API deploy never
restarts a worker. A worker deploy starts the `@<sha>` instances; older ones are disabled and drain
(never `systemctl restart` a worker during a broadcast; `systemctl stop` drains up to 30 min). ovhost
rolls `current` back when the API is not ready in 60 s; workers roll back by starting the previous
generation. Restore drills use `OPENRE_DRILL=1` (API reads only; coordinator/workers exit; relay/Media
off) — never set it in the production env. Ports: 1936 RTMP, 9736 JSMPEG, WHIP on
`ingest.openre.stream`, 4500 API, 10200–10300/udp mediasoup; `OPENRE_RTMP_EXTRA_PORTS=1935` after Live
retires its listener.

## Commands and tests

```bash
npm ci
npm run dev                  # openre-api on http://127.0.0.1:4500
npm run coordinator          # each in its own terminal
npm run rtmp-ingest
npm run restream-worker
npm test                     # every test/*.test.js; RTMP/JSMPEG e2e need ffmpeg
npm run test:pg              # the same through PostgreSQL + PgBouncer
npm run migrate-from-live    # the Live-id migration map
```

`test/run.js` uses `openvibe-shared/test-runner` (180 s, parallel 3); temp PGlite, generated RSA keys
and stub subscribers, never the network. Coverage includes keys/rotation, sessions and the
coordinator, generations/drain/leases, destinations and logs, the RTMP/JSMPEG/WebRTC end-to-end paths
(real ffmpeg/mediasoup; skipped without them), API restart during a session, drill mode, deploy
wrapper/conf, discovery, limits and the pages.

## Conventions and pitfalls

- CommonJS, 4-space indent, single quotes, semicolons; RFC 9457 problem+json; escaped HTML.
- **Never restart or stop a worker instance during a broadcast.** Deploy a new generation and let the
  coordinator drain the old one; an encoder reconnects, a restream/output is handed over, nothing is
  killed. `systemctl restart openre-*` is the wrong reflex.
- **Generation and lease ordering are the correctness core:** admit a publish only through the store
  (SERIALIZABLE), renew the worker and every owned session/lease in one heartbeat transaction, and let
  a stale generation lose atomically. A "fix" that writes a session or output outside its owner is a bug.
- **An output changes only its own row.** A bad destination must not end the session; fail that output,
  cool it down, keep the ingest alive.
- **No key in a log, event or play URL.** The publish path is renamed to the session id; the last four
  characters are the only hint allowed.
- **SSRF is checked twice:** on write and again with DNS right before ffmpeg; a redirect/DNS change must
  not turn a public host into loopback.
- **Recording is a request:** Media records and finalises; OpenRestream never holds the bytes and never
  fires `vod.ready` itself. JSMPEG has no recording — say so.
- **The schema only adds**, so a worker on an older release reads a newer database; do not add a
  migration that a draining generation cannot run against.
