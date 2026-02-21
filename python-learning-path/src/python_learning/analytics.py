from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

from python_learning.models import Task

_WORD_RE = re.compile(r"[A-Za-zА-Яа-я0-9]+")
_STOPWORDS = {
    "a",
    "an",
    "and",
    "the",
    "to",
    "of",
    "in",
    "on",
    "for",
    "и",
    "в",
    "на",
    "с",
    "по",
    "для",
}


def completion_rate(tasks: Iterable[Task]) -> float:
    task_list = list(tasks)
    if not task_list:
        return 0.0
    done = sum(1 for task in task_list if task.done)
    return round((done / len(task_list)) * 100, 2)


def priority_distribution(tasks: Iterable[Task]) -> dict[int, int]:
    distribution = {level: 0 for level in range(1, 6)}
    for task in tasks:
        distribution[task.priority] += 1
    return distribution


def top_keywords(tasks: Iterable[Task], limit: int = 5) -> list[tuple[str, int]]:
    words: list[str] = []
    for task in tasks:
        words.extend(_WORD_RE.findall(task.title.lower()))
        words.extend(_WORD_RE.findall(task.description.lower()))

    filtered = [word for word in words if word not in _STOPWORDS and len(word) > 2]
    return Counter(filtered).most_common(limit)
