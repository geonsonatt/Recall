from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

from python_learning.models import Task


class TaskStorage:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load_tasks(self) -> list[Task]:
        if not self.path.exists():
            return []

        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError("storage file must contain JSON list")
        return [Task.from_dict(item) for item in data]

    def save_tasks(self, tasks: Sequence[Task]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [task.to_dict() for task in tasks]
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
