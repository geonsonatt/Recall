from __future__ import annotations

from pathlib import Path

from python_learning.models import Task
from python_learning.storage import TaskStorage


def test_load_empty_when_file_missing(tmp_path: Path) -> None:
    storage = TaskStorage(tmp_path / "missing.json")
    assert storage.load_tasks() == []


def test_round_trip_save_and_load(tmp_path: Path) -> None:
    path = tmp_path / "tasks.json"
    storage = TaskStorage(path)
    tasks = [
        Task(id="1", title="Learn Python", priority=5, tags=["study"]),
        Task(id="2", title="Write tests", priority=4, done=True),
    ]

    storage.save_tasks(tasks)
    loaded = storage.load_tasks()

    assert len(loaded) == 2
    assert loaded[0].title == "Learn Python"
    assert loaded[0].tags == ["study"]
    assert loaded[1].done is True
