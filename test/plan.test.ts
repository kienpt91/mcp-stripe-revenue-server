import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "../src/demo-data.js";
import { CachedSource } from "../src/cached-source.js";
import { planCli } from "../src/plan.js";

describe("planCli", () => {
  it("runs on demo data with a fixed clock for --demo, without needing a key", async () => {
    const plan = planCli({ argv: ["--demo"], env: {} });
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") return;
    expect(plan.now?.()).toBe(DEMO_NOW);
    expect(plan.warning).toBeNull();
    expect((await plan.source.listSubscriptions()).length).toBeGreaterThan(10);
  });

  it("refuses to start without a key or --demo", () => {
    for (const env of [{}, { STRIPE_API_KEY: "" }, { STRIPE_API_KEY: "   " }]) {
      const plan = planCli({ argv: [], env });
      expect(plan).toMatchObject({ kind: "error" });
      if (plan.kind === "error") expect(plan.message).toContain("STRIPE_API_KEY");
    }
  });

  it("uses the live source with a restricted key and warns about unrestricted secret keys", () => {
    const restricted = planCli({ argv: [], env: { STRIPE_API_KEY: "rk_test_dummy" } });
    expect(restricted).toMatchObject({ kind: "run", warning: null });

    const secret = planCli({ argv: [], env: { STRIPE_API_KEY: "sk_test_dummy" } });
    expect(secret.kind).toBe("run");
    if (secret.kind === "run") expect(secret.warning).toMatch(/restricted key/);
  });

  it("answers --help and rejects unknown flags", () => {
    expect(planCli({ argv: ["--help"], env: {} })).toEqual({ kind: "help" });
    const unknown = planCli({ argv: ["--bogus"], env: {} });
    expect(unknown.kind).toBe("error");
    if (unknown.kind === "error") expect(unknown.message).toContain("--bogus");
  });

  it("masks emails only when REDACT_EMAILS is true", () => {
    const off = planCli({ argv: ["--demo"], env: {} });
    const explicitOff = planCli({ argv: ["--demo"], env: { REDACT_EMAILS: "false" } });
    const on = planCli({ argv: ["--demo"], env: { REDACT_EMAILS: "TRUE" } });
    expect(off).toMatchObject({ kind: "run", redactEmails: false });
    expect(explicitOff).toMatchObject({ kind: "run", redactEmails: false });
    expect(on).toMatchObject({ kind: "run", redactEmails: true });
  });

  it("rejects values that are neither true nor false for REDACT_EMAILS", () => {
    const plan = planCli({ argv: ["--demo"], env: { REDACT_EMAILS: "yes" } });
    expect(plan).toMatchObject({ kind: "error" });
    if (plan.kind === "error") expect(plan.message).toContain("REDACT_EMAILS");
  });

  it("caches live Stripe data by default and validates the tuning variables", () => {
    const live = planCli({ argv: [], env: { STRIPE_API_KEY: "rk_test_dummy" } });
    expect(live.kind === "run" && live.source).toBeInstanceOf(CachedSource);

    const tuned = planCli({
      argv: [],
      env: { STRIPE_API_KEY: "rk_test_dummy", STRIPE_CACHE_TTL_SECONDS: "0", STRIPE_MAX_ITEMS: "10" },
    });
    expect(tuned.kind).toBe("run");

    for (const env of [
      { STRIPE_CACHE_TTL_SECONDS: "-1" },
      { STRIPE_CACHE_TTL_SECONDS: "soon" },
      { STRIPE_MAX_ITEMS: "0" },
      { STRIPE_MAX_ITEMS: "1.5" },
    ]) {
      const plan = planCli({ argv: [], env: { STRIPE_API_KEY: "rk_test_dummy", ...env } });
      expect(plan.kind).toBe("error");
      if (plan.kind === "error") expect(plan.message).toContain(Object.keys(env)[0]);
    }
  });
});
