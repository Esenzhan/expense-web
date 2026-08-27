import os
import json
import base64
import logging
import tempfile
import time
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

import anthropic
import openai
import gspread
import requests
from google.oauth2.service_account import Credentials
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    filters, ContextTypes
)

load_dotenv()

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
openai_client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Offline fallback per wallet, used only if the site's API is unreachable —
# each wallet's real list now lives on the site (Postgres), independently
# editable per wallet.
WALLETS = {
    "Личные": ["Рестораны и кафе", "Заказ еды", "Подарки", "Вкусняшки", "Покупки", "Здоровье и аптека"],
    "Семья": ["Квартира", "Коммуналка", "Продукты", "На ребёнка", "Дом и быт", "Расходы на машину"],
    "Бизнес": ["Прочее"],
    "Ремонт": ["Электрика черновая", "Электрика чистовая", "Санузел", "Услуги", "Черновые материалы", "Чистовые материалы", "Мебель", "Другое"]
}

DEFAULT_LIMITS = [
    ["Личные", "Все личные", 200000],
    ["Семья", "Квартира", 593000],
    ["Семья", "Коммуналка", 20000],
    ["Семья", "Продукты", 200000],
    ["Семья", "На ребёнка", 80000],
    ["Семья", "Дом и быт", 50000],
    ["Семья", "Расходы на машину", 50000],
]

# Still needed for /budget and /renovation, which keep reading straight out
# of each account's personal Google Sheet (unchanged from before) — but
# that sheet is now written to by the website backend, not by this bot.
USER_SHEETS = {
    int(os.getenv("USER1_TELEGRAM_ID")): os.getenv("USER1_SHEET_ID"),
    int(os.getenv("USER2_TELEGRAM_ID")): os.getenv("USER2_SHEET_ID"),
}
RENOVATION_SHEET_ID = os.getenv("USER1_SHEET_ID")

# Per-account key for authenticating expense writes against the website's API.
USER_BOT_KEYS = {
    int(os.getenv("USER1_TELEGRAM_ID")): os.getenv("USER1_BOT_KEY"),
    int(os.getenv("USER2_TELEGRAM_ID")): os.getenv("USER2_BOT_KEY"),
}

API_BASE_URL = (os.getenv("API_BASE_URL") or "").rstrip("/")

_categories_cache = {}  # wallet -> {"data": [...], "at": ts}
# expense_id -> last known {id, wallet, amount, category, description} —
# lets the "✏️ Исправить" flow build a full PUT payload without a
# get-single-expense endpoint. Lost on bot restart, same as the old
# row-index approach effectively was.
expense_cache = {}


def get_google_client():
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        creds_dict = json.loads(creds_json)
        creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    else:
        creds = Credentials.from_service_account_file(
            os.getenv("GOOGLE_CREDENTIALS_FILE"), scopes=scopes
        )
    return gspread.authorize(creds)


def get_spreadsheet(telegram_user_id: int):
    sheet_id = USER_SHEETS.get(telegram_user_id)
    if not sheet_id:
        return None
    client = get_google_client()
    return client.open_by_key(sheet_id)


def get_renovation_spreadsheet():
    client = get_google_client()
    return client.open_by_key(RENOVATION_SHEET_ID)


def get_wallet_sheet(telegram_user_id: int, wallet: str):
    if wallet == "Ремонт":
        spreadsheet = get_renovation_spreadsheet()
    else:
        spreadsheet = get_spreadsheet(telegram_user_id)
    if not spreadsheet:
        return None
    try:
        ws = spreadsheet.worksheet(wallet)
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=wallet, rows=100, cols=8)
        ws.append_row(["Дата", "Время", "Сумма", "Категория", "Описание", "Источник", "Кто", "ID"])
    return ws


def get_limits_sheet(telegram_user_id: int):
    spreadsheet = get_spreadsheet(telegram_user_id)
    if not spreadsheet:
        return None
    try:
        return spreadsheet.worksheet("Лимиты")
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title="Лимиты", rows=50, cols=3)
        ws.append_row(["Кошелёк", "Категория", "Лимит"])
        for row in DEFAULT_LIMITS:
            ws.append_row(row)
        return ws


