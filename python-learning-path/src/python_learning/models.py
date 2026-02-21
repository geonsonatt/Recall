from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(slots=True)
class Task:
    id: str
    title: str
    description: str = ""
    priority: int = 3
    done: bool = False
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self) -> None:
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("title must not be empty")
        if not 1 <= self.priority <= 5:
            raise ValueError("priority must be in range 1..5")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "done": self.done,
            "tags": list(self.tags),
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Task":
        return cls(
            id=str(raw["id"]),
            title=str(raw["title"]),
            description=str(raw.get("description", "")),
            priority=int(raw.get("priority", 3)),
            done=bool(raw.get("done", False)),
            tags=[str(item) for item in raw.get("tags", [])],
            created_at=str(raw.get("created_at", datetime.now(timezone.utc).isoformat())),
        )
