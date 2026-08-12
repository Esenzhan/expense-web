# Telegram-бот

Голос/текст/фото → Claude Haiku парсит трату → `POST /api/expenses` на бэкенд
сайта (`../backend`) с заголовком `X-Bot-Key`. Категории берутся с сайта
через `GET /api/categories`. `/budget` и `/renovation` — единственное, что
всё ещё читает Google Sheets напрямую (через `gspread` + сервисный аккаунт),
из личных таблиц, куда бэкенд сайта сам зеркалит траты.

## Деплой — НЕ автоматический

Живёт на Oracle Cloud VM (systemd), обновляется вручную, без CI/CD из этого
репозитория:

```bash
scp -i ~/Downloads/ssh-key-2026-07-06.key bot.py requirements.txt \
  ubuntu@217.142.234.123:~/expense-bot/
ssh -i ~/Downloads/ssh-key-2026-07-06.key ubuntu@217.142.234.123 \
  "cd ~/expense-bot && source venv/bin/activate && pip install -r requirements.txt && sudo systemctl restart expense-bot"
```

## Переменные окружения (см. `.env.example`)

`credentials.json` (сервисный аккаунт Google для `/budget`/`/renovation`) и
`.env` на VM в репозиторий не входят — секреты живут только там.
