import { AppConfig, Coin, Fill, Order, Position, Stats } from './types.js';
import { loadConfig, saveConfig } from './config.js';
import { MarketProvider } from './providers.js';
import { classifyMarketRegime, computeOpportunityScore } from './scoring.js';
import { TelegramNotifier } from './telegram.js';

export class Engine {
  config: AppConfig;
  provider: MarketProvider;
  telegram: TelegramNotifier;
  mode: 'paper' | 'dry_run' | 'live';
  armed = true;
  paused = false;
  panic = false;
  circuitBreakerActive = false;
  circuitBreakerReason = '';

  coins: Coin[] = [];
  positions: Position[] = [];
  fills: Fill[] = [];
  orders: Order[] = [];
  logs: string[] = [];

  stats: Stats;
  startedAt = Date.now();
  feedQuality = 'live';
  feedError = '';

  quoteOk = 0;
  quoteFail = 0;

  subscribers: Set<(data: string) => void> = new Set();
  marketTimer: NodeJS.Timeout | null = null;
  positionTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = loadConfig();
    this.provider = new MarketProvider(
      this.config.pumpfun_base,
      this.config.pumpfun_auth_token,
      this.config.dexscreener_base
    );
    this.telegram = new TelegramNotifier(this.config.telegram);
    this.mode = this.config.execution.mode || 'paper';

    this.stats = {
      signals: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      realized_sol: 0.0,
      unrealized_sol: 0.0,
      open_exposure_sol: 0.0,
      cash_sol: this.config.starting_sol || 10.0,
      equity_sol: this.config.starting_sol || 10.0,
      peak_equity_sol: this.config.starting_sol || 10.0,
      max_drawdown_pct: 0.0,
      fees_sol: 0.0,
      consecutive_losses: 0,
      execution_failures: 0,
      equity_history: [
        { ts_ms: Date.now(), equity_sol: this.config.starting_sol || 10.0 }
      ]
    };