def get_limits(telegram_user_id: int) -> dict:
    ws = get_limits_sheet(telegram_user_id)
    if not ws:
        return {}
    rows = ws.get_all_records()
    limits = {}
    for row in rows:
        key = (row["Кошелёк"], row["Категория"])
        try:
            limits[key] = float(str(row["Лимит"]).replace(" ", "").replace(",", "."))
        except (ValueError, TypeError):
            pass
    return limits


def parse_amount(raw) -> float:
    try:
        amount_raw = str(raw)
        amount_raw = amount_raw.replace("₸", "").replace("Т", "").replace("\xa0", "").replace(" ", "").replace(",", ".").strip()
        return float(amount_raw)
    except (ValueError, TypeError):
        return 0.0


# Алматы — UTC+5 круглый год (без перехода на летнее время). Хост бота живёт
# в UTC, поэтому datetime.now() первые 5 часов суток отдавал вчерашнюю дату —
# первого числа месяца /budget считал бы траты за прошлый месяц.
ALMATY_TZ = timezone(timedelta(hours=5))


def almaty_now() -> datetime:
    return datetime.now(ALMATY_TZ)


def get_monthly_spent(telegram_user_id: int, wallet: str) -> dict:
    ws = get_wallet_sheet(telegram_user_id, wallet)
    if not ws:
        return {}
    current_month = almaty_now().strftime("%m.%Y")
    rows = ws.get_all_records()
    spent_by_cat = {}
    for row in rows:
        date_str = str(row.get("Дата", ""))
        if not date_str or len(date_str) < 7:
            continue
        try:
            month_year = date_str[3:]
            if month_year != current_month:
                continue
        except Exception:
            continue
        cat = row.get("Категория", "")
        amount = parse_amount(row.get("Сумма", 0))
        spent_by_cat[cat] = spent_by_cat.get(cat, 0) + amount
    return spent_by_cat


def get_renovation_total() -> float:
    try:
        spreadsheet = get_renovation_spreadsheet()
        ws = spreadsheet.worksheet("Ремонт")
        rows = ws.get_all_records()
        total = 0.0
        for row in rows:
            total += parse_amount(row.get("Сумма", 0))
        return total
    except Exception:
        return 0.0


def format_amount(amount: float) -> str:
    return f"{int(amount):,}".replace(",", " ")


def get_month_name() -> str:
    months = {
        1: "января", 2: "февраля", 3: "марта", 4: "апреля",
        5: "мая", 6: "июня", 7: "июля", 8: "августа",
        9: "сентября", 10: "октября", 11: "ноября", 12: "декабря"
    }
    now = almaty_now()
    return f"{months[now.month]} {now.year}"


def build_budget_message(user_id: int, wallet: str, category: str) -> str:
    if wallet in ("Бизнес", "Ремонт"):
        return ""

    limits = get_limits(user_id)
    spent = get_monthly_spent(user_id, wallet)
    month_name = get_month_name()
    lines = [f"\n📊 *Остаток за {month_name}:*"]

    if wallet == "Личные":
        limit_key = ("Личные", "Все личные")
        limit = limits.get(limit_key, 0)
        total_spent = sum(spent.values())
        remaining = limit - total_spent
        if remaining >= 0:
            lines.append(f"👤 Личные: *{format_amount(remaining)}* из {format_amount(limit)} ₸")
        else:
            lines.append(f"⚠️ Личные: *превышен на {format_amount(abs(remaining))} ₸!*")

    elif wallet == "Семья":
        cat_limit_key = ("Семья", category)
        if cat_limit_key in limits:
            cat_limit = limits[cat_limit_key]
            cat_spent = spent.get(category, 0)
            cat_remaining = cat_limit - cat_spent
            if cat_remaining >= 0:
                lines.append(f"  {category}: *{format_amount(cat_remaining)}* из {format_amount(cat_limit)} ₸")
            else:
                lines.append(f"  ⚠️ {category}: *превышен на {format_amount(abs(cat_remaining))} ₸!*")

    return "\n".join(lines)


