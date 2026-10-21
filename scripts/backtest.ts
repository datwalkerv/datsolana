/**
 * Offline backtest of the scoring model over the history available on the free CoinGecko tier (365 days).
 * Usage: pnpm backtest [--threshold 65] [--fee 0.001] [--slippage 0.002]
 */
import { backtest } from "../src/lib/backtest";
import { finalizedDaily } from "../src/lib/indicators";
import { alternativeMe, coingecko } from "../src/lib/providers";

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};

async function main() {
  const cg = coingecko(process.env.COINGECKO_API_KEY);
  const [sol, btc, fg] = await Promise.all([cg.daily("solana", 365), cg.daily("bitcoin", 365), alternativeMe.fearGreed(0)]);
  for (const r of [sol, btc, fg]) if (!r.ok) throw new Error(r.error);
  const now = Date.now();
  const s = finalizedDaily(sol.ok ? sol.data : [], now).candles;
  const b = finalizedDaily(btc.ok ? btc.data : [], now).candles;
  const result = backtest(s, b, fg.ok ? fg.data : [], {
    threshold: arg("threshold", 65),
    fee: arg("fee", 0.001),
    slippage: arg("slippage", 0.002),
    devFraction: 0.6,
  });
  console.log(`Backtest ${result.from} → ${result.to} (first 60% development, last 40% held-out evaluation)\n`);
  console.table({ development: result.development, evaluation: result.evaluation });
  console.log(
    "\nSmall sample (≈1 year, few signals). Returns include fees and slippage on entry and exit.\n" +
      "Past performance does not predict future returns; this is not evidence the model works.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
