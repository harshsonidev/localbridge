# LocalBridge

A local development domain manager, HTTPS reverse proxy, certificate manager and traffic inspector for Windows and macOS.

LocalBridge maps friendly local domains such as `https://yourapp.local` to local development
servers such as `http://localhost:3000` — without hand-editing the hosts file, Caddy
configuration, TLS certificates or browser trust settings.

## Features

**Add Domain → `https://yourapp.local` in one step.** When a domain is saved, LocalBridge:

1. Validates the domain and target (normalization, RFC-1123 labels, duplicate/circular
   detection, port ranges, header-injection protection).
2. Generates a locally trusted certificate with the bundled mkcert (one per domain).
3. Updates the managed block in the system hosts file (backed up, idempotent) and flushes
   the DNS cache. Elevation is requested only once — the first time the hosts file is not
   writable, LocalBridge grants the current user write permission, after which every later
   change is applied silently.
4. Regenerates the Caddyfile and gracefully reloads the bundled Caddy reverse proxy.

**Domains** — add/edit/delete/enable/disable/search; simple and advanced modes (Host-header
control, WebSockets, timeouts, health-check config, traffic inspection); live preview of the
exact hosts block and Caddyfile that were generated.

**Proxy** — embedded Caddy 2.10 with process supervision: validate-before-reload, graceful
reloads via a loopback-only admin endpoint, crash restart with exponential backoff (max 5
failures/min), port-conflict detection with owning-process lookup, loopback-only binding
(`default_bind 127.0.0.1`), guaranteed shutdown on app quit. WebSockets/Vite HMR work out
of the box.

**Certificates** — bundled mkcert; CA install/repair from the UI; per-domain certificates
with status tracking (valid / expiring soon / expired / mismatch / missing) parsed via
node:crypto; stale certificates regenerate automatically, valid ones are left alone.

**Traffic** — near-real-time request inspector fed by Caddy's JSON access logs: method,
host/path, status, duration, sizes, client IP and headers, with filtering by domain, method,
status class and path search, plus copy-URL / copy-as-cURL. Credentials are stripped twice:
Caddy's log filter deletes Authorization/Cookie/Set-Cookie at the source, and the app
redacts sensitive header patterns again before records reach the UI. Records are kept
in memory only (bounded at 5000).

**Logs** — live structured log viewer (level/category filters, search, pause, clear, open
log directory). Sensitive keys are redacted before they are ever written.

## Commands

```bash
npm install            # install dependencies
npm run download-binaries   # fetch pinned Caddy/mkcert (hashes verified)
npm run dev            # start the app in development
npm test               # 122 unit + integration tests (real mkcert/Caddy, isolated)
npm run typecheck      # strict TypeScript checks (main + renderer projects)
npm run lint           # ESLint
npm run build          # compile main/preload/renderer into out/
npm run package:win    # build + create the Windows NSIS installer (dist/)  [run on Windows]
npm run package:mac    # build + create the macOS DMG, x64 + arm64 (dist/)  [run on macOS]
```

Notes:

- If Electron fails to start with "Electron uninstall", run
  `node node_modules/electron/install.js` once.
- Do not run the app from a shell that exports `ELECTRON_RUN_AS_NODE`.
- Binaries are pinned by version + SHA-256 in `resources/binaries.manifest.json`
  (Caddy verified against the official release checksums). The download script refuses
  unpinned or mismatched artifacts. Binaries are never downloaded at app runtime.

## Platform support

| Platform | Runtime | Packaging | Status |
| --- | --- | --- | --- |
| Windows 11 (x64) | ✅ implemented | `package:win` (NSIS) | verified end-to-end |
| macOS (x64 + arm64) | ✅ implemented | `package:mac` (DMG) | implemented, needs verification on Mac hardware |
| Linux | partial | `AppImage` config present | hosts elevation not implemented |