# --- Categories now live on the website (Postgres), one independent list
# per wallet. Creating/deleting categories is site-only; the bot just reads
# the current list for its own wallet to build its Claude prompts. ---
def get_categories(wallet: str) -> list:
    now = time.time()
    entry = _categories_cache.get(wallet, {"data": None, "at": 0})
    if entry["data"] is None or now - entry["at"] > 60:
        try:
            resp = requests.get(
                f"{API_BASE_URL}/api/categories", params={"wallet": wallet}, timeout=10
            )
            resp.raise_for_status()
            entry = {"data": [c["name"] for c in resp.json()], "at": now}
            _categories_cache[wallet] = entry
        except Exception as e:
            logger.error(f"Не удалось получить категории счёта {wallet} с сайта: {e}")
    return entry["data"] or []


def get_user_categories(wallet: str) -> list:
    cats = get_categories(wallet)
    return cats if cats else WALLETS.get(wallet, ["Другое"])


def detect_wallet(text: str) -> str:
    text_lower = text.lower()
    renovation_keywords = ["ремонт", "ремонта", "ремонту", "ремонтом", "ремонте"]
    for kw in renovation_keywords:
        if kw in text_lower:
            return "Ремонт"
    business_keywords = ["бизнес", "бизнеса", "бизнесу", "бизнесом", "бизнесе"]
    for kw in business_keywords:
        if kw in text_lower:
            return "Бизнес"
    return None


def save_expense(user_id: int, wallet: str, amount: float, category: str, description: str, source: str):
    headers = {"X-Bot-Key": USER_BOT_KEYS.get(user_id, ""), "Content-Type": "application/json"}
    payload = {"wallet": wallet, "amount": amount, "category": category, "description": description, "raw_text": source}
    try:
        resp = requests.post(f"{API_BASE_URL}/api/expenses", json=payload, headers=headers, timeout=15)
        resp.raise_for_status()
        expense = resp.json()
        expense_cache[expense["id"]] = expense
        return expense
    except Exception as e:
        logger.error(f"Не удалось сохранить трату через API: {e}")
        return None


def update_expense(user_id: int, expense_id: int, wallet: str, amount: float, category: str, description: str):
    headers = {"X-Bot-Key": USER_BOT_KEYS.get(user_id, ""), "Content-Type": "application/json"}
    payload = {"wallet": wallet, "amount": amount, "category": category, "description": description}
    resp = requests.put(f"{API_BASE_URL}/api/expenses/{expense_id}", json=payload, headers=headers, timeout=15)
    resp.raise_for_status()
    expense = resp.json()
    expense_cache[expense["id"]] = expense
    return expense


def extract_expense(text: str, categories_by_wallet: dict) -> dict:
    # Both wallets' category lists go in — the model picks "wallet" AND
    # "category" together, so it needs the actual list for whichever wallet
    # it lands on. Passing only "Личные"'s list here used to mean a "Семья"
    # classification would still get a category from the wrong wallet.
    lichnye_cats = "/".join(categories_by_wallet.get("Личные", []))
    semya_cats = "/".join(categories_by_wallet.get("Семья", []))
    response = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": f"""Извлеки данные о расходе из текста.

Категории кошелька «Личные»: {lichnye_cats}
Категории кошелька «Семья»: {semya_cats}

Верни ТОЛЬКО JSON без пояснений:
{{
  "amount": число (сумма, только цифры),
  "wallet": "Личные или Семья",
  "category": "подходящая категория ИЗ СПИСКА ВЫБРАННОГО КОШЕЛЬКА",
  "description": "краткое описание"
}}

Правила определения кошелька:
- Семья: продукты, квартира, коммуналка, расходы на ребёнка, дом, машина (мойка/заправка)
- Личные: рестораны, кафе, заказ еды, подарки, вкусняшки, одежда, здоровье, аптека, такси, личные покупки

