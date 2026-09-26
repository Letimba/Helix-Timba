# ⚡ HELIX 5.4 Industrial — Solana Pump.fun High-Frequency Terminal

[![GitHub stars](https://img.shields.io/badge/GitHub-Star_Us-00ffa3?logo=github&style=for-the-badge)](https://github.com)
[![Solana](https://img.shields.io/badge/Solana-Mainnet_Ready-00ffa3?logo=solana&style=for-the-badge)](https://solana.com)
[![License](https://img.shields.io/badge/License-MIT-00ffa3?style=for-the-badge)](LICENSE)
[![Latency](https://img.shields.io/badge/Pipeline_Latency-<50ms-00ffa3?style=for-the-badge)](https://pump.fun)

> **High-speed Solana memecoin intelligence, sniper scanner & non-custodial live execution terminal focused on Pump.fun & PumpSwap.**
> Built with Node.js, Express, WebSocket streaming, and a zero-dependency ultra-low latency responsive web terminal.

---

## 🌟 Key Features

- **⚡ Sub-50ms Discovery Engine**: High-frequency parallel queries directly scanning on-chain Solana token boosts, profiles, and trending liquidity pools.
- **⚡ 1-Click Live Trading**: Non-custodial wallet integration (Phantom & Solflare). No private keys or seed phrases ever leave your browser.
- **⚡ Dark / Light Theme Engine**: Ultra-deep pitch black (`#020507`) with electric emerald neon (`#00ffa3`) accent, switchable to high-clarity daylight terminal mode.
- **✈ Instant Telegram Alerts**: Push notifications directly to your phone via custom Telegram bot for trade entries, take-profit triggers, stop-losses, and rug pull detections.
- **🛡 11-Factor Opportunity & Rug Risk Engine**: Automated scoring of liquidity health, buyer momentum, creator holding ratio, and bonding curve progress.
- **💎 Built-in SaaS / Pro Subscription Model**: Ready-to-monetize tier architecture with Community, Pro Sniper, and Institutional plans with Solana Pay checkout integration.
- **📈 Advanced Strategies**: Pre-tuned algorithms including `trend-following`, `sniper`, `micro-scalper`, `breakout`, `momentum`, and `volatility-expansion`.

---

## 🚀 Quick Start (Node.js 22)

```bash
# Clone the repository
git clone https://github.com/your-username/helix-pumpfun-terminal.git
cd helix-pumpfun-terminal

# Install dependencies
npm install

# Start development server
npm run dev
```

Open your browser at `http://localhost:3000`.

---

## ⚙ Configuration (`helix.config.json` & `.env`)

```env
HELIX_HOST=127.0.0.1
HELIX_PORT=3000
PUMPFUN_BASE=https://frontend-api-v3.pump.fun
PUMPFUN_AUTH_TOKEN=
DEXSCREENER_BASE=https://api.dexscreener.com
POLL_SECONDS=1.0
STARTING_SOL=10.0
AUTO_TRADE=true
MAX_POSITIONS=15
MAX_TRADE_SOL=1.00
MAX_DAILY_LOSS_SOL=10.00
STRATEGY=trend-following
```

---

## 💎 Monetization & Pro SaaS Architecture

HELIX includes a turnkey multi-tier subscription engine:
1. **Community Free (0 SOL)**: Basic scanner, paper trading, and standard latency.
2. **Pro Sniper (0.75 SOL / Month)**: High-priority Geyser RPC, sub-50ms polling, 25 max positions, Jito MEV front-run protection, and instant VIP Telegram alerts.
3. **Institutional (2.5 SOL / Month)**: Multi-wallet execution, dedicated RPC clusters (Tokyo/NY/FRA), custom strategy scripting, and white-label branding.

---

## 🔒 Non-Custodial Security Notice

HELIX never requests, stores, or transmits your private keys or seed phrases. All live transactions require manual user approval via your installed browser wallet (Phantom or Solflare).

---

## 📄 License

MIT License — Feel free to star, fork, and build your own trading operation.
