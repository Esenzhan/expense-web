# Telegram-бот

Голос/текст/фото → Claude Haiku парсит трату → `POST /api/expenses` на бэкенд
сайта (`../backend`) с заголовком `X-Bot-Key`. Категории берутся с сайта
через `GET /api/categories`. `/budget` и `/renovation` — единственное, что
всё ещё читает Google Sheets напрямую (через `gspread` + сервисный аккаунт),
из личных таблиц, куда бэкенд сайта сам зеркалит траты.

**Этот репозиторий — только хранилище кода и его истории. Реально бот
работает на отдельном сервере (Oracle Cloud VM) и запущен из папки
`~/expense-bot/` на нём — это ФИЗИЧЕСКИ ДРУГАЯ копия файлов, не связанная
с GitHub. Пуш в `main` НИЧЕГО не меняет на живом боте** — в отличие от
`frontend/`/`backend/`, для которых есть автодеплой (Vercel/Render). Чтобы
изменения из `bot.py` реально заработали, их нужно вручную скопировать на
VM и перезапустить сервис — команды ниже.

## Деплой — НЕ автоматический

Живёт на Oracle Cloud VM (`217.142.234.123`, systemd-сервис `expense-bot`),
обновляется вручную, без CI/CD из этого репозитория:

```bash
scp -i ~/Downloads/ssh-key-2026-07-06.key bot.py requirements.txt \
  ubuntu@217.142.234.123:~/expense-bot/
ssh -i ~/Downloads/ssh-key-2026-07-06.key ubuntu@217.142.234.123 \
  "cd ~/expense-bot && source venv/bin/activate && pip install -r requirements.txt && sudo systemctl restart expense-bot"
```

## Переменные окружения (см. `.env.example`)

`credentials.json` (сервисный аккаунт Google для `/budget`/`/renovation`) и
`.env` на VM в репозиторий не входят — секреты живут только там.