Если это не расход — верни: {{"error": "не расход"}}

Текст: {text}"""
        }]
    )
    raw = response.content[0].text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def extract_expense_renovation(text: str, categories: list) -> dict:
    cats = "/".join(categories)
    response = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{
            "role": "user",
            "content": f"""Извлеки данные о расходе на ремонт из текста.
Верни ТОЛЬКО JSON без пояснений:
{{
  "amount": число (сумма, только цифры),
  "category": "одна из: {cats}",
  "description": "краткое описание"
}}
Если это не расход — верни: {{"error": "не расход"}}
Текст: {text}"""
        }]
    )
    raw = response.content[0].text.strip().replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def extract_expense_from_image(image_data: bytes, categories_by_wallet: dict) -> dict:
    image_b64 = base64.standard_b64encode(image_data).decode("utf-8")
    lichnye_cats = "/".join(categories_by_wallet.get("Личные", []))
    semya_cats = "/".join(categories_by_wallet.get("Семья", []))
    response = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": image_b64
                    }
                },
                {
                    "type": "text",
                    "text": f"""Это фото чека. Извлеки данные о расходе.

Категории кошелька «Личные»: {lichnye_cats}
Категории кошелька «Семья»: {semya_cats}

Верни ТОЛЬКО JSON без пояснений:
{{
  "amount": число (итоговая сумма),
  "wallet": "Личные или Семья",
  "category": "подходящая категория ИЗ СПИСКА ВЫБРАННОГО КОШЕЛЬКА",
  "description": "название магазина или что куплено"
}}

