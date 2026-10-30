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

Every dependency, direct and transitive, is locked to a version that was published on or before **2026-10-23**, at least 7 days before the lockfile was last refreshed. `npm run check:deps-age` checks the whole lockfile against a cutoff (default: 7 days before now; pass an ISO date to override, e.g. `npm run check:deps-age -- 2026-10-23T00:00:00Z`) and exits non-zero if anything newer is present. Dependabot is configured with a 7-day cooldown for the same reason.

Packages are installed only inside a throwaway container, never with the host `npm`/`node`, and always with `--ignore-scripts` (CI uses `npm ci --ignore-scripts`). No dependency needs its install script: `esbuild` (via `tsx`) ships its binary in a platform package, and `fsevents` is an optional macOS watcher; tests, typecheck and build pass with scripts disabled.

## Known advisories

`npm audit` (full and `--omit=dev`) reports **0 vulnerabilities** as of 2026-10-30 for the locked versions. The advisories previously listed here (`body-parser`, `qs`, `ip-address`, `fast-uri`, `zod`, `vitest`/`vite`/`source-map-js`) are fixed by the updates in this lockfile. The `@modelcontextprotocol/sdk` advisories fixed in 1.32.2 do not show up in `npm audit` for 1.32.1; 1.32.2 was released on 2026-10-23, after the cutoff, and is not taken yet. The server uses only the SDK server side over stdio (no tasks, no HTTP server, no bearer auth, no client HTTP transports in production code), so those issues are not reachable here; this was not independently re-verified beyond that.

## Supported versions

Only the latest commit on `main` is supported.
