import { z } from "zod";

const Env = z.object({
  MONGODB_URI: z.string().startsWith("mongodb"),
  MONGODB_DB: z.string().default("datsolana"),
  COINGECKO_API_KEY: z.string().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(80),
  VAPID_PRIVATE_KEY: z.string().min(40),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:)/, "must start with mailto: or https:"),
  CRON_SECRET: z.string().min(32, "use at least 32 random characters"),
  NEXT_PUBLIC_APP_URL: z.url(),
});

let cached: z.infer<typeof Env> | undefined;

/** Validated lazily so `next build` works without secrets; throws a readable error at first use. */
export function env() {
  if (cached) return cached;
  const r = Env.safeParse(process.env);
  if (!r.success) throw new Error(`Invalid environment: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return (cached = r.data);
}