Если это не чек — верни: {{"error": "не чек"}}"""
                }
            ]
        }]
    )
    raw = response.content[0].text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


async def transcribe_voice(voice_file_path: str) -> str:
    with open(voice_file_path, "rb") as audio_file:
        transcript = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="ru"
        )
    return transcript.text


def is_allowed(user_id: int) -> bool:
    return user_id in USER_SHEETS


def wallet_emoji(wallet: str) -> str:
    if wallet == "Личные":
        return "👤"
    elif wallet == "Семья":
        return "👨‍👩‍👦"
    elif wallet == "Бизнес":
        return "💼"
    elif wallet == "Ремонт":
        return "🔨"
    return ""


def make_edit_keyboard(wallet: str, expense_id: int) -> InlineKeyboardMarkup:
    keyboard = [[InlineKeyboardButton("✏️ Исправить", callback_data=f"edit_{wallet}_{expense_id}")]]
    return InlineKeyboardMarkup(keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    get_limits_sheet(user_id)
    await update.message.reply_text(
        "👋 Привет! Я бот для учёта расходов.\n\n"
        "У тебя 4 кошелька:\n"
        "👤 *Личные* — рестораны, покупки, здоровье\n"
        "👨‍👩‍👦 *Семья* — продукты, квартира, ребёнок, машина\n"
        "💼 *Бизнес* — упомяни слово 'бизнес'\n"
        "🔨 *Ремонт* — упомяни слово 'ремонт'\n\n"
        "Команды:\n"
        "/categories_list — список категорий\n"
        "/budget — остатки по кошелькам\n"
        "/renovation — итого по ремонту\n\n"
        "Категории теперь настраиваются на сайте.",
        parse_mode="Markdown"
    )


async def budget_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    try:
        limits = get_limits(user_id)
        month_name = get_month_name()
        lines = [f"📊 *Бюджет за {month_name}:*\n"]

        spent_personal = get_monthly_spent(user_id, "Личные")
        limit_personal = limits.get(("Личные", "Все личные"), 0)
        total_personal = sum(spent_personal.values())
        remaining_personal = limit_personal - total_personal
        lines.append("👤 *Личные:*")
        if remaining_personal >= 0:
            lines.append(f"  Остаток: *{format_amount(remaining_personal)}* из {format_amount(limit_personal)} ₸")
        else:
            lines.append(f"  ⚠️ Превышен на *{format_amount(abs(remaining_personal))} ₸!*")

        lines.append("\n👨‍👩‍👦 *Семья:*")
        spent_family = get_monthly_spent(user_id, "Семья")
        for (w, cat), limit in limits.items():
            if w != "Семья":
                continue
            cat_spent = spent_family.get(cat, 0)
            remaining = limit - cat_spent
            if remaining >= 0:
                lines.append(f"  {cat}: *{format_amount(remaining)}* из {format_amount(limit)} ₸")
            else:
                lines.append(f"  ⚠️ {cat}: превышен на *{format_amount(abs(remaining))} ₸!*")

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Ошибка при получении бюджета: {e}")
        await update.message.reply_text("❌ Не удалось получить данные бюджета.")


async def renovation_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    try:
        total = get_renovation_total()
        await update.message.reply_text(
            f"🔨 *Итого по ремонту:*\n\n"
            f"Потрачено всего: *{format_amount(total)} ₸*",
            parse_mode="Markdown"
        )
    except Exception as e:
        logger.error(f"Ошибка при получении итогов ремонта: {e}")
        await update.message.reply_text("❌ Не удалось получить данные по ремонту.")


async def categories_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    try:
        shared = get_user_categories("Личные")
        renovation = get_user_categories("Ремонт")
        text = "📋 *Категории (Личные/Семья/Бизнес):*\n"
        text += "\n".join([f"  • {c}" for c in shared])
        text += "\n\n🔨 *Ремонт:*\n"
        text += "\n".join([f"  • {c}" for c in renovation])
        text += "\n\n_Управлять категориями можно на сайте._"
        await update.message.reply_text(text, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Ошибка при получении категорий: {e}")
        await update.message.reply_text("❌ Не удалось получить категории.")


async def edit_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    parts = query.data.replace("edit_", "").rsplit("_", 1)
    if len(parts) != 2:
        await query.edit_message_reply_markup(reply_markup=None)
        return
    wallet, expense_id = parts[0], int(parts[1])
    context.user_data["edit_wallet"] = wallet
    context.user_data["edit_expense_id"] = expense_id
    keyboard = [
        [InlineKeyboardButton("🗂 Изменить кошелёк", callback_data="editaction_wallet")],
        [InlineKeyboardButton("📁 Изменить категорию", callback_data="editaction_category")],
        [InlineKeyboardButton("❌ Отмена", callback_data="editaction_cancel")],
    ]
    await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(keyboard))


async def edit_action_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "editaction_cancel":
        await query.edit_message_reply_markup(reply_markup=None)
        return
    if query.data == "editaction_wallet":
        keyboard = [
            [InlineKeyboardButton("👤 Личные", callback_data="editwallet_Личные")],
            [InlineKeyboardButton("👨‍👩‍👦 Семья", callback_data="editwallet_Семья")],
            [InlineKeyboardButton("💼 Бизнес", callback_data="editwallet_Бизнес")],
            [InlineKeyboardButton("🔨 Ремонт", callback_data="editwallet_Ремонт")],
            [InlineKeyboardButton("❌ Отмена", callback_data="editaction_cancel")],
        ]
        await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(keyboard))
    elif query.data == "editaction_category":
        wallet = context.user_data.get("edit_wallet", "Личные")
        cats = get_user_categories(wallet)
        keyboard = []
        for cat in cats:
            keyboard.append([InlineKeyboardButton(cat, callback_data=f"editcat_{cat}")])
        keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="editaction_cancel")])
        await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(keyboard))


async def edit_wallet_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    new_wallet = query.data.replace("editwallet_", "")
    context.user_data["new_wallet"] = new_wallet
    cats = get_user_categories(new_wallet)
    keyboard = []
    for cat in cats:
        keyboard.append([InlineKeyboardButton(cat, callback_data=f"editnewcat_{cat}")])
    keyboard.append([InlineKeyboardButton("❌ Отмена", callback_data="editaction_cancel")])
    await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup(keyboard))
    await query.message.reply_text(
        f"Выбери категорию для *{new_wallet}*:",
        parse_mode="Markdown"
    )


async def edit_newcat_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    new_cat = query.data.replace("editnewcat_", "")
    new_wallet = context.user_data.get("new_wallet")
    expense_id = context.user_data.get("edit_expense_id")
    cached = expense_cache.get(expense_id)
    if not cached:
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("❌ Не нашёл эту трату — попробуй отредактировать через сайт.")
        return
    try:
        update_expense(user_id, expense_id, new_wallet, float(cached["amount"]), new_cat, cached.get("description") or "")
        context.user_data["edit_wallet"] = new_wallet
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(
            f"✅ Запись перемещена в *{new_wallet}* {wallet_emoji(new_wallet)}\n"
            f"📁 Категория: *{new_cat}*",
            parse_mode="Markdown"
        )
    except Exception as e:
        logger.error(f"Ошибка при смене кошелька: {e}")
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("❌ Не удалось изменить кошелёк.")


async def edit_category_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    new_cat = query.data.replace("editcat_", "")
    wallet = context.user_data.get("edit_wallet")
    expense_id = context.user_data.get("edit_expense_id")
    cached = expense_cache.get(expense_id)
    if not cached:
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("❌ Не нашёл эту трату — попробуй отредактировать через сайт.")
        return
    try:
        update_expense(user_id, expense_id, wallet, float(cached["amount"]), new_cat, cached.get("description") or "")
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(
            f"✅ Категория изменена на *{new_cat}*",
            parse_mode="Markdown"
        )
    except Exception as e:
        logger.error(f"Ошибка при смене категории: {e}")
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("❌ Не удалось изменить категорию.")


async def process_expense(update: Update, text: str, source: str, user_id: int):
    try:
        wallet = detect_wallet(text)

        if wallet == "Ремонт":
            cats = get_user_categories("Ремонт")
            data = extract_expense_renovation(text, cats)
            if "error" in data:
                return False
            data["wallet"] = "Ремонт"

        elif wallet == "Бизнес":
            cats_str = "/".join(get_user_categories("Бизнес"))
            response = claude.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": f"""Извлеки данные о расходе из текста.
