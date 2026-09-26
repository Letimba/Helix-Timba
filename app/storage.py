from __future__ import annotations

import json
import queue
import sqlite3
import threading
import time
from pathlib import Path
from typing import Iterable

from .models import Fill, Order, Position, Stats


class Store:
    """Resilient SQLite persistence layer with background write worker

    to guarantee zero disk blocking on the trading hot path.
    """

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=10.0, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._configure()

        # Background asynchronous write queue for zero hot-path latency
        self._write_queue: queue.Queue = queue.Queue(maxsize=10000)
        self._running = True
        self._worker_thread = threading.Thread(target=self._background_writer, daemon=True, name="helix-db-writer")
        self._worker_thread.start()

    def _configure(self) -> None:
        self.db.execute("PRAGMA busy_timeout=2000")
        try:
            self.db.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError:
            try:
                self.db.execute("PRAGMA journal_mode=DELETE")
            except sqlite3.OperationalError:
                pass
        try:
            self.db.execute("PRAGMA synchronous=NORMAL")
        except sqlite3.OperationalError:
            pass
        try:
            self.db.execute("PRAGMA foreign_keys=ON")
        except sqlite3.OperationalError:
            pass
        self.db.execute("""CREATE TABLE IF NOT EXISTS fills(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL, side TEXT NOT NULL, symbol TEXT, mint TEXT,
            sol REAL NOT NULL, price_usd REAL, pnl_sol REAL, reason TEXT, mode TEXT
        )""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS positions(
            id TEXT PRIMARY KEY, payload TEXT NOT NULL
        )""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS orders(
            id TEXT PRIMARY KEY, payload TEXT NOT NULL
        )""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS runtime_state(
            id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL
        )""")
        self.db.commit()

    def _commit(self) -> None:
        for attempt in range(4):
            try:
                self.db.commit()
                return
            except sqlite3.OperationalError:
                if attempt == 3:
                    raise
                time.sleep(0.05 * (2**attempt))

    def _background_writer(self) -> None:
        while self._running:
            try:
                task = self._write_queue.get(timeout=0.25)
            except queue.Empty:
                continue

            op, data = task
            try:
                if op == "fill":
                    self.record_fill(data)
                elif op == "positions":
                    self.save_positions(data)
                elif op == "stats":
                    self.save_stats(data)
                elif op == "order":
                    self.save_order(data)
            except Exception:
                pass
            finally:
                self._write_queue.task_done()

    def queue_record_fill(self, f: Fill) -> None:
        try:
            self._write_queue.put_nowait(("fill", f))
        except queue.Full:
            self.record_fill(f)

    def queue_save_positions(self, positions: list[Position]) -> None:
        try:
            self._write_queue.put_nowait(("positions", list(positions)))
        except queue.Full:
            self.save_positions(positions)

    def queue_save_stats(self, stats: Stats) -> None:
        try:
            self._write_queue.put_nowait(("stats", stats))
        except queue.Full:
            self.save_stats(stats)

    def record_fill(self, f: Fill) -> None:
        self.db.execute(
            "INSERT INTO fills(ts_ms,side,symbol,mint,sol,price_usd,pnl_sol,reason,mode) VALUES(?,?,?,?,?,?,?,?,?)",
            (f.ts_ms, f.side, f.symbol, f.mint, f.sol, f.price_usd, f.pnl_sol, f.reason, f.mode),
        )
        self._commit()

    def save_positions(self, positions: Iterable[Position]) -> None:
        self.db.execute("DELETE FROM positions")
        for p in positions:
            payload = p.__dict__.copy()
            self.db.execute("INSERT INTO positions(id,payload) VALUES(?,?)", (p.id, json.dumps(payload)))
        self._commit()

    def load_positions(self) -> list[Position]:
        out: list[Position] = []
        rows = self.db.execute("SELECT payload FROM positions ORDER BY rowid").fetchall()
        for row in rows:
            try:
                data = json.loads(row["payload"])
                # Reject legacy/broken positions that can produce impossible PnL
                entry_usd = float(data.get("entry_price_usd", 0) or 0)
                entry_sol = float(data.get("entry_sol", 0) or 0)
                current_value = float(data.get("current_value_sol", entry_sol) or 0)
                if entry_usd <= 0 or entry_sol <= 0 or current_value <= 0:
                    continue
                if current_value > max(entry_sol * 100000.0, entry_sol + 1000.0):
                    continue
                data.setdefault("entry_price_sol", 0.0)
                data.setdefault("current_price_sol", 0.0)
                data.setdefault("high_price_sol", 0.0)
                data.setdefault("last_quote_latency_ms", 0.0)
                data.setdefault("quote_status", "unknown")
                data.setdefault("max_hold_minutes", 45)
                data.setdefault("realized_pnl_sol", 0.0)
                data.setdefault("runner_levels_hit", [])
                data.setdefault("break_even_active", False)
                data.setdefault("trailing_stop_usd", 0.0)
                data.setdefault("runner_pct_remaining", 100.0)
                data.setdefault("partial_exits_count", 0)
                data.setdefault("execution_route", "paper")
                data.setdefault("tx_signature", "")
                data.setdefault("landing_latency_ms", 0.0)
                data.setdefault("regime_at_entry", "UNKNOWN")
                data.setdefault("opportunity_score_at_entry", 0.0)
                out.append(Position(**data))
            except Exception:
                continue
        return out

    def save_order(self, order: Order) -> None:
        self.db.execute(
            "INSERT INTO orders(id,payload) VALUES(?,?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (order.id, json.dumps(order.__dict__)),
        )
        self._commit()

    def load_orders(self, limit: int = 50) -> list[Order]:
        rows = self.db.execute("SELECT payload FROM orders ORDER BY rowid DESC LIMIT ?", (limit,)).fetchall()
        out: list[Order] = []
        for row in rows:
            try:
                out.append(Order(**json.loads(row["payload"])))
            except Exception:
                continue
        return out

    def recent_fills(self, limit: int = 50) -> list[Fill]:
        rows = self.db.execute(
            "SELECT ts_ms,side,symbol,mint,sol,price_usd,pnl_sol,reason,mode FROM fills ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        out: list[Fill] = []
        for row in rows:
            try:
                d = dict(row)
                d.setdefault("route", "paper")
                d.setdefault("slippage_pct", 0.0)
                d.setdefault("execution_latency_ms", 0.0)
                d.setdefault("txid", "")
                d.setdefault("failure_class", "")
                out.append(Fill(**d))
            except Exception:
                continue
        return out

    def save_stats(self, stats: Stats) -> None:
        self.db.execute(
            "INSERT INTO runtime_state(id,payload) VALUES(1,?) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (json.dumps(stats.__dict__),),
        )
        self._commit()

    def load_stats(self) -> Stats | None:
        row = self.db.execute("SELECT payload FROM runtime_state WHERE id=1").fetchone()
        if not row:
            return None
        try:
            d = json.loads(row["payload"])
            d.setdefault("consecutive_losses", 0)
            d.setdefault("execution_failures", 0)
            return Stats(**d)
        except Exception:
            return None

    def clear_runtime(self) -> None:
        self.db.execute("DELETE FROM runtime_state")
        self.db.execute("DELETE FROM fills")
        self.db.execute("DELETE FROM positions")
        self.db.execute("DELETE FROM orders")
        self._commit()

    def close(self) -> None:
        self._running = False
        try:
            # Drain remaining writes
            while not self._write_queue.empty():
                try:
                    op, data = self._write_queue.get_nowait()
                    if op == "fill":
                        self.record_fill(data)
                    elif op == "positions":
                        self.save_positions(data)
                    elif op == "stats":
                        self.save_stats(data)
                    self._write_queue.task_done()
                except Exception:
                    break
            self._commit()
        finally:
            self.db.close()
