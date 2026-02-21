from __future__ import annotations

from python_learning.analytics import completion_rate, priority_distribution, top_keywords
from python_learning.models import Task


def test_completion_rate() -> None:
    tasks = [
        Task(id="1", title="A", done=True),
        Task(id="2", title="B", done=False),
        Task(id="3", title="C", done=True),
    ]
    assert completion_rate(tasks) == 66.67


def test_priority_distribution() -> None:
    tasks = [
        Task(id="1", title="A", priority=1),
        Task(id="2", title="B", priority=5),
        Task(id="3", title="C", priority=5),
    ]
    distribution = priority_distribution(tasks)
    assert distribution[1] == 1
    assert distribution[5] == 2


def test_top_keywords() -> None:
    tasks = [
        Task(id="1", title="Learn Python", description="Python async basics"),
        Task(id="2", title="Write Python tests", description="tests and coverage"),
    ]
    keywords = dict(top_keywords(tasks, limit=3))
    assert keywords["python"] == 3
