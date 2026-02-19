# PDF Recall Desktop (MVP)

Локальное desktop-приложение на Electron + Vite:
- импорт PDF в локальную библиотеку
- чтение PDF и выделение текста
- создание хайлайтов (желтый/зеленый/розовый) с необязательной заметкой
- сохранение базового форматирования выделенного текста (bold/italic/underline, переносы строк)
- просмотр/поиск хайлайтов и переход к месту в PDF
- экспорт аннотированного PDF (flattened overlays)
- экспорт Markdown для Obsidian/Notion/архива
- история переходов назад/вперед, таймер чтения
- daily streak, календарь чтения, цели страниц/день и страниц/неделю
- коллекции книг, закрепление книг, фильтр по прогрессу и сортировка по последнему чтению
- теги и массовые операции по хайлайтам (удаление/экспорт выборки, экспорт новых с даты)
- мини-карта книги, быстрый jump к следующему/предыдущему хайлайту
- drag-and-drop импорт PDF, дедупликация импорта, backup/restore базы
- темы интерфейса (light/sepia/contrast) и фокус-режим Reader

Без облака и аккаунтов.

## Технологии

- Electron
- Vite (vanilla JS)
- Apryse WebViewer (`@pdftron/webviewer`) для Reader-поведения (как в Readwise/Reader)
- PDF.js (`pdfjs-dist`) как резервный рендер в кодовой базе MVP
- `pdf-lib` для экспорта аннотированного PDF
- JSON-хранилище в `app.getPath('userData')`

## Структура проекта

```txt
/app
  /main      electron main + preload + IPC
  /renderer  UI (Библиотека / Читалка / Хайлайты)
  /shared
  /data      local storage (db.json, documents, exports)
  /export    markdown + annotated-pdf exporters
/tests
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Запустить в dev-режиме:

```bash
npm run dev
```

Опционально (для коммерческого ключа Apryse):

```bash
VITE_APRYSE_LICENSE_KEY="ваш_ключ" npm run dev
```

3. Проверки:

```bash
npm run build
npm test
```

## Передать другу на тест

Собрать установщик (без Git):

```bash
npm run dist
```

Артефакты появятся в папке `release/`:
- Linux: `PDF Recall Desktop-<version>.AppImage`
- Windows (если собираете на Windows): `PDF Recall Desktop-<version>-setup.exe`
- macOS (если собираете на macOS): `PDF Recall Desktop-<version>.dmg`

Дайте другу этот файл установщика/пакета.

## Обновления без Git

В приложении добавлен локальный апдейтер по URL манифеста:
- Поле `URL обновлений` в карточке **Интерфейс**
- Кнопки `Сохранить обновления` и `Проверить обновления`
- При новой версии появляется кнопка `Скачать <версия>`

### Поток релиза

1. Увеличьте `version` в `package.json`.
2. Соберите релиз:

```bash
npm run dist
```

3. Сгенерируйте манифест:

```bash
npm run release:manifest -- --base-url https://your-domain.example/recall/<version>/
```

4. Загрузите на ваш хостинг:
- файл установщика (`.AppImage`/`.exe`/`.dmg`)
- `update-manifest.json`

5. У друга в приложении укажите URL:

```txt
https://your-domain.example/recall/<version>/update-manifest.json
```

### Формат манифеста

```json
{
  "version": "0.1.1",
  "notes": "Что изменилось",
  "publishedAt": "2026-02-19T17:00:00.000Z",
  "downloads": {
    "linux": "https://.../PDF%20Recall%20Desktop-0.1.1.AppImage",
    "win32": "https://.../PDF%20Recall%20Desktop-0.1.1-setup.exe",
    "darwin": "https://.../PDF%20Recall%20Desktop-0.1.1.dmg"
  }
}
```

## Где хранятся данные (`userData`)

Приложение сохраняет данные в Electron `app.getPath('userData')`:
- `db.json` (метаданные документов и хайлайтов)
- `documents/<sha256>.pdf` (копии импортированных PDF)
- `exports/` (экспортированные файлы)

Типичные пути:
- Linux: `~/.config/pdf-recall-desktop`
- Windows: `%APPDATA%/pdf-recall-desktop`
- macOS: `~/Library/Application Support/pdf-recall-desktop`

В UI можно открыть путь через кнопку **Открыть папку данных**.

## Сценарий MVP

1. Импортировать PDF из файловой системы.
2. Открыть читалку и создать 2 выделения разных цветов, одно с заметкой.
3. Открыть вкладку хайлайтов, выполнить поиск, перейти к месту в PDF.
4. Экспортировать:
   - Annotated PDF (`*-annotated.pdf`)
   - Markdown (`*.md`)

## Быстрые клавиши (Reader)

- `Alt+←` / `Alt+→` — назад/вперед по истории переходов
- `PageUp` / `PageDown` — предыдущая/следующая страница
- `Ctrl/Cmd +` / `-` / `0` — zoom in/out/reset
- `g` — переход к странице
- `/` или `Ctrl/Cmd+K` — фокус в поиск по хайлайтам
- `j` / `Shift+J` — следующий/предыдущий хайлайт
- `1` / `2` / `3` — цвет маркера (желтый/зеленый/розовый)

## Ограничения MVP

- Экспорт PDF делается как **flattened highlights** (прямоугольники поверх контента), это не нативные PDF annotations.
- OCR не реализован (TODO).
- Нет синхронизации между устройствами.
- Для очень больших PDF рендер всех страниц может быть медленнее.
- Apryse WebViewer без ключа работает в trial/demo-режиме.
- Обновления выполняются через скачивание нового установщика (без автоустановки поверх процесса).

## Roadmap

- OCR для сканированных документов.
- Истинные PDF annotations.
- Опциональная синхронизация (E2E encryption).
- iOS-клиент с общей local-first моделью.
