from __future__ import annotations

import asyncio
from collections.abc import Iterable

from python_learning.models import Task


async def simulate_sync(tasks: Iterable[Task], delay: float = 0.01) -> int:
    synced = 0
    for _task in tasks:
        await asyncio.sleep(delay)
        synced += 1
    return synced


async def sync_in_batches(tasks: list[Task], batch_size: int = 5, delay: float = 0.01) -> int:
    if batch_size <= 0:
        raise ValueError("batch_size must be > 0")

    total = 0
    for start in range(0, len(tasks), batch_size):
        batch = tasks[start : start + batch_size]
        total += await simulate_sync(batch, delay=delay)
    return total
