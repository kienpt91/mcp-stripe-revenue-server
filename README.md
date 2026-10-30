# mcp-stripe-revenue-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that answers revenue questions about a Stripe account: current MRR, churn, failed payments and a one-call summary. It is read-only, speaks MCP over stdio, and ships with a deterministic demo dataset so you can try every tool without a Stripe key.

- **Four tools**: `get_mrr`, `get_churn`, `list_failed_payments`, `revenue_summary`.
- **Correct MRR**: monthly, quarterly, yearly, weekly and daily prices are normalized; quantities and active `percent_off` / `amount_off` discounts are applied; canceled and incomplete subscriptions are ignored.
- **Never mixes currencies**: every figure is grouped per currency.
- **Read-only by construction**: the Stripe client is only ever used for `list` and `retrieve` calls.
- **Testable**: all data access sits behind a `RevenueSource` interface; the calculations are pure functions.

## Quick start (no Stripe key needed)

Requires Node.js 20 or newer to run the server (`engines` in `package.json`). Running the tests and building from source needs Node.js 22.12 or newer, because the test runner does; it was developed and tested on Node 22.19.

```bash
git clone https://github.com/kienpt91/mcp-stripe-revenue-server.git
cd mcp-stripe-revenue-server
npm install
npm run build
node dist/cli.js --demo
```

`--demo` serves built-in sample data with a fixed clock (2025-06-15 12:00 UTC), so the output below is identical on every run. The server waits for an MCP client on stdin/stdout; point a client at it as shown next.

## Connect an MCP client

Any MCP client that can launch a stdio server accepts a configuration of this shape. Use the absolute path to `dist/cli.js`:

```json
{
  "mcpServers": {
    "stripe-revenue": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-stripe-revenue-server/dist/cli.js"],
      "env": {
        "STRIPE_API_KEY": "rk_live_your_restricted_key"
      }
    }
  }
}
```

To try it with sample data instead, drop the `env` block and add the flag:

```json
{
  "mcpServers": {
    "stripe-revenue-demo": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-stripe-revenue-server/dist/cli.js", "--demo"]
    }
  }
}
```

Without `--demo` the process exits with an error unless `STRIPE_API_KEY` is set. Diagnostics go to stderr; stdout is reserved for the protocol.

## Tools

