import webpush from "web-push";
import type { RuleId } from "../alerts";
import type { SnapshotDoc } from "../db";

export interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type SendResult = { ok: true } | { ok: false; expired: boolean; error: string };
export type Sender = (target: PushTarget, payload: string, vapid: Vapid) => Promise<SendResult>;

const MAX_PAYLOAD = 3000; // Web Push allows ~4KB after encryption overhead.

/**
 * Declarative Web Push shape (iOS/iPadOS 18.4+ can display it without the service worker);
 * our service worker parses the same JSON for older iOS and other browsers.
 */
export function buildPayload(n: { title: string; body: string; url: string; tag?: string }) {
  let body = n.body;
  let json = "";
  for (;;) {
    json = JSON.stringify({ web_push: 8030, notification: { title: n.title, body, navigate: n.url, tag: n.tag, lang: "en-US", dir: "ltr" } });
    if (json.length <= MAX_PAYLOAD || body.length < 20) return json;
    body = body.slice(0, Math.floor(body.length * 0.8)) + "…";
  }
}

const TITLES: [RuleId, string][] = [
  ["score_strong", "Strong SOL Opportunity Signal"],
  ["score_potential", "SOL Market Opportunity Detected"],
  ["alignment", "SOL Market Opportunity Detected"],
  ["recovery", "SOL Recovery Signal"],
  ["extreme_fear", "Crypto Market Enters Extreme Fear"],
  ["rsi_oversold", "SOL RSI Oversold"],
  ["price_drop", "SOL Price Drop"],
  ["deterioration", "SOL Setup Weakening"],
];

export function alertNotification(rules: RuleId[], conditions: string[], s: SnapshotDoc, appUrl: string) {
  const title = TITLES.find(([r]) => rules.includes(r))?.[1] ?? "SOL Market Alert";
  const lines = [
    `SOL/USD: $${s.quote?.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"} · Score ${s.score ?? "—"}/100`,
    `Status: ${s.classification?.label ?? "Unavailable"}`,
    [s.fearGreed && `Fear & Greed: ${s.fearGreed.value} — ${s.fearGreed.label}`, s.indicators.rsi !== null && `RSI (14): ${s.indicators.rsi.toFixed(1)}`]
      .filter(Boolean)
      .join(" · "),
    `Why: ${[...conditions, ...s.reasons.supporting.slice(0, 1)].join("; ")}`,
    s.reasons.contradicting.length ? `Risk: ${s.reasons.contradicting.slice(0, 2).join("; ")}` : "",
    "Tap to view the full analysis.",
  ].filter(Boolean);
  return buildPayload({ title, body: lines.join("\n"), url: `${appUrl}/?from=alert`, tag: `sol-${rules[0]}` });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send with up to 2 retries on transient failures (429, 5xx, network). 404/410 mean the subscription is gone. */
export const sendPush: Sender = async (target, payload, vapid) => {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await webpush.sendNotification(target, payload, {
        vapidDetails: vapid,
        TTL: 6 * 3600,
        urgency: "high",
        timeout: 8000,
      });
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      last = `${status ?? "network"}: ${(e as Error).message}`.slice(0, 300);
      if (status === 404 || status === 410) return { ok: false, expired: true, error: last };
      const transient = status === undefined || status === 429 || status >= 500;
      if (!transient) break;
      if (attempt < 2) await sleep(500 * 3 ** attempt);
    }
  }
  return { ok: false, expired: false, error: last };
};
