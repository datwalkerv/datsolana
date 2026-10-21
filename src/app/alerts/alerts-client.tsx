"use client";

import { Banner, Button, ButtonGroup, ContentBadge, FormItem, FormLayoutGroup, Group, Header, InfoRow, Input, Placeholder, SimpleCell, Snackbar, Spinner, Switch } from "datui";
import { BellOff, BellRing, CircleAlert, Share, SquarePlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/local-time";
import { RULES, RULE_IDS, type RuleId, type Settings } from "@/lib/alerts";

type Phase = "loading" | "unsupported" | "needs-install" | "denied" | "ready" | "subscribed";

interface ServerSub {
  status: "active" | "disabled";
  settings: Settings;
  lastUsedAt: string | null;
  lastError: string | null;
  recent: { rules: string[]; at: string; conditions: string[]; score: number | null; price: number | null; delivery: string }[];
}

interface Health {
  lastRun: { at: string; ok: boolean; status: string; errors: string[] } | null;
  lastSuccessAt: string | null;
  quoteUpdatedAt: number | null;
}

function vapidBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

async function api<T>(path: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({}) as T & { error?: string }) };
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

export function AlertsClient({ vapidKey }: { vapidKey: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [server, setServer] = useState<ServerSub | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const register = useCallback(async (sub: PushSubscription, oldEndpoint?: string) => {
    const r = await api<ServerSub>("/api/subscription", "POST", { subscription: sub.toJSON(), oldEndpoint });
    if (!r.ok) throw new Error(r.data.error ?? "Could not save the subscription");
    setEndpoint(sub.endpoint);
    setServer(r.data);
    setDraft(r.data.settings);
    setPhase("subscribed");
  }, []);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    (async () => {
      if (isIos() && !isStandalone()) return setPhase("needs-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setPhase("unsupported");
      if (Notification.permission === "denied") return setPhase("denied");
      const sub = await (await registration()).pushManager.getSubscription();
      if (!sub || Notification.permission !== "granted") return setPhase("ready");
      const r = await api<ServerSub>("/api/subscription/settings", "POST", { endpoint: sub.endpoint });
      if (r.ok) {
        setEndpoint(sub.endpoint);
        setServer(r.data);
        setDraft(r.data.settings);
        setPhase("subscribed");
      } else if (r.status === 404) {
        // The server pruned it (expired or removed): re-register this device's subscription.
        await register(sub).catch(() => setPhase("ready"));
      } else setPhase("ready");
    })().catch(() => setPhase("unsupported"));
  }, [register]);

  async function enable() {
    setBusy("enable");
    try {
      // Must run directly from the tap: iOS only shows the prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setPhase(permission === "denied" ? "denied" : "ready");
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidKey) }));
      await register(sub);
      setToast({ text: "Notifications enabled" });
    } catch (e) {
      setToast({ text: (e as Error).message || "Could not enable notifications", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  const sendTest = () =>
    act("test", async () => {
      const r = await api("/api/subscription/test", "POST", { endpoint });
      if (!r.ok) {
        if (r.status === 410 || r.status === 404) setPhase("ready");
        throw new Error(r.data.error ?? "Test failed");
      }
      setToast({ text: "Test notification sent" });
    });

  const setStatus = (status: "active" | "disabled") =>
    act("status", async () => {
      const r = await api<ServerSub>("/api/subscription/settings", "PUT", { endpoint, status });
      if (!r.ok) throw new Error(r.data.error ?? "Update failed");
      setServer(r.data);
      setToast({ text: status === "active" ? "Alerts resumed" : "Alerts paused" });
    });

  const save = () =>
    act("save", async () => {
      const r = await api<ServerSub>("/api/subscription/settings", "PUT", { endpoint, settings: draft });
      if (!r.ok) throw new Error(r.data.error === "Invalid request" ? "Check the highlighted values" : (r.data.error ?? "Save failed"));
      setServer(r.data);
      setDraft(r.data.settings);
      setToast({ text: "Settings saved" });
    });

  const unsubscribe = () =>
    act("unsubscribe", async () => {
      const sub = await (await registration()).pushManager.getSubscription();
      await api("/api/subscription", "DELETE", { endpoint: sub?.endpoint ?? endpoint });
      await sub?.unsubscribe();
      setServer(null);
      setEndpoint(null);
      setPhase("ready");
      setToast({ text: "This device is unsubscribed" });
    });

  const num = (k: keyof Settings, label: string, bottom: string, step = 1) => (
    <FormItem top={label} bottom={bottom}>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={String(draft![k])}
        onChange={(e) => setDraft({ ...draft!, [k]: e.target.value === "" ? 0 : Number(e.target.value) })}
      />
    </FormItem>
  );

  return (
    <>
      {phase === "loading" && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {phase === "needs-install" && (
        <Group header={<Header>Install to enable notifications</Header>} description="iOS only delivers web push notifications to apps added to the Home Screen (iOS 16.4 or later).">
          <SimpleCell multiline hasHover={false} hasActive={false} before={<Share aria-hidden />} subtitle="In Safari, tap the Share button in the toolbar.">
            1. Tap Share
          </SimpleCell>
          <SimpleCell multiline hasHover={false} hasActive={false} before={<SquarePlus aria-hidden />} subtitle="Scroll the share sheet and choose it, then tap Add.">
            2. Add to Home Screen
          </SimpleCell>
          <SimpleCell multiline hasHover={false} hasActive={false} before={<BellRing aria-hidden />} subtitle="Launch SOL Signal from its Home Screen icon, open Alerts and tap Enable Notifications.">
            3. Open the app from your Home Screen
          </SimpleCell>
        </Group>
      )}

      {phase === "unsupported" && (
        <Placeholder icon={<BellOff aria-hidden />} title="Push notifications aren't supported here">
          This browser does not support Web Push. On iPhone, add the app to your Home Screen from Safari (iOS 16.4+). On desktop, use a current Chrome, Edge, Firefox or Safari.
        </Placeholder>
      )}

      {phase === "denied" && (
        <Placeholder icon={<BellOff aria-hidden />} title="Notifications are blocked">
          Permission was denied. On iPhone, open Settings → Notifications → SOL Signal and allow notifications, then return here. In a desktop browser, allow notifications in the site settings.
        </Placeholder>
      )}

      {phase === "ready" && (
        <Placeholder
          icon={<BellRing aria-hidden />}
          title="Get alerted when conditions change"
          action={
            <Button size="l" loading={busy === "enable"} onClick={enable} disabled={!vapidKey}>
              Enable Notifications
            </Button>
          }
        >
          You&apos;ll be notified when a configured condition occurs, such as the score crossing a threshold. Alerts describe what happened; they don&apos;t predict the market.
        </Placeholder>
      )}

      {phase === "subscribed" && server && draft && (
        <>
          <Group header={<Header>This device</Header>}>
            <SimpleCell
              hasHover={false}
              hasActive={false}
              after={
                <ContentBadge size="s" variant="secondary" appearance={server.status === "active" ? "positive" : "neutral"}>
                  {server.status === "active" ? "Enabled" : "Paused"}
                </ContentBadge>
              }
              subtitle={server.lastUsedAt ? <>Last delivery <LocalTime ms={Date.parse(server.lastUsedAt)} /></> : "No notifications delivered yet"}
            >
              Push notifications
            </SimpleCell>
            {server.lastError && (
              <div className="px-4">
                <Banner before={<CircleAlert className="text-destructive" aria-hidden />} title="Last delivery failed" subtitle={server.lastError} />
              </div>
            )}
            <div className="px-4 pt-2">
              <ButtonGroup stretched mode="vertical" gap="s">
                <Button stretched variant="secondary" loading={busy === "test"} onClick={sendTest}>
                  Send test notification
                </Button>
                {server.status === "active" ? (
                  <Button stretched variant="tertiary" loading={busy === "status"} onClick={() => setStatus("disabled")}>
                    Pause alerts
                  </Button>
                ) : (
                  <Button stretched variant="primary" loading={busy === "status"} onClick={() => setStatus("active")}>
                    Resume alerts
                  </Button>
                )}
                <Button stretched variant="tertiary" appearance="negative" loading={busy === "unsubscribe"} onClick={unsubscribe}>
                  Unsubscribe this device
                </Button>
              </ButtonGroup>
            </div>
          </Group>

          <Group header={<Header>Alert types</Header>}>
            {RULE_IDS.map((r: RuleId) => (
              <SimpleCell
                key={r}
                as="label"
                multiline
                after={<Switch checked={draft.enabled[r]} onCheckedChange={(v) => setDraft({ ...draft, enabled: { ...draft.enabled, [r]: v } })} />}
              >
                {RULES[r]}
              </SimpleCell>
            ))}
          </Group>

          <Group header={<Header>Thresholds</Header>} description="These are adjustable heuristics, not validated trading rules.">
            <FormLayoutGroup mode="horizontal">
              {num("scorePotential", "Potential opportunity score", "Default 65")}
              {num("scoreStrong", "Strong opportunity score", "Default 80")}
            </FormLayoutGroup>
            <FormLayoutGroup mode="horizontal">
              {num("fearThreshold", "Extreme Fear at or below", "Fear & Greed, default 24")}
              {num("rsiThreshold", "RSI oversold below", "Default 30", 0.5)}
            </FormLayoutGroup>
            <FormLayoutGroup mode="horizontal">
              {num("dropPct", "Price drop (%)", "Default 10%", 0.5)}
              {num("dropHours", "Drop window (hours)", "Default 24 h")}
            </FormLayoutGroup>
            {num("cooldownHours", "Cooldown per alert type (hours)", "The same alert won't repeat within this window", 0.25)}
            <div className="px-4 pt-2">
              <Button stretched size="l" loading={busy === "save"} onClick={save}>
                Save settings
              </Button>
            </div>
          </Group>

          <Group header={<Header>Recent alerts on this device</Header>}>
            {server.recent.length ? (
              server.recent.map((a) => (
                <SimpleCell
                  key={a.at + a.rules.join()}
                  multiline
                  hasHover={false}
                  hasActive={false}
                  subtitle={<LocalTime ms={Date.parse(a.at)} />}
                  after={
                    <ContentBadge size="s" variant="secondary" appearance={a.delivery === "sent" ? "positive" : "negative"}>
                      {a.delivery}
                    </ContentBadge>
                  }
                >
                  {a.conditions.join(" · ")}
                </SimpleCell>
              ))
            ) : (
              <p className="px-4 text-subhead text-muted-foreground">No alerts yet.</p>
            )}
          </Group>
        </>
      )}

      <Group header={<Header>Monitoring health</Header>}>
        {health ? (
          <div className="flex flex-col gap-3 px-4">
            <InfoRow header="Currency">USD</InfoRow>
            <InfoRow header="Last monitoring run">
              {health.lastRun ? (
                <>
                  <LocalTime ms={Date.parse(health.lastRun.at)} /> · {health.lastRun.ok ? "OK" : `Issues: ${health.lastRun.errors.join("; ") || health.lastRun.status}`}
                </>
              ) : (
                "Never"
              )}
            </InfoRow>
            <InfoRow header="Last successful run">{health.lastSuccessAt ? <LocalTime ms={Date.parse(health.lastSuccessAt)} /> : "Never"}</InfoRow>
            <InfoRow header="Price data as of">{health.quoteUpdatedAt ? <LocalTime ms={health.quoteUpdatedAt} /> : "—"}</InfoRow>
            <InfoRow header="Notification permission">{typeof Notification === "undefined" ? "Unsupported" : Notification.permission}</InfoRow>
          </div>
        ) : (
          <p className="px-4 text-subhead text-muted-foreground">Loading…</p>
        )}
      </Group>

      {toast && (
        <Snackbar key={toast.text} onClosed={() => setToast(null)} before={toast.error ? <CircleAlert className="text-destructive" aria-hidden /> : undefined}>
          {toast.text}
        </Snackbar>
      )}
    </>
  );
}
