from __future__ import annotations

from pathlib import Path

from python_learning.service import TaskService
from python_learning.storage import TaskStorage


def make_service(tmp_path: Path) -> TaskService:
    return TaskService(TaskStorage(tmp_path / "tasks.json"))


def test_add_list_and_count(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    service.add_task("A", priority=2)
    service.add_task("B", priority=5)

    tasks = service.list_tasks()
    assert [task.title for task in tasks] == ["B", "A"]
    assert service.count_tasks() == 2


def test_complete_delete_and_next(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    one = service.add_task("Task one", priority=3)
    two = service.add_task("Task two", priority=4)

    assert service.next_task() is not None
    assert service.next_task().id == two.id

    assert service.complete_task(two.id) is True
    assert service.complete_task("unknown") is False
    assert service.delete_task(one.id) is True
    assert service.delete_task("unknown") is False


def test_query_filter(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    service.add_task("Learn Python")
    service.add_task("Read docs")

    tasks = service.list_tasks(query="python")
    assert len(tasks) == 1
    assert tasks[0].title == "Learn Python"
