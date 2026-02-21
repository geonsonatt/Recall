# Recall PDF

Локальная PDF-читалка с хайлайтами, SRS и AI-анализом.

## Быстрый запуск (Windows)

Требования:
- Git
- Node.js 20+
- npm

```powershell
git clone https://github.com/geonsonatt/Recall.git
cd Recall
npm ci
npm run dev
```

## AI через API (без локальных установок)

Локальные модели не нужны. AI работает через OpenAI-compatible endpoint.

1. Получите API-ключ (например OpenRouter).
2. Запустите приложение и откройте `Insights AI Workspace`.
3. Вставьте ключ в поле `API Key` (или задайте переменную окружения `RECALL_AI_API_KEY`).

Опционально можно задать переменные перед запуском:

```powershell
$env:RECALL_AI_API_KEY="ваш_ключ"
$env:RECALL_AI_API_URL="https://openrouter.ai/api/v1/chat/completions"
$env:RECALL_AI_MODEL="meta-llama/llama-3.1-8b-instruct:free"
npm run dev
```

## Полезные команды

```powershell
npm test
npm run build
npm run clean
```

## Перед пушем в GitHub

```powershell
npm test
npm run build
git add .
git commit -m "your message"
git push
```
