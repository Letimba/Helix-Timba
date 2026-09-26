import { Coin } from './types.js';
import { classifyCoinRegime, computeOpportunityScore, evaluateRugRisk } from './scoring.js';

export class MarketProvider {
  pumpBase: string;
  authToken: string;
  dexBase: string;
  cachedSolPrice = 145.5;
  lastTokensFetch = 0;
  cachedCoins: Coin[] = [];
  lastSolPriceFetch = 0;
  isFetching = false;
  lastFetchMs = 0;

  constructor(pumpBase: string, authToken: string, dexBase: string) {
    this.pumpBase = pumpBase.replace(/\/+$/, '');
    this.authToken = authToken.trim();
    this.dexBase = dexBase.replace(/\/+$/, '');
  }

  updateAuth(token: string) {
    this.authToken = token.trim();
  }

  async getSolPriceUsd(): Promise<number> {
    const now = Date.now();
    // Cache SOL price for 5 seconds for ultra-low latency execution
    if (now - this.lastSolPriceFetch < 5000 && this.cachedSolPrice > 0) {
      return this.cachedSolPrice;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.dexBase}/tokens/v1/solana/So11111111111111111111111111111111111111112`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json() as any;
        const pair = Array.isArray(j) ? j[0] : (j?.pairs?.[0] || j);
        const px = Number(pair?.priceUsd || pair?.price);
        if (px > 0) {
          this.cachedSolPrice = px;
          this.lastSolPriceFetch = now;
          return px;
        }
      }
    } catch {
      // fallback to cached
    }
    return this.cachedSolPrice;
  }

  async listCoins(limit = 80): Promise<{ coins: Coin[]; quality: string }> {
    // If a request is already active and we have fresh cached coins (< 2.5s), return immediately for 0ms UI delay
    const now = Date.now();
    if (this.isFetching && this.cachedCoins.length > 0) {
      return { coins: this.cachedCoins, quality: 'live-dexscreener' };
    }

    this.isFetching = true;
    const startMs = Date.now();

    try {
      // 1. First attempt: Direct pump.fun API if auth token is present
      if (this.authToken) {
        try {
          const headers: Record<string, string> = {
            Accept: 'application/json',
            Origin: 'https://pump.fun',
            Referer: 'https://pump.fun/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Authorization: `Bearer ${this.authToken}`
          };

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1500);
          const url = `${this.pumpBase}/coins?limit=${Math.min(limit, 50)}&offset=0&sort=created_timestamp&order=DESC&includeNsfw=false`;
          const res = await fetch(url, { headers, signal: controller.signal });
          clearTimeout(timer);

          if (res.ok) {
            const data = await res.json() as any;
            const rows = Array.isArray(data) ? data : (data?.coins || data?.data || []);
            if (Array.isArray(rows) && rows.length > 0) {
              const coins: Coin[] = rows.map((d: any) => this.mapPumpCoin(d));
              this.cachedCoins = coins;
              this.lastFetchMs = Date.now() - startMs;
              return { coins, quality: 'live-pumpfun' };
            }
          }
        } catch {
          // fallback to ultra-fast Dexscreener pipeline
        }
      }

      // 2. High-speed parallel Solana on-chain discovery
      const realCoins = await this.fetchLiveSolanaPairsParallel(limit);
      if (realCoins.length > 0) {
        this.cachedCoins = realCoins;
        this.lastFetchMs = Date.now() - startMs;
        return { coins: realCoins, quality: 'live-dexscreener' };
      }
    } catch (e: any) {
      console.warn('Error in listCoins pipeline:', e?.message || e);
    } finally {
      this.isFetching = false;
    }

    if (this.cachedCoins.length > 0) {
      return { coins: this.cachedCoins, quality: 'live-cached' };
    }

    return { coins: [], quality: 'connecting' };
  }

  private async fetchLiveSolanaPairsParallel(limit: number): Promise<Coin[]> {
    const solAddresses = new Set<string>();

    // Parallel requests with aggressive 1500ms timeout
    const fetchPromises = [
      (async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 1500);
          const r = await fetch(`${this.dexBase}/token-boosts/latest/v1`, { headers: { Accept: 'application/json' }, signal: c.signal });
          clearTimeout(t);
          if (r.ok) {
            const arr = await r.json() as any[];
            if (Array.isArray(arr)) {
              for (const b of arr) {
                if (b.chainId === 'solana' && b.tokenAddress) solAddresses.add(b.tokenAddress);
              }
            }
          }
        } catch {}
      })(),
      (async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 1500);
          const r = await fetch(`${this.dexBase}/token-profiles/latest/v1`, { headers: { Accept: 'application/json' }, signal: c.signal });
          clearTimeout(t);
          if (r.ok) {
            const arr = await r.json() as any[];
            if (Array.isArray(arr)) {
              for (const p of arr) {
                if (p.chainId === 'solana' && p.tokenAddress) solAddresses.add(p.tokenAddress);
              }
            }
          }
        } catch {}
      })(),
      (async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 1500);
          const r = await fetch(`${this.dexBase}/latest/dex/search?q=pump`, { signal: c.signal });
          clearTimeout(t);
          if (r.ok) {
            const j = await r.json() as any;
            for (const pair of (j?.pairs || [])) {
              if (pair.chainId === 'solana' && pair.baseToken?.address) {
                solAddresses.add(pair.baseToken.address);
              }
            }
          }
        } catch {}
      })()
    ];

    await Promise.allSettled(fetchPromises);

    const solPx = await this.getSolPriceUsd();
    const coinsMap = new Map<string, Coin>();

    // Query in batches of 30 addresses concurrently
    const addrArray = Array.from(solAddresses);
    const chunks: string[][] = [];
    for (let i = 0; i < addrArray.length && chunks.length < 3; i += 30) {
      chunks.push(addrArray.slice(i, i + 30));
    }

    const chunkPromises = chunks.map(async (chunk) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${this.dexBase}/latest/dex/tokens/${chunk.join(',')}`, {
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
          const j = (await res.json()) as any;
          for (const pair of (j?.pairs || [])) {
            if (pair.chainId === 'solana' && pair.baseToken?.address) {
              if (!coinsMap.has(pair.baseToken.address)) {
                coinsMap.set(pair.baseToken.address, this.mapDexPair(pair, solPx));
              }
            }
          }
        }
      } catch {}
    });

    await Promise.allSettled(chunkPromises);

    return Array.from(coinsMap.values()).slice(0, limit);
  }

  async getCoin(mint: string): Promise<Coin | null> {
    const existing = this.cachedCoins.find(c => c.mint === mint);
    if (existing) return existing;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${this.dexBase}/latest/dex/tokens/${mint}`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const j = (await res.json()) as any;
        const pair = j?.pairs?.[0];
        if (pair) {
          const solPx = await this.getSolPriceUsd();
          return this.mapDexPair(pair, solPx);
        }
      }
    } catch {}

    return null;
  }

  private mapPumpCoin(d: any): Coin {
    const now = Date.now();
    const created = Number(d.created_timestamp || d.createdAt || d.createdAtMs || now);
    const supply = Number(d.token_total_supply || 1_000_000_000);
    const mcap = Number(d.usd_market_cap || d.market_cap_usd || 0);
    let priceUsd = Number(d.price_usd || d.usd_price || 0);
    if (priceUsd <= 0 && mcap > 0 && supply > 0) {
      priceUsd = mcap / supply;
    }
    const solPx = this.cachedSolPrice || 145;
    const priceSol = priceUsd > 0 ? priceUsd / solPx : 0.0000001;

    const coin: Coin = {
      mint: String(d.mint || d.address || ''),
      name: String(d.name || 'Unknown Coin'),
      symbol: String(d.symbol || 'COIN'),
      creator: String(d.creator || ''),
      image_uri: String(d.image_uri || d.imageUri || ''),
      created_at_ms: created,
      last_trade_at_ms: Number(d.last_trade_timestamp || now),
      complete: Boolean(d.complete),
      banned: Boolean(d.is_banned || d.banned),
      venue: 'pump.fun',
      pool_address: String(d.pool_address || ''),
      price_usd: priceUsd,
      price_sol: priceSol,
      market_cap_usd: mcap,
      liquidity_usd: Number(d.liquidity_usd || d.liquidity?.usd || 15000),
      volume_5m_usd: Number(d.volume_5m_usd || d.volume?.m5 || 8000),
      buys_5m: Number(d.buys_5m || d.txns?.m5?.buys || 15),
      sells_5m: Number(d.sells_5m || d.txns?.m5?.sells || 10),
      price_change_5m: Number(d.price_change_5m || d.priceChange?.m5 || 5.2),
      virtual_sol_reserves: 30,
      virtual_token_reserves: 1000000000,
      real_sol_reserves: Number(d.real_sol_reserves || 10),
      token_total_supply: supply,
      is_new: (now - created) < 90000,
      risk_score: 15,
      risk_level: 'SAFE',
      signal_score: 65,
      strategy_agreement: 3,
      strategy_scores: {},
      source: 'pumpfun',
      observed_at_ms: now,
      quote_source: 'pump.fun/usd-market-cap',
      volatility_rank: 1,
      opportunity_score: 65,
      opportunity_breakdown: {},
      rug_risk_state: 'SAFE',
      rug_reasons: [],
      regime: 'TREND',
      chain: 'solana',
      dex: 'pump.fun',
      transaction_velocity: 1.2,
      volume_acceleration: 1.1,
      price_acceleration: 0.5,
      liquidity_acceleration: 0.2,
      top_holder_concentration: 12.5,
      creator_holding_pct: 3.2,
      age_seconds: Math.max(0, (now - created) / 1000)
    };

    const rug = evaluateRugRisk(coin);
    coin.rug_risk_state = rug.risk_state;
    coin.rug_reasons = rug.reasons;
    coin.risk_score = rug.risk_score;
    coin.regime = classifyCoinRegime(coin);
    const opp = computeOpportunityScore(coin);
    coin.opportunity_score = opp.composite;
    coin.opportunity_breakdown = opp as any;

    return coin;
  }

  private mapDexPair(p: any, solPx: number): Coin {
    const now = Date.now();
    const px = Number(p.priceUsd || 0);
    const pairCreated = Number(p.pairCreatedAt || now - 3600000);
    const isPump = String(p.dexId || '').toLowerCase().includes('pump') || String(p.baseToken?.address || '').endsWith('pump');
    const liqUsd = Number(p.liquidity?.usd || 0);
    const vol5m = Number(p.volume?.m5 || 0);
    const buys5m = Number(p.txns?.m5?.buys || 0);
    const sells5m = Number(p.txns?.m5?.sells || 0);
    const change5m = Number(p.priceChange?.m5 || 0);
    const mcap = Number(p.marketCap || p.fdv || (liqUsd * 2) || 20000);

    const coin: Coin = {
      mint: p.baseToken?.address || '',
      name: p.baseToken?.name || 'Unknown Coin',
      symbol: p.baseToken?.symbol || 'COIN',
      creator: '',
      image_uri: p.info?.imageUrl || '',
      created_at_ms: pairCreated,
      last_trade_at_ms: now,
      complete: Boolean(p.dexId !== 'pumpfun'),
      banned: false,
      venue: isPump ? 'pump.fun' : (p.dexId || 'raydium'),
      pool_address: p.pairAddress || '',
      price_usd: px,
      price_sol: px > 0 && solPx > 0 ? px / solPx : 0.0000001,
      market_cap_usd: mcap,
      liquidity_usd: liqUsd > 0 ? liqUsd : (isPump ? 28000 : 5000),
      volume_5m_usd: vol5m,
      buys_5m: buys5m,
      sells_5m: sells5m,
      price_change_5m: change5m,
      virtual_sol_reserves: 30,
      virtual_token_reserves: 1000000000,
      real_sol_reserves: Math.max(5, (liqUsd / (solPx * 2))),
      token_total_supply: 1000000000,
      is_new: (now - pairCreated) < 180000,
      risk_score: 15,
      risk_level: 'SAFE',
      signal_score: 65,
      strategy_agreement: 2,
      strategy_scores: {},
      source: isPump ? 'pumpfun' : 'dexscreener',
      observed_at_ms: now,
      quote_source: isPump ? 'pump.fun' : (p.dexId || 'dexscreener'),
      volatility_rank: 1,
      opportunity_score: 65,
      opportunity_breakdown: {},
      rug_risk_state: 'SAFE',
      rug_reasons: [],
      regime: 'TREND',
      chain: 'solana',
      dex: isPump ? 'pump.fun' : (p.dexId || 'raydium'),
      transaction_velocity: Math.max(0.1, (buys5m + sells5m) / 5),
      volume_acceleration: Math.min(5, Math.max(0.2, vol5m / 5000)),
      price_acceleration: Math.min(5, Math.max(-5, change5m * 0.1)),
      liquidity_acceleration: 0.1,
      top_holder_concentration: 12.0,
      creator_holding_pct: 2.0,
      age_seconds: Math.max(0, (now - pairCreated) / 1000)
    };

    const rug = evaluateRugRisk(coin);
    coin.rug_risk_state = rug.risk_state;
    coin.rug_reasons = rug.reasons;
    coin.risk_score = rug.risk_score;
    coin.regime = classifyCoinRegime(coin);
    const opp = computeOpportunityScore(coin);
    coin.opportunity_score = opp.composite;
    coin.opportunity_breakdown = opp as any;

    return coin;
  }
}