All tools are annotated `readOnlyHint: true`. Amounts are integers in the currency's minor unit (cents), each with a `...Formatted` decimal string next to it. Currency codes are lowercase ISO 4217.

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_mrr` | none | MRR and ARR per currency, subscription and customer counts, and `skippedItems` (items with no fixed price) |
| `get_churn` | `days` (1-365, default 30) | Subscription churn, customer churn and churned MRR per currency over the window |
| `list_failed_payments` | `days` (1-365, default 30), `limit` (1-100, default 25) | Unpaid invoices that were attempted, newest first, with totals per currency |
| `revenue_summary` | `days` (1-365, default 30) | MRR, cash collected, failed payment totals and churn in one response |

The JSON below is the real output of `node dist/cli.js --demo`.

### `get_mrr`

<!-- example:get_mrr -->
```json
{
  "asOf": "2025-06-15T12:00:00.000Z",
  "byCurrency": [
    {
      "currency": "eur",
      "mrr": 7800,
      "mrrFormatted": "78.00 EUR",
      "arr": 93600,
      "arrFormatted": "936.00 EUR",
      "subscriptions": 2,
      "customers": 2
    },
    {
      "currency": "gbp",
      "mrr": 5000,
      "mrrFormatted": "50.00 GBP",
      "arr": 60000,
      "arrFormatted": "600.00 GBP",
      "subscriptions": 1,
      "customers": 1
    },
    {
      "currency": "jpy",
      "mrr": 30000,
      "mrrFormatted": "30000 JPY",
      "arr": 360000,
      "arrFormatted": "360000 JPY",
      "subscriptions": 1,
      "customers": 1
    },
    {
      "currency": "usd",
      "mrr": 67133,
      "mrrFormatted": "671.33 USD",
      "arr": 805600,
      "arrFormatted": "8056.00 USD",
      "subscriptions": 11,
      "customers": 10
    }
  ],
  "skippedItems": 1
}
```

The `usd` figure is 11 subscriptions, including a yearly plan (1200.00/year counts as 100.00/month), a weekly plan, a 5-seat plan with 20% off until October, a plan with 10.00 off every invoice, one past-due subscription, and one subscription with a flat item plus a metered item (the metered item is counted in `skippedItems`).

### `get_churn`

<!-- example:get_churn -->
```json
{
  "period": {
    "from": "2025-05-16T12:00:00.000Z",
    "to": "2025-06-15T12:00:00.000Z"
  },
  "subscriptions": {
    "activeAtStart": 16,
    "canceled": 3,
    "churnRate": 0.1875,
    "newInPeriod": 3
  },
  "customers": {
    "activeAtStart": 15,
    "churned": 2,
    "churnRate": 0.1333
  },
  "revenueByCurrency": [
    {
      "currency": "eur",
      "mrrAtStart": 11700,
      "mrrAtStartFormatted": "117.00 EUR",
      "mrrChurned": 3900,
      "mrrChurnedFormatted": "39.00 EUR",
      "churnRate": 0.3333
    },
    {
      "currency": "gbp",
      "mrrAtStart": 5000,
      "mrrAtStartFormatted": "50.00 GBP",
      "mrrChurned": 0,
      "mrrChurnedFormatted": "0.00 GBP",
      "churnRate": 0
    },
    {
      "currency": "jpy",
      "mrrAtStart": 30000,
      "mrrAtStartFormatted": "30000 JPY",
      "mrrChurned": 0,
      "mrrChurnedFormatted": "0 JPY",
      "churnRate": 0
    },
    {
      "currency": "usd",
      "mrrAtStart": 62133,
      "mrrAtStartFormatted": "621.33 USD",
      "mrrChurned": 6800,
      "mrrChurnedFormatted": "68.00 USD",
      "churnRate": 0.1094
    }
  ]
}
```

### `list_failed_payments`

Called with `{ "limit": 2 }`. `totalCount` and `byCurrency` cover every match; `limit` only truncates `invoices`.

<!-- example:list_failed_payments -->
```json
{
  "period": {
    "from": "2025-05-16T12:00:00.000Z",
    "to": "2025-06-15T12:00:00.000Z"
  },
  "totalCount": 4,
  "customers": 4,
  "byCurrency": [
    {
      "currency": "eur",
      "count": 1,
      "amountDue": 3900,
      "amountDueFormatted": "39.00 EUR"
    },
    {
      "currency": "usd",
      "count": 3,
      "amountDue": 10800,
      "amountDueFormatted": "108.00 USD"
    }
  ],
  "invoices": [
    {
      "id": "in_demo_failed_2",
      "customerId": "cus_demo_05",
      "customerEmail": "ops@fabrikam.example",
      "amountDue": 3900,
      "amountDueFormatted": "39.00 EUR",
      "currency": "eur",
      "attemptCount": 1,
      "status": "open",
      "created": "2025-06-14T09:00:00.000Z",
      "nextPaymentAttempt": "2025-06-16T09:00:00.000Z"
    },
    {
      "id": "in_demo_failed_1",
      "customerId": "cus_demo_10",
      "customerEmail": "billing@northwind.example",
      "amountDue": 4900,
      "amountDueFormatted": "49.00 USD",
      "currency": "usd",
      "attemptCount": 2,
      "status": "open",
      "created": "2025-06-10T09:00:00.000Z",
      "nextPaymentAttempt": "2025-06-17T09:00:00.000Z"
    }
  ]
}
```

### `revenue_summary`

<details>
<summary>Output of <code>revenue_summary</code> with default arguments</summary>

<!-- example:revenue_summary -->
```json
{
  "period": {
    "from": "2025-05-16T12:00:00.000Z",
    "to": "2025-06-15T12:00:00.000Z"
  },
  "mrr": {
    "asOf": "2025-06-15T12:00:00.000Z",
    "byCurrency": [
      {
        "currency": "eur",
        "mrr": 7800,
        "mrrFormatted": "78.00 EUR",
        "arr": 93600,
        "arrFormatted": "936.00 EUR",
        "subscriptions": 2,
        "customers": 2
      },
      {
        "currency": "gbp",
        "mrr": 5000,
        "mrrFormatted": "50.00 GBP",
        "arr": 60000,
        "arrFormatted": "600.00 GBP",
        "subscriptions": 1,
        "customers": 1
      },
      {
        "currency": "jpy",
        "mrr": 30000,
        "mrrFormatted": "30000 JPY",
        "arr": 360000,
        "arrFormatted": "360000 JPY",
        "subscriptions": 1,
        "customers": 1
      },
      {
        "currency": "usd",
        "mrr": 67133,
        "mrrFormatted": "671.33 USD",
        "arr": 805600,
        "arrFormatted": "8056.00 USD",
        "subscriptions": 11,
        "customers": 10
      }
    ],
    "skippedItems": 1
  },
  "collected": [
    {
      "currency": "eur",
      "collected": 3900,
      "collectedFormatted": "39.00 EUR",
      "invoices": 1,
      "customers": 1
    },
    {
      "currency": "gbp",
      "collected": 15000,
      "collectedFormatted": "150.00 GBP",
      "invoices": 1,
      "customers": 1
    },
    {
      "currency": "jpy",
      "collected": 30000,
      "collectedFormatted": "30000 JPY",
      "invoices": 1,
      "customers": 1
    },
    {
      "currency": "usd",
      "collected": 45000,
      "collectedFormatted": "450.00 USD",
      "invoices": 9,
      "customers": 8
    }
  ],
  "failedPayments": {
    "totalCount": 4,
    "customers": 4,
    "byCurrency": [
      {
        "currency": "eur",
        "count": 1,
        "amountDue": 3900,
        "amountDueFormatted": "39.00 EUR"
      },
      {
        "currency": "usd",
        "count": 3,
        "amountDue": 10800,
        "amountDueFormatted": "108.00 USD"
      }
    ]
  },
  "churn": {
    "subscriptions": {
      "activeAtStart": 16,
      "canceled": 3,
      "churnRate": 0.1875,
      "newInPeriod": 3
    },
    "customers": {
      "activeAtStart": 15,
      "churned": 2,
      "churnRate": 0.1333
    }
  }
}
```

</details>

## How the numbers are calculated

**MRR**
- Subscriptions in status `active` or `past_due` count. `trialing`, `unpaid`, `paused`, `incomplete`, `incomplete_expired` and `canceled` do not.
- Each item contributes `unit_amount x quantity`, converted to a month: `year` / 12, `week` x 52/12, `day` x 365/12, and `interval_count` divides further (a quarterly price is `month` with `interval_count` 3).
- Discounts attached to the subscription apply in order when active at the time of the call: `percent_off` scales the running total, `amount_off` is taken off each invoice and converted to a monthly amount using the billing interval. `forever` discounts always apply; `repeating` discounts apply between their `start` and `end`; `once` discounts never recur, so they are ignored. An `amount_off` in a different currency than the subscription is ignored. The result never goes below zero.
- Totals are summed per currency and rounded once at the end. ARR is 12 x MRR.
- Prices that have no fixed amount (tiered, volume-transformed or metered) cannot be turned into MRR; they are left out and counted in `skippedItems`.
- Prices are taken as stored on the price object, so tax is not included. Item-level and customer-level discounts are not applied.

**Churn** over `[now - days, now)`
- The cohort is every subscription that existed when the window began (never-started `incomplete` and `incomplete_expired` excluded). A cohort subscription is churned if it ended inside the window. `churnRate` is `null` when the cohort is empty instead of dividing by zero.
- A customer churns only if they had a subscription at the start and have none at the end, so moving between plans is not churn.
- `mrrChurned` values churned subscriptions at the start of the window, including discounts active then.

**Failed payments**: invoices in status `open` or `uncollectible` with at least one payment attempt, created inside the window. `amountDue` is the remaining balance.

**Collected revenue** (in `revenue_summary`): `amount_paid` of invoices paid inside the window. For Stripe data, invoices created up to 60 days before the window are considered so that late-paid invoices are not missed. Refunds are not subtracted.

## Use it with live Stripe data

1. In the Stripe Dashboard, create a **restricted key** with read-only access to Subscriptions, Invoices and Coupons. Nothing else is needed.
2. Put it in `STRIPE_API_KEY` in your MCP client configuration (see above), or export it and run `node dist/cli.js`.

Subscriptions and invoices are fetched with automatic pagination (100 per page). The server makes `list` and `retrieve` calls only. The Stripe-backed source is covered by tests against a fake client with the same `list` / `retrieve` surface; try it against a test-mode key first.

Settings, all optional environment variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `STRIPE_CACHE_TTL_SECONDS` | `60` | Stripe lists (subscriptions, failed and paid invoices) are cached in memory for this long, so a burst of tool calls costs one scan. Results can be that stale. `0` disables the cache. |
| `STRIPE_MAX_ITEMS` | `50000` | A single list read stops with a clear error once it has seen more than this many objects, instead of scanning an unbounded account. |
| `REDACT_EMAILS` | `false` | `true` masks customer emails in `list_failed_payments` output (`billing@northwind.example` becomes `b***@northwind.example`). |

### Security

- **Use a restricted, read-only key** (`rk_...`). The server never writes, but a full secret key (`sk_...`) would let anything with access to the process do far more; the server prints a warning to stderr when it is given one.
- The key is read from the environment only. It is not logged, and anything that looks like a Stripe key is redacted from error messages returned to the client.
- Tool results contain customer ids and billing emails. Set `REDACT_EMAILS=true` to mask the emails, and only connect clients you trust with the rest.
- Dependencies are pinned to exact versions that were published at least 30 days before the pin date, and `npm run check:deps-age` verifies that for the whole lockfile. Advisories whose fixes are newer than that are tracked in [SECURITY.md](SECURITY.md).

## Project layout

| Path | Purpose |
| --- | --- |
| `src/calc.ts` | Pure calculations: interval normalization, discounts, MRR, churn, failed payments, summary |
| `src/types.ts` | Domain model and the `RevenueSource` interface |
| `src/stripe-source.ts` | `RevenueSource` backed by the `stripe` package |
| `src/memory-source.ts`, `src/demo-data.ts` | In-memory source and the deterministic demo dataset |
| `src/cached-source.ts` | TTL cache decorator for any `RevenueSource` |
| `src/server.ts`, `src/present.ts`, `src/redact.ts` | MCP tool registration, JSON presentation, email masking and key redaction |
| `src/plan.ts`, `src/cli.ts` | Argument and environment handling, and the stdio entry point |

To plug in another data source, implement `RevenueSource` (three async methods) and pass it to `createRevenueServer({ source })`.

## Development

```bash
npm install
npm run typecheck
npm test
```

The tests need no network or API keys. They cover:

- the calculations (interval normalization, discount windows and edge cases, per-currency grouping, zero-division in churn);
- the Stripe mapping, using a fake client;
- the MCP layer through the SDK client over a linked in-memory transport, and against a real `--demo` child process over stdio;
- the cache (TTL expiry, shared in-flight requests, no cached failures) and the max-items guard;
- this README: every JSON example above is compared with the live tool output.

`npm run demo` runs the CLI in demo mode straight from the TypeScript sources.

## License

MIT