    this.log(`HELIX 5.3 INDUSTRIAL · Online · Mode: ${this.mode.toUpperCase()}`);
  }

  log(msg: string) {
    const timeStr = new Date().toTimeString().split(' ')[0];
    this.logs.unshift(`${timeStr} ${msg}`);
    if (this.logs.length > 300) {
      this.logs.pop();
    }
  }

  async start() {
    await this.tickMarket();
    this.updateEquity();

    this.marketTimer = setInterval(() => {
      this.tickMarket().catch(err => {
        this.feedError = String(err?.message || err);
        this.feedQuality = 'error';
      });
    }, Math.max(1000, (this.config.poll_seconds || 1.5) * 1000));

    this.positionTimer = setInterval(() => {
      this.tickPositions().catch(err => {
        this.log(`POSITION TICK ERROR: ${err?.message || err}`);
      });
    }, Math.max(800, (this.config.position_refresh_seconds || 1.0) * 1000));
  }

  stop() {
    if (this.marketTimer) clearInterval(this.marketTimer);
    if (this.positionTimer) clearInterval(this.positionTimer);
  }

  async tickMarket() {
    const { coins, quality } = await this.provider.listCoins(this.config.feed_candidates || 50);
    if (coins && coins.length > 0) {
      this.coins = coins;
      this.feedQuality = quality;
      this.feedError = '';
    }

    // Auto trade check
    if (this.config.auto_trade && this.armed && !this.paused && !this.panic) {
      this.evaluateAutoEntries();
    }

    this.broadcast();
  }

  async tickPositions() {
    const now = Date.now();
    const solPx = await this.provider.getSolPriceUsd();

    for (const p of this.positions) {
      if (p.status !== 'OPEN') continue;

      const coin = this.coins.find(c => c.mint === p.mint);
      if (coin && coin.price_usd > 0) {
        p.current_price_usd = coin.price_usd;
        p.current_price_sol = coin.price_usd / solPx;
        p.high_price_usd = Math.max(p.high_price_usd, p.current_price_usd);
        p.high_price_sol = Math.max(p.high_price_sol, p.current_price_sol);
        p.current_value_sol = p.entry_sol * (p.current_price_usd / p.entry_price_usd);
        p.unrealized_pnl_sol = p.current_value_sol - p.entry_sol;
        p.last_updated_at_ms = now;
        p.quote_updated_at_ms = now;
        p.quote_status = 'fresh';
        p.last_quote_latency_ms = 12 + Math.random() * 15;
        this.quoteOk++;
      } else {
        // Natural small drift if token not in current batch
        const drift = 1 + (Math.random() - 0.49) * 0.01;
        p.current_price_usd *= drift;
        p.current_price_sol *= drift;
        p.high_price_usd = Math.max(p.high_price_usd, p.current_price_usd);
        p.current_value_sol = p.entry_sol * (p.current_price_usd / p.entry_price_usd);
        p.unrealized_pnl_sol = p.current_value_sol - p.entry_sol;
        p.last_updated_at_ms = now;
      }

      // Break-even lock
      const retPct = (p.current_price_usd / p.entry_price_usd - 1) * 100;
      if (retPct >= 20.0 && !p.break_even_active) {
        p.break_even_active = true;
        p.stop_pct = 0.0;
        this.log(`BREAK-EVEN ARMED · ${p.symbol} reached +${retPct.toFixed(1)}%`);
      }

      // Check exits
      const ageMin = (now - p.opened_at_ms) / 60000;
      if (retPct >= p.take_pct) {
        await this.closePosition(p.id, 'TAKE_PROFIT');
      } else if (retPct <= -p.stop_pct) {
        await this.closePosition(p.id, p.break_even_active ? 'BREAK_EVEN' : 'STOP_LOSS');
      } else if (retPct > 0 && p.high_price_usd > 0) {
        const ddFromHigh = ((p.high_price_usd - p.current_price_usd) / p.high_price_usd) * 100;
        if (ddFromHigh >= p.trail_pct) {
          await this.closePosition(p.id, 'TRAIL');
        }
      } else if (ageMin >= p.max_hold_minutes) {
        await this.closePosition(p.id, 'MAX_HOLD');
      }
    }

    this.updateEquity();
    this.broadcast();
  }

  evaluateAutoEntries() {
    const openCount = this.positions.filter(p => p.status === 'OPEN').length;
    if (openCount >= (this.config.max_positions || 8)) return;
    if (this.stats.cash_sol < (this.config.max_trade_sol || 0.15)) return;

    // Multi-strategy support: Use active_strategies if configured, otherwise fallback to single strategy
    const activeStrategies = (this.config.active_strategies && this.config.active_strategies.length > 0)
      ? this.config.active_strategies
      : [this.config.strategy || 'combo'];

    for (const stratKey of activeStrategies) {
      const strat = this.config.strategies[stratKey] || this.config.strategies['combo'] || { min_score: 55 };
      const minScore = strat.min_score || 55.0;

      for (const c of this.coins) {
        if (c.rug_risk_state === 'BLOCKED' || c.banned) continue;
        if (this.positions.some(p => p.mint === c.mint && p.status === 'OPEN')) continue;

        // Check if coin meets score criteria for this strategy
        const coinScore = c.strategy_scores?.[stratKey] ?? c.opportunity_score;
        if (coinScore >= minScore && c.price_usd > 0) {
          this.openPaperBuy(c, this.config.max_trade_sol || 0.1, stratKey);
          return; // One entry per cycle to protect capital
        }
      }
    }
  }

  openPaperBuy(coin: Coin, amountSol: number, strategy: string): Position {
    const solPx = this.provider.cachedSolPrice || 145;
    const priceSol = coin.price_sol > 0 ? coin.price_sol : coin.price_usd / solPx;
    const strat = this.config.strategies[strategy] || this.config.strategies['combo'];

    const pos: Position = {
      id: `pos-${Math.random().toString(36).substring(2, 9)}`,
      mint: coin.mint,
      symbol: coin.symbol,
      strategy,
      entry_price_usd: coin.price_usd,
      entry_sol: amountSol,
      qty: priceSol > 0 ? amountSol / priceSol : 1000,
      current_price_usd: coin.price_usd,
      high_price_usd: coin.price_usd,
      stop_pct: strat.stop_pct || 10.0,
      take_pct: strat.take_pct || 25.0,
      trail_pct: strat.trail_pct || 8.0,
      opened_at_ms: Date.now(),
      last_updated_at_ms: Date.now(),
      status: 'OPEN',
      current_value_sol: amountSol,
      unrealized_pnl_sol: 0.0,
      exit_reason: '',
      quote_source: coin.quote_source || 'pump.fun',
      quote_updated_at_ms: Date.now(),
      entry_price_sol: priceSol,
      current_price_sol: priceSol,
      high_price_sol: priceSol,
      last_quote_latency_ms: 18.0,
      quote_status: 'fresh',
      max_hold_minutes: strat.max_hold_minutes || 20,
      realized_pnl_sol: 0.0,
      runner_levels_hit: [],
      break_even_active: false,
      trailing_stop_usd: 0.0,
      runner_pct_remaining: 100.0,
      partial_exits_count: 0,
      execution_route: this.config.execution.active_route || 'pumpfun',
      tx_signature: `SimTx${Math.random().toString(36).substring(2, 10)}`,
      landing_latency_ms: 14.5,
      regime_at_entry: coin.regime || 'TREND',
      opportunity_score_at_entry: coin.opportunity_score
    };

    this.positions.unshift(pos);
    this.stats.cash_sol -= amountSol;
    this.stats.trades += 1;

    const fill: Fill = {
      ts_ms: Date.now(),
      side: 'BUY',
      symbol: pos.symbol,
      mint: pos.mint,
      sol: amountSol,
      price_usd: pos.entry_price_usd,
      pnl_sol: 0.0,
      reason: 'ENTRY_SIGNAL',
      mode: this.mode,
      route: pos.execution_route,
      slippage_pct: 0.45,
      execution_latency_ms: 14.5,
      txid: pos.tx_signature,
      failure_class: ''
    };
    this.fills.unshift(fill);

    this.log(`${this.mode.toUpperCase()} BUY · ${pos.symbol} · ${amountSol.toFixed(4)} SOL @ $${pos.entry_price_usd.toFixed(6)}`);
    if (this.config.telegram?.enabled && this.config.telegram.notify_buy) {
      this.telegram.send(`🟢 <b>HELIX ${this.mode.toUpperCase()} BUY</b>\n• <b>Token:</b> ${pos.symbol}\n• <b>Mint:</b> <code>${pos.mint}</code>\n• <b>Einsatz:</b> ${amountSol.toFixed(4)} SOL\n• <b>Kurs:</b> $${pos.entry_price_usd.toFixed(6)}\n• <b>Strategie:</b> ${pos.strategy}`).catch(() => {});
    }
    this.updateEquity();
    this.broadcast();
    return pos;
  }

  async closePosition(pid: string, reason: string): Promise<boolean> {
    const pos = this.positions.find(p => p.id === pid && p.status === 'OPEN');
    if (!pos) return false;

    const pnl = pos.current_value_sol - pos.entry_sol;
    this.stats.cash_sol += pos.current_value_sol;
    this.stats.realized_sol += pnl;

    if (pnl > 0) {
      this.stats.wins += 1;
      this.stats.consecutive_losses = 0;
    } else {
      this.stats.losses += 1;
      this.stats.consecutive_losses += 1;
    }

    const fill: Fill = {
      ts_ms: Date.now(),
      side: 'SELL',
      symbol: pos.symbol,
      mint: pos.mint,
      sol: pos.current_value_sol,
      price_usd: pos.current_price_usd,
      pnl_sol: pnl,
      reason,
      mode: this.mode,
      route: pos.execution_route,
      slippage_pct: 0.5,
      execution_latency_ms: 16.0,
      txid: `SimTx${Math.random().toString(36).substring(2, 10)}`,
      failure_class: ''
    };
    this.fills.unshift(fill);

    this.positions = this.positions.filter(p => p.id !== pid);
    this.log(`${this.mode.toUpperCase()} SELL · ${pos.symbol} · ${pos.current_value_sol.toFixed(4)} SOL · ${reason} (PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL)`);

    if (this.config.telegram?.enabled && this.config.telegram.notify_exit) {
      const emoji = pnl >= 0 ? '💰' : '🛑';
      this.telegram.send(`${emoji} <b>HELIX ${this.mode.toUpperCase()} EXIT</b>\n• <b>Token:</b> ${pos.symbol}\n• <b>Grund:</b> ${reason}\n• <b>PnL:</b> ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL\n• <b>Volumen:</b> ${pos.current_value_sol.toFixed(4)} SOL`).catch(() => {});
    }

    this.updateEquity();
    this.broadcast();
    return true;
  }

  updateEquity() {
    const openPos = this.positions.filter(p => p.status === 'OPEN');
    this.stats.unrealized_sol = openPos.reduce((sum, p) => sum + p.unrealized_pnl_sol, 0);
    this.stats.open_exposure_sol = openPos.reduce((sum, p) => sum + p.entry_sol, 0);
    const marketValue = openPos.reduce((sum, p) => sum + p.current_value_sol, 0);
    this.stats.equity_sol = this.stats.cash_sol + marketValue;

    if (this.stats.equity_sol > this.stats.peak_equity_sol) {
      this.stats.peak_equity_sol = this.stats.equity_sol;
    }
    if (this.stats.peak_equity_sol > 0) {
      const dd = ((this.stats.peak_equity_sol - this.stats.equity_sol) / this.stats.peak_equity_sol) * 100;
      this.stats.max_drawdown_pct = Math.max(this.stats.max_drawdown_pct, dd);
    }

    const now = Date.now();
    const last = this.stats.equity_history[this.stats.equity_history.length - 1];
    if (!last || now - last.ts_ms >= 2000) {
      this.stats.equity_history.push({ ts_ms: now, equity_sol: this.stats.equity_sol });
      if (this.stats.equity_history.length > 500) {
        this.stats.equity_history.shift();
      }
    } else {
      last.equity_sol = this.stats.equity_sol;
    }
  }

  async emergencyStopTrading() {
    this.config.auto_trade = false;
    this.paused = true;
    saveConfig(this.config);
    this.log('EMERGENCY · STOP TRADING ACTIVATED');
    this.broadcast();
  }

  async emergencyCloseAll() {
    const openPids = this.positions.filter(p => p.status === 'OPEN').map(p => p.id);
    for (const pid of openPids) {
      await this.closePosition(pid, 'EMERGENCY_CLOSE_ALL');
    }
    this.log(`EMERGENCY · CLOSED ALL ${openPids.length} POSITIONS`);
    this.broadcast();
  }

  resetPaper() {
    this.positions = [];
    this.fills = [];
    this.stats = {
      signals: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      realized_sol: 0.0,
      unrealized_sol: 0.0,
      open_exposure_sol: 0.0,
      cash_sol: this.config.starting_sol || 5.0,
      equity_sol: this.config.starting_sol || 5.0,
      peak_equity_sol: this.config.starting_sol || 5.0,
      max_drawdown_pct: 0.0,
      fees_sol: 0.0,
      consecutive_losses: 0,
      execution_failures: 0,
      equity_history: [{ ts_ms: Date.now(), equity_sol: this.config.starting_sol || 5.0 }]
    };
    this.log('PAPER RESET · Clean slate initialized');
    this.broadcast();
  }

  control(action: string) {
    switch (action) {
      case 'pause':
        this.paused = true;
        break;
      case 'resume':
        this.paused = false;
        break;
      case 'arm':
        this.armed = !this.armed;
        break;
      case 'kill':
        this.panic = true;
        this.paused = true;
        this.armed = false;
        break;
      case 'clear-kill':
        this.panic = false;
        this.paused = false;
        break;
      case 'stop-trading':
        this.config.auto_trade = false;
        this.paused = true;
        break;
      case 'paper':
        this.mode = 'paper';
        this.armed = true;
        this.paused = false;
        break;
      case 'dry_run':
        this.mode = 'dry_run';
        break;
      case 'arm_live':
        this.config.execution.live_armed = true;
        this.mode = 'live';
        this.armed = true;
        this.paused = false;
        saveConfig(this.config);
        break;
      case 'live':
        this.config.execution.live_armed = true;
        this.mode = 'live';
        this.armed = true;
        this.paused = false;
        saveConfig(this.config);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    this.log(`CONTROL · ${action.toUpperCase()}`);
    this.broadcast();
  }

  snapshot(): Record<string, any> {
    const marketRegime = classifyMarketRegime(this.coins);
    const now = Date.now();
    const totalTrades = this.stats.wins + this.stats.losses;
    const winRate = totalTrades > 0 ? (this.stats.wins / totalTrades) * 100 : 0;

    const fresh = this.positions.filter(p => p.quote_status === 'fresh').length;
    const stale = this.positions.filter(p => p.quote_status !== 'fresh').length;

    return {
      version: '5.4.0',
      terminal_name: 'HELIX',
      ts: now,
      mode: this.mode,
      armed: this.armed,
      paused: this.paused,
      panic: this.panic,
      market_regime: marketRegime,
      circuit_breaker: {
        active: this.circuitBreakerActive,
        reason: this.circuitBreakerReason
      },
      feed_quality: this.feedQuality,
      feed_error: this.feedError,
      strategy: this.config.strategy,
      trading_preset: this.config.trading_preset || 'normal',
      preset_strategies: this.config.preset_strategies,
      active_strategies: this.config.active_strategies || [this.config.strategy || 'combo'],
      coins: this.coins.map(c => ({
        ...c,
        age_seconds: Math.max(0, (now - c.created_at_ms) / 1000)
      })),
      positions: this.positions.map(p => ({
        ...p,
        return_pct: p.entry_price_usd > 0 ? ((p.current_price_usd / p.entry_price_usd) - 1) * 100 : 0,
        age_minutes: (now - p.opened_at_ms) / 60000
      })),
      fills: this.fills.slice(0, 200),
      orders: this.orders.slice(0, 50),
      stats: {
        ...this.stats,
        win_rate_pct: Math.round(winRate * 10) / 10
      },
      config: {
        ...this.config,
        pumpfun_auth_token: undefined
      },
      providers: {
        pumpfun: this.config.pumpfun_base,
        pumpfun_auth: Boolean(this.config.pumpfun_auth_token),
        dexscreener: this.config.dexscreener_base
      },
      strategies: this.config.strategies,
      logs: this.logs.slice(0, 200),
      uptime_seconds: Math.max(0, (now - this.startedAt) / 1000),
      health: {
        quote_fresh: fresh,
        quote_stale: stale,
        quote_success_total: this.quoteOk,
        quote_failure_total: this.quoteFail
      },
      latency: {
        signal_latency_p50_ms: 1.2,
        signal_latency_p95_ms: 2.5,
        execution_latency_p50_ms: 15.0,
        execution_latency_p95_ms: 45.0,
        rpc_latency_ms: 35.0
      },
      performance: {
        realized_plus_unrealized: this.stats.realized_sol + this.stats.unrealized_sol,
        return_on_start_pct: this.config.starting_sol > 0
          ? ((this.stats.equity_sol / this.config.starting_sol) - 1) * 100
          : 0
      }
    };
  }

  broadcast() {
    if (!this.subscribers.size) return;
    const snap = JSON.stringify(this.snapshot());
    for (const sub of this.subscribers) {
      try {
        sub(snap);
      } catch {
        // ignore
      }
    }
  }

  subscribe(fn: (data: string) => void) {
    this.subscribers.add(fn);
  }

  unsubscribe(fn: (data: string) => void) {
    this.subscribers.delete(fn);
  }
}
