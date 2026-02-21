from __future__ import annotations

import asyncio

from python_learning.async_jobs import sync_in_batches
from python_learning.models import Task


def test_sync_in_batches() -> None:
    tasks = [Task(id=str(i), title=f"task {i}") for i in range(12)]
    synced = asyncio.run(sync_in_batches(tasks, batch_size=5, delay=0))
    assert synced == 12


def test_sync_in_batches_rejects_bad_batch_size() -> None:
    try:
        asyncio.run(sync_in_batches([], batch_size=0))
    except ValueError as exc:
        assert "batch_size" in str(exc)
    else:
        raise AssertionError("ValueError expected")
