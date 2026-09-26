import { Coin, OpportunityBreakdown, OpportunityWeights } from './types.js';

export function clamp(x: number, lo = 0.0, hi = 100.0): number {
  return Math.max(lo, Math.min(hi, x));
}

export function classifyCoinRegime(coin: Coin): string {
  const effectiveLiq = coin.liquidity_usd > 0 ? coin.liquidity_usd : coin.real_sol_reserves * 150.0;
  if (effectiveLiq < 800.0 && !coin.is_new) {
    return 'ILLIQUID';
  }

  const vol = coin.volume_5m_usd;
  const pct = coin.price_change_5m;
  const buys = coin.buys_5m;
  const sells = coin.sells_5m;
  const totalTx = buys + sells;

  if (pct <= -30.0 && sells > buys * 2) {
    return 'PANIC';
  }
  if (pct >= 120.0 || (pct >= 80.0 && vol > 250000 && sells > buys * 1.5)) {
    return 'BLOW_OFF';
  }
  if (vol > 50000 && pct < -5.0 && sells >= buys) {
    return 'DISTRIBUTION';
  }
  if (pct >= 15.0 && buys > sells * 1.5 && vol > 5000) {
    return 'ACCELERATION';
  }
  if (pct >= 5.0 && buys >= sells && (vol > 2000 || coin.is_new)) {
    return 'TREND';
  }
  if (vol < 300.0 && totalTx < 3 && Math.abs(pct) < 1.0) {
    return 'DEAD';
  }
  if (Math.abs(pct) < 4.0) {
    return 'LOW_VOLATILITY';
  }
  return 'UNKNOWN';
}

export function classifyMarketRegime(coins: Coin[]): { macro_regime: string; counts: Record<string, number>; tradable_regime: boolean } {
  if (!coins.length) {
    return { macro_regime: 'UNKNOWN', counts: {}, tradable_regime: true };
  }

  const counts: Record<string, number> = {};
  for (const c of coins) {
    const r = c.regime || classifyCoinRegime(c);
    counts[r] = (counts[r] || 0) + 1;
  }

  const panicCount = counts['PANIC'] || 0;
  const blowoffCount = counts['BLOW_OFF'] || 0;
  const accelCount = counts['ACCELERATION'] || 0;
  const trendCount = counts['TREND'] || 0;
  const total = coins.length;

  let macro = 'UNKNOWN';
  let tradable = true;

  if (panicCount / total >= 0.25) {
    macro = 'PANIC';
    tradable = false;
  } else if (blowoffCount / total >= 0.2) {
    macro = 'BLOW_OFF';
  } else if (accelCount / total >= 0.2) {
    macro = 'ACCELERATION';
  } else if (trendCount / total >= 0.25) {
    macro = 'TREND';
  } else {
    macro = 'TREND';
  }

  return { macro_regime: macro, counts, tradable_regime: tradable };
}

export function evaluateRugRisk(c: Coin): { risk_state: string; risk_score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (c.top_holder_concentration > 70) {
    reasons.push('HIGH_TOP_HOLDER_CONCENTRATION');
    score += 35;
  }
  if (c.creator_holding_pct > 30) {
    reasons.push('HIGH_CREATOR_HOLDING');
    score += 40;
  }
  if (c.sells_5m > 0 && c.buys_5m === 0) {
    reasons.push('ONLY_SELLS');
    score += 25;
  }
  if (c.banned) {
    reasons.push('BANNED_CREATOR');
    score += 50;
  }
  if (c.liquidity_usd > 0 && c.liquidity_usd < 1000 && !c.is_new) {
    reasons.push('CRITICALLY_LOW_LIQUIDITY');
    score += 20;
  }

  let state = 'SAFE';
  if (score >= 60) state = 'BLOCKED';
  else if (score >= 40) state = 'HIGH_RISK';
  else if (score >= 20) state = 'CAUTION';

  return { risk_state: state, risk_score: clamp(score), reasons };
}

export function computeOpportunityScore(c: Coin, weights?: OpportunityWeights): OpportunityBreakdown {
  const effLiq = c.liquidity_usd > 0 ? c.liquidity_usd : c.real_sol_reserves * 150.0;
  const liqQuality = clamp((effLiq / 50000.0) * 100.0);
  const volAccel = clamp(Math.min(c.volume_5m_usd / 40000.0, 2.5) * 40.0 + Math.max(0, c.volume_acceleration * 0.5));
  const totalTx = c.buys_5m + c.sells_5m;
  const buyRatio = totalTx > 0 ? c.buys_5m / totalTx : 0.5;
  const buyPressure = totalTx > 0 ? clamp(buyRatio * 100.0 + Math.min(c.buys_5m, 20) * 1.5) : 40.0;
  const priceMom = clamp(50.0 + c.price_change_5m * 2.5 + c.price_acceleration * 1.5);
  const holderGrowth = clamp(60.0 - c.top_holder_concentration * 0.5 - c.creator_holding_pct * 0.5);
  const walletQuality = clamp(c.banned ? 10.0 : 70.0);
  const mcAccel = clamp(Math.min(c.market_cap_usd / 150000.0, 2.0) * 45.0 + Math.max(0, c.price_change_5m * 0.8));
  const liqAccel = clamp(50.0 + c.liquidity_acceleration);
  const trendStrength = clamp(50.0 + c.price_change_5m * 1.8 + (c.buys_5m > c.sells_5m ? 15.0 : -15.0));
  const execQuality = clamp(85.0 - (effLiq < 3000 ? 15.0 : 0.0) - (c.price_change_5m > 60 ? 20.0 : 0.0));
  const riskPenalty = clamp(c.risk_score);

  const w = weights || {
    liquidity_quality: 0.12,
    volume_acceleration: 0.12,
    buy_pressure: 0.14,
    price_momentum: 0.14,
    holder_growth: 0.08,
    wallet_quality: 0.08,
    market_cap_acceleration: 0.08,
    liquidity_acceleration: 0.08,
    trend_strength: 0.1,
    execution_quality: 0.06,
    risk_penalty: 0.15
  };

  const rawScore =
    liqQuality * w.liquidity_quality +
    volAccel * w.volume_acceleration +
    buyPressure * w.buy_pressure +
    priceMom * w.price_momentum +
    holderGrowth * w.holder_growth +
    walletQuality * w.wallet_quality +
    mcAccel * w.market_cap_acceleration +
    liqAccel * w.liquidity_acceleration +
    trendStrength * w.trend_strength +
    execQuality * w.execution_quality;

  const penaltyFactor = 1.0 - (riskPenalty / 100.0) * w.risk_penalty;
  const composite = clamp(rawScore * penaltyFactor);

  return {
    liquidity_quality: Math.round(liqQuality * 100) / 100,
    volume_acceleration: Math.round(volAccel * 100) / 100,
    buy_pressure: Math.round(buyPressure * 100) / 100,
    price_momentum: Math.round(priceMom * 100) / 100,
    holder_growth: Math.round(holderGrowth * 100) / 100,
    wallet_quality: Math.round(walletQuality * 100) / 100,
    market_cap_acceleration: Math.round(mcAccel * 100) / 100,
    liquidity_acceleration: Math.round(liqAccel * 100) / 100,
    trend_strength: Math.round(trendStrength * 100) / 100,
    execution_quality: Math.round(execQuality * 100) / 100,
    risk_penalty: Math.round(riskPenalty * 100) / 100,
    composite: Math.round(composite * 100) / 100
  };
}
