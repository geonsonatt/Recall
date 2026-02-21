# Capstone: Recall Planner Pro

Финальная цель: превратить CLI-учебный проект в production-ready сервис.

## Этапы

1. **Persistence**
   - миграция с JSON на PostgreSQL (SQLAlchemy + Alembic)
   - репозиторный слой и транзакции
2. **API Layer**
   - FastAPI: CRUD задач, фильтры, пагинация
   - валидация и OpenAPI документация
3. **Security**
   - JWT auth
   - роли `user/admin`
4. **Operations**
   - Docker Compose (app + db)
   - CI pipeline: lint + typecheck + tests
   - structured logging + healthcheck
5. **Observability**
   - Prometheus-метрики
   - latency/error dashboards

## Definition of Done

- тесты проходят в CI
- есть документация по запуску
- API готов к демо
- есть 1-2 архитектурных ADR
