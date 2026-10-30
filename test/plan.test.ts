import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "../src/demo-data.js";
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
});
