<div align="center">

<img src="./public/icon.svg" width="10%" alt="SOL Signal" style="border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);" />

# SOL Signal

**Read the market. Then decide.**

A pocket-sized Solana market monitor that explains what it sees and pings your iPhone when your conditions are met.

</div>

## ✨ Key Features

- **🎯 Opportunity Score**: Six indicators combine into one 0–100 score: sentiment, trend, RSI, drawdown, strength against BTC, and volume. The result is a plain label, from *Very unfavorable* to *Strong potential opportunity*.
- **🧾 Why This Signal?**: Every score explains itself. Supporting and contradicting factors are listed in plain sentences, built from real data with fixed rules. Nothing is AI-generated or guessed.
- **📊 Interactive Price Chart**: View 24H, 7D, 30D, 90D and 1Y, with optional 20-day and 50-day moving averages and a crosshair tooltip.
- **😨 Fear & Greed Panel**: Shows today's crypto-market sentiment, the change since yesterday, and a 7-day history.
- **🧪 Technical Indicator Cards**: RSI (14), 20-day and 50-day MAs, drawdown from the 90-day high, SOL vs BTC, and volume trend. Each card says whether it supports or contradicts the setup.
- **🔔 iPhone Push Alerts**: Get real server-sent Web Push notifications, even when the app is closed. Choose your own triggers:
  - the score crossing 65 or 80
  - Extreme Fear
  - RSI oversold
  - sharp drops
  - recoveries after a drawdown
  - several indicators lining up
  - a good setup turning bad
- **🎛️ Per-Device Settings**: Each phone keeps its own thresholds, alert types and cooldowns. You can pause, resume or unsubscribe at any time.
- **🕰️ Signal History**: A daily score chart and a timeline of every classification change, with price, RSI, sentiment and the model version at that moment.
- **🧮 Honest Backtesting**: `pnpm backtest` replays the model day by day with no look-ahead. It reports the following against buy-and-hold, separately for a development period and a held-out period:
  - forward returns, net of fees and slippage
  - drawdowns
  - losing frequency
- **📱 Installable PWA**: Add it to your Home Screen and it runs full-screen, respects the safe areas, follows light and dark mode, and has an offline screen.
- **🌟 Premium Minimal UI**: Built on [datui](https://datui.vercel.app/docs), with calm surfaces, dense but readable data, and a Solana-violet accent.

## 🛠️ Technology Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
- **Runtime & View Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with [datui](https://datui.vercel.app/docs) components
- **Charts**: [Recharts](https://recharts.org/)
- **Type Safety**: [TypeScript](https://www.typescriptlang.org/) (strict) and [Zod](https://zod.dev/)
- **Database**: [MongoDB Atlas](https://www.mongodb.com/atlas) (free M0 tier)
- **Notifications**: Web Push with VAPID through [web-push](https://www.npmjs.com/package/web-push), in the Declarative Web Push format
- **Market Data**: [CoinGecko](https://www.coingecko.com/en/api) and the [Alternative.me Fear & Greed Index](https://alternative.me/crypto/fear-and-greed-index/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Testing**: [Vitest](https://vitest.dev/) with [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server)
- **Hosting**: [Vercel](https://vercel.com/) Hobby, with [cron-job.org](https://cron-job.org) for 15-minute monitoring

## 📈 How It Thinks

### The Score
- The weights are fixed: sentiment 20%, trend 25%, RSI 20%, drawdown 15%, relative to BTC 10%, volume 10%.
- **Extreme Fear isn't a buy button.** On its own it's capped. It only scores high once price action confirms a recovery.
- **Oversold isn't a recovery.** RSI must climb back above 40, and price must reclaim its 20-day average, before momentum counts as confirmed.
- **Conflict gets damped.** When the indicators disagree, the score is pulled toward neutral, and the explanation says so.
- **No data means no score.** A stale or missing price, or too little history, produces *Unavailable* instead of a misleading number.
- Every snapshot records its model version, so past and present scores stay comparable.

### Monitoring
- Monitoring runs on the server every 15 minutes. It never depends on the dashboard being open.
- Each run is idempotent. Repeat calls in the same 15-minute window reuse one snapshot and can't send duplicate alerts.
- Alerts fire on *changes*, like a threshold being crossed, not on every refresh. Each alert type has its own cooldown, and everything triggered in one run arrives as a single notification.

## ⚖️ Privacy & Security

### No Accounts
- There's no sign-up and no login. The dashboard is public and read-only, because market data isn't personal.
- Alert settings belong to the device that subscribed. A phone can only read or change its own settings, by proving it holds its own unguessable push endpoint.
- That endpoint always travels in the request body, never in a URL, so it stays out of logs and history.

### Push Notifications
- Notifications are opt-in. Permission is only requested after you tap **Enable Notifications**.
- Payloads are end-to-end encrypted by the Web Push protocol, so the push services (Apple, Google, Mozilla, Microsoft) can't read them.
- A subscription that expires (the push service reports it as gone) is deleted from the database automatically.
- On iPhone, Apple only delivers web push to apps added to the Home Screen (iOS 16.4+). SOL Signal detects a plain Safari tab and shows a short install guide.

### Data & Retention
- **Nothing beyond what alerts need.** No analytics, no third-party scripts, no cookies.
- The only data stored:
  - market snapshots
  - each subscribed device's push endpoint, keys and settings
  - the alerts sent to that device
  - short-lived rate-limit counters
- Retention:
  - 15-minute snapshots expire after 90 days; one snapshot per day is kept for history.
  - Alert records expire after a year, and monitoring logs after 30 days.
  - Rate-limit counters, which include the requester's IP, expire within a minute.
- Unsubscribing deletes the device's subscription and settings immediately.

<br>

> **Not financial advice.** SOL Signal is a decision-support tool. It never trades. Its thresholds are heuristics, not proven trading rules, and past signals don't predict future returns.

<br>

**Made with love for love. 💙**  
*Read the market. Then decide.*
