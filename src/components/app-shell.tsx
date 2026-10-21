"use client";

import { AppRoot, ConfigProvider, Epic, Panel, Snackbar, Tabbar, TabbarItem, View } from "datui";
import { Activity, BellRing, History, Info } from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/", label: "Market", icon: Activity },
  { href: "/history", label: "History", icon: History },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/about", label: "About", icon: Info },
] as const;

/** Register the service worker and surface "update available" instead of swapping code mid-session. */
function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let reg: ServiceWorkerRegistration | undefined;
    const track = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((r) => {
      reg = r;
      track(r);
    });
    const onVisible = () => document.visibilityState === "visible" && reg?.update().catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return { waiting, apply: () => waiting?.postMessage({ type: "SKIP_WAITING" }) };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = TABS.find((t) => (t.href === "/" ? pathname === "/" : pathname.startsWith(t.href)))?.href ?? "/";
  const sw = useServiceWorker();

  return (
    <ConfigProvider colorScheme="system">
      <AppRoot>
        <Epic
          className="min-h-dvh"
          activeStory={active}
          tabbar={
            <Tabbar aria-label="Main">
              {TABS.map(({ href, label, icon: Icon }) => (
                <TabbarItem key={href} as={NextLink} href={href} label={label} selected={active === href}>
                  <Icon aria-hidden />
                </TabbarItem>
              ))}
            </Tabbar>
          }
        >
          <View id={active} activePanel={active}>
            {/* Fill the screen above the tabbar so short pages don't leave a gap. */}
            <Panel id={active} className="safe-x min-h-[calc(100dvh-var(--dt-height-tabbar)-env(safe-area-inset-bottom))]">
              <div className="mx-auto w-full max-w-3xl pb-4">{children}</div>
            </Panel>
          </View>
        </Epic>
        {sw.waiting && (
          <Snackbar duration={null} action="Reload" onActionClick={sw.apply} subtitle="Reload to get the latest version.">
            Update available
          </Snackbar>
        )}
      </AppRoot>
    </ConfigProvider>
  );
}
