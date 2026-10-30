# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue.

- Use GitHub's **private vulnerability reporting** on this repository (Security tab, "Report a vulnerability"), or
- email **kienphan.dev@gmail.com** with a description and reproduction steps.

You will get an acknowledgement as soon as I can, and I will keep you updated until it is fixed.

## Running it safely

- Give the server a **restricted, read-only Stripe key** (`rk_...`) with read access to Subscriptions, Invoices and Coupons only. The server only ever issues `list` and `retrieve` calls, but a restricted key means a bug or a compromised process still cannot write to your account. The server warns on stderr when it is given an unrestricted `sk_...` key.
- Tool output contains customer ids and billing emails. Set `REDACT_EMAILS=true` to mask the emails, and only connect MCP clients you trust.
- The key is read from the environment, is never logged, and Stripe-key-shaped strings are stripped from error text returned to clients.

## Dependency policy

Every dependency, direct and transitive, is locked to a version that was published on or before **2026-09-30**, at least 30 days before the lockfile was last refreshed. `npm run check:deps-age` checks the whole lockfile against that cutoff and exits non-zero if anything newer is present. Dependabot is configured with a 30-day cooldown for the same reason.

The consequence is that fixes released after the cutoff are deliberately not taken yet. They are listed below rather than hidden.

## Known advisories (`npm audit`, 10 total: 5 moderate, 5 high)

Status as of 2026-10-30. Each of these is fixed upstream in a release newer than the cutoff. None is claimed to be fixed here. Reachability notes say what was checked.

How reachability was checked: the built server (`dist/plan.js`, `dist/server.js`, the SDK stdio transport and `stripe`) was loaded with a Node module-resolution hook that logs every resolved module. The list of packages that were resolved: `@modelcontextprotocol/sdk`, `ajv`, `ajv-formats`, `fast-deep-equal`, `fast-uri`, `json-schema-traverse`, `stripe`, `zod`, `zod-to-json-schema`, and Node built-ins. `express`, `body-parser`, `qs`, `hono`, `@hono/node-server`, `ip-address`, `express-rate-limit`, and the SDK's `streamableHttp` and `auth` modules were **not** resolved. `src/cli.ts` only constructs `StdioServerTransport`; the server has no HTTP listener.

### Runtime dependencies

| Package (locked) | Advisory | Fixed in | Reachability |
| --- | --- | --- | --- |
| `body-parser` 2.3.0 | DoS via trailing bytes after a compressed request body (GHSA-27r3-jxmh-p828) | 2.4.0 (2026-10-22) | Transitive via the SDK's `express`, which is used only by the SDK's HTTP transport. Not loaded at runtime, as above. Not reachable through the stdio entry point. |
| `qs` 6.16.0 | `stringify` DoS with `arrayFormat: 'comma'` (GHSA-6pq8-jhm2-2vcw) | 6.16.1 (2026-10-14) | Same `express` chain. Not loaded. |
| `ip-address` 10.7.2 | Quadratic-time IPv6 zone parsing (GHSA-rxp7-6hxx-x8q5) | 10.7.4 (2026-10-11) | Via `express-rate-limit` in the SDK's HTTP auth router. Not loaded. |
| `@modelcontextprotocol/sdk` 1.31.0 | Experimental tasks not bound to session; client HTTP transports following cross-origin redirects; HTTP request memory exhaustion during validation; bearer auth accepting tokens for another service (GHSA-22jm-h49p-29qw, -6prh-2h8m-c8cw, -46jr-4wx8-v453, -rvq5-wwqv-78pq) | 1.32.2 (2026-10-23) | This server uses only the server side over stdio. It does not register tasks, does not use the client HTTP transports in production code (the client appears only in tests, over in-memory and stdio transports), and has no HTTP server or bearer auth. The memory-exhaustion advisory is described for HTTP requests; the stdio peer is the local process that launched the server. Not independently re-verified beyond that. |
| `zod` 4.6.5 | Memory exhaustion validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5) | 4.6.7 (2026-10-12) | The server's own tool input schemas are `z.number().int()` bounds only; no array, set or record schemas. `zod` is also used inside the SDK to validate incoming protocol messages from the connected client. Whether any SDK message schema has the affected constrained-collection shape was not checked; the sender is the local MCP client process. |
| `fast-uri` 3.1.8 | Four URI parsing advisories (scheme spoofing, path normalization, host confusion, scheme injection) | 3.1.9 (2026-10-19) | Loaded: it is a dependency of `ajv`, which the SDK imports. `ajv` only calls it when compiling JSON Schemas with `$ref`s; this server registers no such schemas and does not feed it URLs from Stripe or the client. Not exercised by any code path in this repository. |

### Development-only dependencies

These are installed only for `npm test`, `npm run typecheck` and building from source. They are `devDependencies` (the published package contains `dist/` only), and they are never loaded by the running server.

| Package (locked) | Advisory | Fixed in |
| --- | --- | --- |
| `vitest` 5.0.2 / `@vitest/mocker` 5.0.2 | Code injection via unauthenticated manual mock registration (GHSA-qxg6-89mg-rqv8); Windows backslash bypass of the mocker redirect allowlist (GHSA-xp26-3454-mjgp) | 5.0.5 (2026-10-15) |
| `vite` 8.3.1 | Several issues in the Vite dev server (files outside `server.fs.allow`, cross-origin script execution via custom middleware, `?vite-wasm-instance`) and `launch-editor` issues | 8.3.5 (2026-10-21) |
| `source-map-js` 1.2.1 (via `postcss` via `vite`) | Event-loop DoS via indexed source-map section offsets (GHSA-68fv-2mgg-jv7q) | 1.2.2 (2026-09-30) |

These matter if you run a Vite dev server on an untrusted network or feed untrusted source maps to the test toolchain. This repository does neither: the tests are `vitest run` against local files, and no tests start a dev server. (That the test run never starts a Vite dev server is based on the test configuration and scripts in this repository, not on a trace of the Vite internals.)

## Supported versions

Only the latest commit on `main` is supported.
