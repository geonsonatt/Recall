from __future__ import annotations

import argparse
import os
from pathlib import Path

from python_learning.analytics import completion_rate, priority_distribution, top_keywords
from python_learning.service import TaskService
from python_learning.storage import TaskStorage


def build_service() -> TaskService:
    default_path = Path(".data/tasks.json")
    db_path = Path(os.environ.get("PY_LEARN_DB", str(default_path)))
    return TaskService(TaskStorage(db_path))


def cmd_add(args: argparse.Namespace) -> int:
    service = build_service()
    task = service.add_task(
        title=args.title,
        description=args.description,
        priority=args.priority,
        tags=args.tag,
    )
    print(f"created: {task.id}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    service = build_service()
    tasks = service.list_tasks(include_done=not args.open_only, query=args.query)
    if not tasks:
        print("no tasks")
        return 0

    for task in tasks:
        state = "x" if task.done else " "
        tags = f" tags={','.join(task.tags)}" if task.tags else ""
        print(f"[{state}] ({task.priority}) {task.id} {task.title}{tags}")
    return 0


def cmd_done(args: argparse.Namespace) -> int:
    service = build_service()
    changed = service.complete_task(args.task_id)
    print("done" if changed else "not found")
    return 0 if changed else 1


def cmd_delete(args: argparse.Namespace) -> int:
    service = build_service()
    changed = service.delete_task(args.task_id)
    print("deleted" if changed else "not found")
    return 0 if changed else 1


def cmd_stats(_args: argparse.Namespace) -> int:
    service = build_service()
    tasks = service.list_tasks(include_done=True)
    base = service.stats()
    print(f"total={base['total']} done={base['done']} open={base['open']} rate={base['completion_rate']}%")
    print(f"distribution={priority_distribution(tasks)}")
    print(f"keywords={top_keywords(tasks)}")
    print(f"analytics_rate={completion_rate(tasks)}%")
    return 0


def cmd_next(_args: argparse.Namespace) -> int:
    service = build_service()
    task = service.next_task()
    if task is None:
        print("all tasks completed")
        return 0
    print(f"next: ({task.priority}) {task.id} {task.title}")
    return 0


def cmd_count(args: argparse.Namespace) -> int:
    service = build_service()
    count = service.count_tasks(include_done=not args.open_only)
    print(count)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python-learning", description="Recall Planner CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="add task")
    add.add_argument("title")
    add.add_argument("-d", "--description", default="")
    add.add_argument("-p", "--priority", type=int, default=3)
    add.add_argument("--tag", action="append", default=[])
    add.set_defaults(handler=cmd_add)

    show = sub.add_parser("list", help="list tasks")
    show.add_argument("--open", dest="open_only", action="store_true")
    show.add_argument("--query")
    show.set_defaults(handler=cmd_list)

    done = sub.add_parser("done", help="mark task as done")
    done.add_argument("task_id")
    done.set_defaults(handler=cmd_done)

    delete = sub.add_parser("delete", help="delete task")
    delete.add_argument("task_id")
    delete.set_defaults(handler=cmd_delete)

    stats = sub.add_parser("stats", help="show statistics")
    stats.set_defaults(handler=cmd_stats)

    next_task = sub.add_parser("next", help="show next task")
    next_task.set_defaults(handler=cmd_next)

    count = sub.add_parser("count", help="count tasks")
    count.add_argument("--open", dest="open_only", action="store_true")
    count.set_defaults(handler=cmd_count)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    handler = args.handler
    return int(handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
