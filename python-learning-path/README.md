# Python Learning Path: с нуля до Pro

Практический учебный проект, в котором ты шаг за шагом прокачаешь Python на реальном приложении: `Recall Planner` (CLI-планировщик задач).

## Что внутри

- 4 уровня обучения: `Beginner -> Junior -> Middle -> Pro`
- готовый рабочий код, который можно разбирать и улучшать
- задания по уровням
- автопроверка через `pytest`
- финальный capstone-план для портфолио

## Быстрый старт

```bash
cd python-learning-path
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
python -m python_learning.cli --help
```

## Карта обучения

1. `roadmap/01_beginner.md` — синтаксис, функции, коллекции, базовая CLI-логика
2. `roadmap/02_junior.md` — модули, dataclass, файловое хранение, тестирование
3. `roadmap/03_middle.md` — архитектура, аналитика, качество кода, типизация
4. `roadmap/04_pro.md` — async, packaging, CI/CD, performance, production-подход

## Режим прохождения

1. Читай roadmap уровня.
2. Выполняй задания из `tasks/`.
3. Сверяйся с кодом в `src/python_learning/`.
4. Запускай тесты: `pytest -q`.
5. После каждого уровня делай mini-refactor.

## Полезные команды

```bash
make test      # pytest
make lint      # ruff
make typecheck # mypy
make run-help  # python -m python_learning.cli --help
```

## Финальная цель

Собрать и защитить capstone-версию планировщика по плану в `capstone/README.md`:

- хранение в БД
- REST API (FastAPI)
- auth + роли
- docker + CI
- метрики и логирование
