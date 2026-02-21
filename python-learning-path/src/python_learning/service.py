from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from python_learning.models import Task
from python_learning.storage import TaskStorage


class TaskService:
    def __init__(self, storage: TaskStorage) -> None:
        self.storage = storage

    def add_task(
        self,
        title: str,
        description: str = "",
        priority: int = 3,
        tags: list[str] | None = None,
    ) -> Task:
        tasks = self.storage.load_tasks()
        task = Task(
            id=str(uuid4()),
            title=title,
            description=description,
            priority=priority,
            tags=tags or [],
        )
        tasks.append(task)
        self.storage.save_tasks(tasks)
        return task

    def list_tasks(self, include_done: bool = True, query: str | None = None) -> list[Task]:
        tasks = self.storage.load_tasks()
        if not include_done:
            tasks = [task for task in tasks if not task.done]
        if query:
            lowered = query.lower()
            tasks = [task for task in tasks if lowered in task.title.lower()]
        return sorted(tasks, key=lambda item: (-item.priority, item.created_at))

    def complete_task(self, task_id: str) -> bool:
        tasks = self.storage.load_tasks()
        changed = False
        for task in tasks:
            if task.id == task_id:
                task.done = True
                changed = True
                break
        if changed:
            self.storage.save_tasks(tasks)
        return changed

    def delete_task(self, task_id: str) -> bool:
        tasks = self.storage.load_tasks()
        kept = [task for task in tasks if task.id != task_id]
        if len(kept) == len(tasks):
            return False
        self.storage.save_tasks(kept)
        return True

    def next_task(self) -> Task | None:
        open_tasks = self.list_tasks(include_done=False)
        return open_tasks[0] if open_tasks else None

    def count_tasks(self, include_done: bool = True) -> int:
        return len(self.list_tasks(include_done=include_done))

    def stats(self) -> dict[str, Any]:
        tasks = self.storage.load_tasks()
        total = len(tasks)
        done = sum(1 for task in tasks if task.done)
        open_count = total - done
        completion_rate = round((done / total) * 100, 2) if total else 0.0
        return {
            "total": total,
            "done": done,
            "open": open_count,
            "completion_rate": completion_rate,
        }

    @staticmethod
    def _created_at_to_dt(task: Task) -> datetime:
        return datetime.fromisoformat(task.created_at)
