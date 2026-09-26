from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Quote:
    price_usd: float
    source: str
    timestamp_ms: int

    @property
    def valid(self) -> bool:
        return self.price_usd > 0 and self.timestamp_ms > 0
