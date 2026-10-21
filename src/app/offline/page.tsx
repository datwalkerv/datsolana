import { PanelHeader, Placeholder } from "datui";
import { WifiOff } from "lucide-react";

export const dynamic = "force-static";

/** Precached by the service worker and served when a navigation fails offline. */
export default function OfflinePage() {
  return (
    <>
      <PanelHeader>SOL Signal</PanelHeader>
      <Placeholder icon={<WifiOff aria-hidden />} title="You’re offline">
        Market data can&apos;t be shown without a connection, so nothing here is live. Reconnect, then reopen the app to load current data.
      </Placeholder>
    </>
  );
}
