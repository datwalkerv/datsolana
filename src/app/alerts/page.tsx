import type { Metadata } from "next";
import { PanelHeader } from "datui";
import { AlertsClient } from "./alerts-client";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PanelHeader>Alerts</PanelHeader>
      <AlertsClient vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
    </>
  );
}