Each OS is packaged on its own machine — electron-builder cannot cross-build a macOS DMG from
Windows (it needs `hdiutil` and the macOS toolchain), and the app's privileged operations use
OS-native mechanisms. To build and run on macOS:

```bash
npm ci
npm run download-binaries   # fetches the macOS Caddy/mkcert for the current arch
npm run package:mac
```

Platform-specific mechanics:

- **Hosts file** — a one-time permission grant makes the file writable, then every change is
  written directly with no further prompt. The grant is elevated once via `icacls … /grant`
  on Windows (UAC) and an ACL entry (`chmod +a`) on macOS (`osascript … with administrator
  privileges`, which also flushes DNS). A per-write elevated copy remains as a fallback for
  locked-down machines.
- **Certificate trust** — mkcert `-install`; trust is detected in the Windows `CurrentUser\Root`
  store and the macOS System keychain (`security find-certificate`).
- **Caddy data isolation** — `APPDATA` (Windows) and `XDG_DATA_HOME`/`XDG_CONFIG_HOME` (macOS)
  point Caddy at an app-owned directory so it never writes to the user's global config.

macOS DMGs are ad-hoc signed by default; supply a Developer ID identity and notarization
credentials in CI for public distribution.

## Architecture

```
src/
├── main/               # Electron main process
│   ├── index.ts        # bootstrap: logging → storage → services → IPC → window
│   ├── window.ts       # hardened BrowserWindow + navigation guards
│   ├── ipc/            # one registrar per feature (domains, proxy, certificates,
│   │                   #   config, settings, system, logs, traffic)
│   ├── security/       # IPC allowlist + Zod enforcement
│   ├── services/       # domain, hosts, caddy (process), caddyfile (generation),
│   │                   #   mkcert, certificate, privilege, port, logs, traffic
│   ├── repositories/   # storage interfaces + SQLite (node:sqlite) and JSON engines
│   └── database/       # migrations (versioned, applied in transactions)
├── preload/            # contextBridge API (sandboxed, CJS)
├── renderer/           # React UI (no Node access, talks only to window.localBridge)
└── shared/             # types, Zod schemas, validation, error codes
```

Key properties:

- **Transactional domain changes**: DB write → certificates → hosts block → Caddyfile →
  proxy reload. Failures roll the DB record back and restore the hosts backup; proxy
  problems surface as warnings, never as data loss.
- **Validation happens twice**: instant feedback in the renderer (shared functions) and
  authoritatively in the main process (Zod on every IPC payload, allowlisted channels,
  sender checks, structured errors only).
- **Privilege boundary**: the only elevated operation concerns the hosts file, and it happens
  at most once — granting the current user write permission. Only fixed app/OS paths and the
  current account name (each validated against quote, backtick and control characters) ever
  reach an elevated command; content is verified after writing.
- **Verified end to end by tests**: the integration suite runs the real mkcert (isolated
  temp CAROOT) and real Caddy on high ports and asserts HTTPS proxying, forwarding
  headers, redirects, graceful reload, traffic capture with credential redaction, 502 on
  dead upstream, and clean shutdown — without touching any system state.

## Security model

- Renderer fully sandboxed (`sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`), strict CSP, all navigation blocked, validated
  `shell.openExternal` only.
- IPC: allowlisted channels, Zod-parsed payloads, sender identity checks, structured
  error codes (no stack traces cross the bridge).
- Caddyfile emission escapes all values and rejects control characters outright.
- Proxy and admin endpoint bind to loopback only; nothing is exposed to the LAN.
- Certificates/keys never enter the repository; the CA private key never leaves mkcert's
  CAROOT directory and is never displayed.
- Traffic/log redaction: Authorization, Cookie, Set-Cookie and API-key-like headers are
  deleted by Caddy's log filter and re-masked in the app; log metadata is scrubbed of
  password/token/key-like fields before writing.

## Roadmap

Target health checks and per-domain status, diagnostics ("Doctor"), system tray +
start-at-login, request replay, configuration export/import, auto-update preparation,
and Linux support.
