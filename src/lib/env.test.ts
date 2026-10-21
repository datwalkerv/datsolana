import { beforeEach, describe, expect, it, vi } from "vitest";

const base = {
  MONGODB_URI: "mongodb://localhost/x",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "B".repeat(87),
  VAPID_PRIVATE_KEY: "k".repeat(43),
  CRON_SECRET: "s".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://app.example",
};

describe("env VAPID_SUBJECT", () => {
  beforeEach(() => vi.resetModules());
  const load = async (subject: string) => {
    Object.assign(process.env, base, { VAPID_SUBJECT: subject });
    return (await import("./env")).env().VAPID_SUBJECT;
  };
  it("prefixes a bare email with mailto:", async () => expect(await load("me@example.com")).toBe("mailto:me@example.com"));
  it("keeps mailto: subjects", async () => expect(await load("mailto:me@example.com")).toBe("mailto:me@example.com"));
  it("keeps https: subjects", async () => expect(await load("https://example.com")).toBe("https://example.com"));
  it("rejects anything else", async () => expect(load("example")).rejects.toThrow(/VAPID_SUBJECT/));
});
