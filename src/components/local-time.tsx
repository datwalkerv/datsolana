"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/format";

/** Renders in the viewer's time zone after hydration (the server only knows UTC). */
export function LocalTime({ ms, withAgo = true }: { ms: number; withAgo?: boolean }) {
  const [text, setText] = useState(() => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC");
  useEffect(() => {
    const update = () =>
      setText(`${new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${withAgo ? ` (${ago(ms)})` : ""}`);
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [ms, withAgo]);
  return <time dateTime={new Date(ms).toISOString()}>{text}</time>;
}
