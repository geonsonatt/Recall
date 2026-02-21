# Recall PDF

Мини-гайд по запуску на Windows.

## Быстрый старт (Windows)

Требования:
- `Git`
- `Node.js 20+` (вместе с `npm`)

PowerShell:

```powershell
git clone https://github.com/geonsonatt/Recall.git
cd Recall
npm ci
npm run dev
```

## Полезные команды

```powershell
npm test       # запустить тесты
npm run build  # production-сборка renderer
npm run clean  # очистка временных сборок
```

## Перед пушем в GitHub

```powershell
npm test
npm run build
git add .
git commit -m "your message"
git push
```
