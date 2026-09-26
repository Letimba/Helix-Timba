from __future__ import annotations

import asyncio
import httpx
import time
from collections import deque
from typing import Any


class DexScreenerProvider:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.client = httpx.AsyncClient(timeout=3.0, headers={"User-Agent": "HELIX-V5/5.0"})
        self._request_times: deque[float] = deque()
        self._request_lock = asyncio.Lock()

    @staticmethod
    def _number(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    async def _get_json(self, url: str) -> Any:
        while True:
            async with self._request_lock:
                now = time.monotonic()
                while self._request_times and now - self._request_times[0] >= 60:
                    self._request_times.popleft()
                if len(self._request_times) < 280:
                    self._request_times.append(now)
                    break
                delay = max(0.05, 60 - (now - self._request_times[0]))
            await asyncio.sleep(delay)
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()

    async def token_market_data(self, mints: list[str]) -> dict[str, dict[str, Any]]:
        """Fetch token prices, liquidity and five-minute activity in batches of 30."""
        result: dict[str, dict[str, Any]] = {}
        addresses = list(dict.fromkeys(mint for mint in mints if mint))
        for offset in range(0, len(addresses), 30):
            batch = addresses[offset:offset + 30]
            rows = await self._get_json(f"{self.base}/tokens/v1/solana/{','.join(batch)}")
            if not isinstance(rows, list):
                continue
            for pair in rows:
                if not isinstance(pair, dict) or pair.get("chainId") not in (None, "solana"):
                    continue
                base = pair.get("baseToken") or {}
                quote = pair.get("quoteToken") or {}
                mint = str(base.get("address") or "")
                price = self._number(pair.get("priceUsd"))
                if mint not in batch:
                    mint = str(quote.get("address") or "")
                    native_price = self._number(pair.get("priceNative"))
                    price = price / native_price if price > 0 and native_price > 0 else 0.0
                if mint not in batch:
                    continue
                liquidity = self._number((pair.get("liquidity") or {}).get("usd"))
                previous = result.get(mint)
                if previous and previous["liquidity_usd"] >= liquidity:
                    continue
                txns = pair.get("txns") or {}
                volume = pair.get("volume") or {}
                change = pair.get("priceChange") or {}
                m5_txns = txns.get("m5") or {}
                result[mint] = {
                    "price_usd": price,
                    "liquidity_usd": liquidity,
                    "volume_5m_usd": self._number(volume.get("m5")),
                    "buys_5m": int(self._number(m5_txns.get("buys"))),
                    "sells_5m": int(self._number(m5_txns.get("sells"))),
                    "price_change_5m": self._number(change.get("m5")),
                    "market_cap_usd": self._number(pair.get("marketCap") or pair.get("fdv")),
                    "quote_source": str(pair.get("dexId") or "dexscreener"),
                    "pair_address": str(pair.get("pairAddress") or ""),
                }
        return result

    async def token_price(self, mint: str) -> tuple[float, float, str]:
        data = (await self.token_market_data([mint])).get(mint)
        if not data:
            return 0.0, 0.0, ""
        return data["price_usd"], data["liquidity_usd"], data["quote_source"]

    async def sol_price_usd(self) -> float:
        price, _, _ = await self.token_price("So11111111111111111111111111111111111111112")
        return price

    async def close(self) -> None:
        await self.client.aclose()