Верни ТОЛЬКО JSON без пояснений:
{{
  "amount": число (сумма, только цифры),
  "category": "одна из: {cats_str}",
  "description": "краткое описание"
}}
Если это не расход — верни: {{"error": "не расход"}}
Текст: {text}"""
                }]
            )
            raw = response.content[0].text.strip().replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)
            if "error" in data:
                return False
            data["wallet"] = "Бизнес"

        else:
            categories_by_wallet = {
                "Личные": get_user_categories("Личные"),
                "Семья": get_user_categories("Семья"),
            }
            data = extract_expense(text, categories_by_wallet)
            if "error" in data:
                return False

        expense = save_expense(user_id, data["wallet"], data["amount"], data["category"], data["description"], source)
        if not expense:
            await update.message.reply_text("❌ Не удалось сохранить трату — сайт недоступен, попробуй позже.")
            return False

        emoji = wallet_emoji(data["wallet"])
        keyboard = make_edit_keyboard(data["wallet"], expense["id"])
        budget_msg = build_budget_message(user_id, data["wallet"], data["category"])

        if data["wallet"] == "Ремонт":
            total = get_renovation_total()
            renovation_msg = f"\n\n🔨 *Итого по ремонту:* {format_amount(total)} ₸"
        else:
            renovation_msg = ""

        await update.message.reply_text(
            f"✅ Записано в *{data['wallet']}*! {emoji}\n"
            f"💰 Сумма: *{data['amount']}*\n"
            f"📁 Категория: *{data['category']}*\n"
            f"📝 Описание: {data['description']}"
            f"{budget_msg}"
            f"{renovation_msg}",
            parse_mode="Markdown",
            reply_markup=keyboard
        )
        return True
    except Exception as e:
        logger.error(f"Ошибка обработки: {e}")
        return False


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    await update.message.reply_text("⏳ Обрабатываю...")
    success = await process_expense(update, update.message.text, "текст", user_id)
    if not success:
        await update.message.forward(update.message.chat_id)
        await update.message.reply_text(
            "🤔 Не понял это сообщение. Поясни пожалуйста — что это за расход и сумма?"
        )


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    await update.message.reply_text("🎤 Слушаю и записываю...")
    try:
        voice = update.message.voice
        voice_file = await context.bot.get_file(voice.file_id)
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
            await voice_file.download_to_drive(tmp.name)
            voice_path = tmp.name
        text = await transcribe_voice(voice_path)
        os.unlink(voice_path)
        await update.message.reply_text(f"🗣 Услышал: _{text}_", parse_mode="Markdown")
        success = await process_expense(update, text, "голос", user_id)
        if not success:
            await update.message.forward(update.message.chat_id)
            await update.message.reply_text(
                "🤔 Не понял это голосовое. Напиши текстом — что за расход и сумма?"
            )
    except Exception as e:
        logger.error(f"Ошибка при обработке голоса: {e}")
        await update.message.reply_text("❌ Не удалось обработать голосовое.")


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if not is_allowed(user_id):
        await update.message.reply_text("⛔ У тебя нет доступа к этому боту.")
        return
    await update.message.reply_text("📸 Читаю чек...")
    try:
        photo = update.message.photo[-1]
        photo_file = await context.bot.get_file(photo.file_id)
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            await photo_file.download_to_drive(tmp.name)
            photo_path = tmp.name
        with open(photo_path, "rb") as f:
            image_data = f.read()
        os.unlink(photo_path)
        categories_by_wallet = {
            "Личные": get_user_categories("Личные"),
            "Семья": get_user_categories("Семья"),
        }
        data = extract_expense_from_image(image_data, categories_by_wallet)
        if "error" in data:
            await update.message.reply_text("🤔 Не смог прочитать чек. Попробуй сфотографировать ровнее.")
            return
        expense = save_expense(user_id, data["wallet"], data["amount"], data["category"], data["description"], "чек")
        if not expense:
            await update.message.reply_text("❌ Не удалось сохранить чек — сайт недоступен.")
            return
        emoji = wallet_emoji(data["wallet"])
        keyboard = make_edit_keyboard(data["wallet"], expense["id"])
        budget_msg = build_budget_message(user_id, data["wallet"], data["category"])
        await update.message.reply_text(
            f"✅ Чек записан в *{data['wallet']}*! {emoji}\n"
            f"💰 Сумма: *{data['amount']}*\n"
            f"📁 Категория: *{data['category']}*\n"
            f"📝 Описание: {data['description']}"
            f"{budget_msg}",
            parse_mode="Markdown",
            reply_markup=keyboard
        )
    except Exception as e:
        logger.error(f"Ошибка при обработке фото: {e}")
        await update.message.reply_text("❌ Ошибка при чтении чека.")


def main():
    token = os.getenv("TELEGRAM_TOKEN")
    if not token:
        raise ValueError("TELEGRAM_TOKEN не найден в .env файле!")
    if not API_BASE_URL:
        raise ValueError("API_BASE_URL не найден в .env файле!")
    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("categories_list", categories_list))
    app.add_handler(CommandHandler("budget", budget_command))
    app.add_handler(CommandHandler("renovation", renovation_command))
    app.add_handler(CallbackQueryHandler(edit_callback, pattern="^edit_"))
    app.add_handler(CallbackQueryHandler(edit_action_callback, pattern="^editaction_"))
    app.add_handler(CallbackQueryHandler(edit_wallet_callback, pattern="^editwallet_"))
    app.add_handler(CallbackQueryHandler(edit_newcat_callback, pattern="^editnewcat_"))
    app.add_handler(CallbackQueryHandler(edit_category_callback, pattern="^editcat_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    print("🤖 Бот запущен! Нажми Ctrl+C для остановки.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
