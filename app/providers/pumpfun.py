from __future__ import annotations

from typing import Any

import httpx

from ..models import Coin, now_ms


class PumpFunProvider:
    """Pump.fun v3 client.

    Prices exposed by HELIX are explicitly USD quotes. Ambiguous `price` fields are
    not treated as USD; we derive USD from market cap / total supply when available.
    """

    def __init__(self, base: str, auth_token: str, timeout: float = 4.0):
        self.base = base.rstrip("/")
        self.auth_token = auth_token.strip()
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=min(timeout, 2.5)),
            headers={
                "Accept": "application/json",
                "Origin": "https://pump.fun",
                "Referer": "https://pump.fun/",
                "User-Agent": "HELIX-V5/5.2",
            },
        )

    def update_auth(self, token: str) -> None:
        self.auth_token = token.strip()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}

    async def _get(self, url: str, *, params: dict[str, Any] | None = None) -> Any:
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = await self.client.get(url, params=params, headers=self._headers())
                if resp.status_code in (401, 403):
                    raise RuntimeError("Pump.fun authentication required (JWT). Set PUMPFUN_AUTH_TOKEN or use Settings.")
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    retry_after = resp.headers.get("retry-after")
                    delay = float(retry_after) if retry_after else 0.25 * (2**attempt)
                    if attempt < 2:
                        import asyncio
                        await asyncio.sleep(min(delay, 1.5))
                        continue
                resp.raise_for_status()
                return resp.json()
            except RuntimeError:
                raise
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    import asyncio
                    await asyncio.sleep(0.2 * (2**attempt))
        assert last_error is not None
        raise last_error

    @staticmethod
    def _num(d: dict[str, Any], *keys: str) -> float:
        for k in keys:
            v = d.get(k)
            try:
                if v is not None and v != "":
                    return float(v)
            except (TypeError, ValueError):
                pass
        return 0.0

    @staticmethod
    def _int(d: dict[str, Any], *keys: str) -> int:
        for k in keys:
            v = d.get(k)
            try:
                if v is not None and v != "":
                    return int(float(v))
            except (TypeError, ValueError):
                pass
        return 0

    @staticmethod
    def _created_ms(v: float) -> int:
        if v <= 0:
            return 0
        return int(v if v > 1e12 else v * 1000)

    @staticmethod
    def _bool(d: dict[str, Any], *keys: str) -> bool:
        for key in keys:
            if key not in d:
                continue
            value = d[key]
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.strip().lower() in {"true", "1", "yes", "y"}
            if isinstance(value, (int, float)):
                return bool(value)
        return False

    @staticmethod
    def reserve_price_sol_values(virtual_sol_reserves: float, virtual_token_reserves: float) -> float:
        """Bonding-curve spot price in SOL/token from Pump.fun raw reserves."""
        v_sol = float(virtual_sol_reserves or 0.0) / 1_000_000_000.0
        v_token = float(virtual_token_reserves or 0.0) / 1_000_000.0
        if v_sol <= 0 or v_token <= 0:
            return 0.0
        return v_sol / v_token

    @staticmethod
    def reserve_price_sol(coin: Coin) -> float:
        return PumpFunProvider.reserve_price_sol_values(coin.virtual_sol_reserves, coin.virtual_token_reserves)

    def map_coin(self, d: dict[str, Any]) -> Coin:
        created = self._created_ms(self._num(d, "created_timestamp", "createdAt", "created_at", "createdAtMs"))
        last_trade = self._created_ms(self._num(d, "last_trade_timestamp", "lastTradeAtMs", "last_trade_at"))
        supply = self._num(d, "token_total_supply", "tokenTotalSupply", "total_supply") or 1_000_000_000
        # Pump.fun can expose SPL base units (six decimals) instead of token units.
        if supply > 1_000_000_000_000:
            supply /= 1_000_000
        real_sol = self._num(d, "real_sol_reserves", "realSolReserves")
        # Bonding-curve reserve values are lamports; scoring expects SOL.
        if real_sol > 1_000:
            real_sol /= 1_000_000_000
        virtual_sol = self._num(d, "virtual_sol_reserves", "virtualSolReserves")
        virtual_token = self._num(d, "virtual_token_reserves", "virtualTokenReserves")
        market_cap = self._num(d, "usd_market_cap", "usdMarketCap", "marketCapUsd", "market_cap_usd")
        liquidity = d.get("liquidity") if isinstance(d.get("liquidity"), dict) else {}
        volume = d.get("volume") if isinstance(d.get("volume"), dict) else {}
        change = d.get("priceChange") if isinstance(d.get("priceChange"), dict) else {}
        txns = d.get("txns") if isinstance(d.get("txns"), dict) else {}
        txns_m5 = txns.get("m5") if isinstance(txns.get("m5"), dict) else {}

        # Only explicit USD values are accepted as direct price quotes.
        price_usd = self._num(d, "price_usd", "priceUsd", "usd_price")
        if price_usd <= 0 and market_cap > 0 and supply > 0:
            price_usd = market_cap / supply
        price_sol = self.reserve_price_sol_values(virtual_sol, virtual_token)

        pool = d.get("pool_address") or d.get("pump_swap_pool") or d.get("raydium_pool") or ""
        age = (now_ms() - created) / 1000 if created else 1e9
        return Coin(
            mint=str(d.get("mint") or d.get("address") or ""),
            name=str(d.get("name") or ""),
            symbol=str(d.get("symbol") or ""),
            creator=str(d.get("creator") or ""),
            image_uri=str(d.get("image_uri") or d.get("imageUri") or ""),
            created_at_ms=created,
            last_trade_at_ms=last_trade,
            complete=self._bool(d, "complete"),
            banned=self._bool(d, "is_banned", "banned"),
            venue="pump.fun",
            pool_address=str(pool),
            price_usd=price_usd,
            price_sol=price_sol,
            market_cap_usd=market_cap,
            liquidity_usd=self._num(d, "liquidity_usd", "liquidityUsd") or self._num(liquidity, "usd"),
            volume_5m_usd=self._num(d, "volume_5m_usd", "volume5mUsd", "volume_5m", "volume5m") or self._num({"m5": volume.get("m5")}, "m5"),
            buys_5m=self._int(d, "buys_5m", "buys5m", "buys_5m_count") or self._int(txns_m5, "buys"),
            sells_5m=self._int(d, "sells_5m", "sells5m", "sells_5m_count") or self._int(txns_m5, "sells"),
            price_change_5m=self._num(d, "price_change_5m", "priceChange5m", "price_change_percent_5m") or self._num({"m5": change.get("m5")}, "m5"),
            virtual_sol_reserves=virtual_sol,
            virtual_token_reserves=virtual_token,
            real_sol_reserves=real_sol,
            token_total_supply=supply,
            is_new=age <= 60,
            source="pumpfun",
            observed_at_ms=now_ms(),
            quote_source="pump.fun/usd-market-cap" if price_usd > 0 else "",
        )

    @staticmethod
    def _unwrap_json(data: Any) -> list[dict[str, Any]]:
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            for key in ("coins", "data", "results", "items"):
                if isinstance(data.get(key), list):
                    return [x for x in data[key] if isinstance(x, dict)]
            return [data]
        return []

    async def list_coins(self, limit: int = 40) -> tuple[list[Coin], str]:
        data = await self._get(
            f"{self.base}/coins",
            params={
                "limit": max(1, min(limit, 100)),
                "offset": 0,
                "sort": "created_timestamp",
                "searchTerm": "",
                "order": "DESC",
                "includeNsfw": "false",
                "creator": "",
                "complete": "false",
                "meta": "true",
            },
        )
        rows = self._unwrap_json(data)
        coins = [self.map_coin(x) for x in rows if (x.get("mint") or x.get("address"))]
        return coins, "live"

    async def latest(self) -> Coin:
        data = await self._get(f"{self.base}/coins/latest")
        rows = self._unwrap_json(data)
        if not rows:
            raise RuntimeError("Pump.fun returned no latest coin")
        return self.map_coin(rows[0])

    async def sol_price_usd(self) -> float:
        data = await self._get(f"{self.base}/sol-price")
        if isinstance(data, dict):
            return self._num(data, "solPrice", "sol_price", "price")
        return 0.0

    async def coin(self, mint: str) -> Coin:
        # Current Pump.fun coin-state endpoint. Keep the legacy endpoint as a
        # compatibility fallback because providers can roll out versions unevenly.
        try:
            data = await self._get(f"{self.base}/coins-v2/{mint}")
            rows = self._unwrap_json(data)
            if rows:
                return self.map_coin(rows[0])
        except Exception:
            pass
        data = await self._get(f"{self.base}/coins/{mint}", params={"sync": "true"})
        rows = self._unwrap_json(data)
        if not rows:
            raise RuntimeError(f"Pump.fun returned no data for {mint}")
        return self.map_coin(rows[0])

    async def close(self) -> None:
        await self.client.aclose()
