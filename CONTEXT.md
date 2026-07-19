# Контекст проекта — для Claude Code

Этот файл — конспект переписки в claude.ai, где проект был спроектирован и
написан с нуля. Дальше разработка продолжается в Claude Code (есть доступ на
коммиты/пуши), этот файл — чтобы не терять контекст решений.

## Что это за проект

Веб-версия личного `telegram-expense-bot` (Python-бот на Oracle Cloud, Whisper
+ Claude Haiku + Google Sheets) — но как PWA для iPhone, с графиками и, в
отличие от бота, **мгновенным (streaming) распознаванием голоса** вместо
записи-целиком-потом-Whisper. Повод: увидела в стороннем приложении "Qalta"
(скриншот с live-транскриптом а-ля Siri) и захотела то же самое для своего
трекера трат.

Репозиторий: `github.com/Esenzhan/expense-web`

## Стек и архитектура

```
iPhone (Safari → «Добавить на экран Домой», standalone PWA)
  │ MediaRecorder, чанки по 250мс
  ▼
WebSocket wss://backend/ws/voice
  ▼
Deepgram streaming STT (language=ru, interim_results=true)
  │ partial-текст → сразу на фронт (эффект "мгновенно")
  │ final-текст (после ~500мс тишины) → дальше
  ▼
Claude Haiku (claude-haiku-4-5-20251001) — парсит финальный текст в
  {amount, category, wallet, description}
  ▼
Postgres (Neon) — таблица expenses
  ▼
Фронт получает {type: "saved", expense}, обновляет списки/графики
```

- **Backend**: Express + `ws`, Postgres (`pg`), Anthropic SDK. Один процесс,
  REST (`/api/expenses`, `/api/stats/*`) и WebSocket (`/ws/voice`) на одном
  HTTP-сервере.
- **Frontend**: React + Vite (не Tailwind — обычный CSS в `styles.css`),
  Recharts для графиков. PWA-мета-теги в `index.html` + `manifest.json` +
  service worker (`public/sw.js`).
- Стек и паттерн деплоя (Render/Vercel/Neon) — по аналогии с [[saubol]] и
  [[kaspi-dashboard]] у того же пользователя.

## Что уже сделано

- Полный скелет backend и frontend, см. `README.md` в корне репо — там же
  список env-переменных и шаги деплоя (Render + Vercel + Neon + Deepgram).
- 4 кошелька как в боте: Личные / Семья / Бизнес / Ремонт (`backend/src/wallets.js`).
- Стриминг голоса реализован через Deepgram (не через Web Speech API — на iOS
  Safari, особенно в установленном PWA, `webkitSpeechRecognition` нестабилен:
  глючит `continuous`, `interimResults` иногда молча падает на медленное
  облачное распознавание).
- Механизмы мгновенного открытия (чтобы не ждать загрузки, как в Telegram):
  1. Service worker кеширует статику (stale-while-revalidate).
  2. Последние данные кешируются в `localStorage`, экран рисуется из кеша
     сразу, свежие данные подменяют их в фоне.
  3. Recharts грузится лениво (`React.lazy`) — кнопка микрофона интерактивна
     до того, как графики догрузятся.
- `frontend/vercel.json` — rewrite для SPA-роутинга (та же проблема, что была
  на saubol с прямой навигацией на `/login`).
- Git-репозиторий локально инициализирован с одним коммитом; пуш на GitHub
  ещё не выполнен (в claude.ai нет сетевого доступа для пуша).

## Известный пробел — самое важное

**Определение кошелька сейчас идёт через саму LLM (Haiku)**, а не через
детерминированный keyword-матчинг, как было специально отрефакторено в
telegram-боте (`backend/src/services/parseExpense.js` — просит модель вернуть
JSON с полем `wallet`). Это шаг назад по надёжности.

TODO: перенести точный keyword-матчинг из кода бота в
`backend/src/wallets.js` как отдельную функцию, которая проверяется **до**
вызова Haiku (Haiku — только фолбэк, если ключевые слова не сработали).
Файл с логикой бота ещё не был показан в этой переписке — нужно достать его
и перенести правила 1:1.

## Переменные окружения (см. `.env.example` в backend/ и frontend/)

- `DATABASE_URL` — Neon, новый проект (не `saubol-medkarta`)
- `ANTHROPIC_API_KEY` — отдельный ключ в Claude Console (не переиспользовать
  ключ бота или saubol)
- `DEEPGRAM_API_KEY` — deepgram.com, есть бесплатный tier
- `FRONTEND_URL` (backend) / `VITE_API_URL` (frontend) — голый origin, без
  завершающего слэша (та же ошибка CORS уже была на saubol из-за этого)

## Возможные грабли при деплое

- Render должен поддерживать долгоживущие WebSocket-соединения на выбранном
  плане — если запись голоса рвётся, проверять именно это.
- GitHub push 403 — на Mac пользователя раньше кешировались credentials
  другого аккаунта (`tulenovadi-hub`) при работе с `saubol`; для этого репо
  нужен аккаунт `Esenzhan`.
