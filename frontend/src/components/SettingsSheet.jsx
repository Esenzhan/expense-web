import { useState } from "react";
import { fetchExpenses } from "../api";
import { haptic } from "../haptics";

const SETTINGS_KEY = "traty-settings";

const TOGGLE_DEFAULTS = {
  calculator: true,
  alwaysShowIncome: false,
  roundTotals: false,
  transferAsFlow: false,
  adjustmentAsFlow: false,
};

function loadToggles() {
  try {
    return { ...TOGGLE_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...TOGGLE_DEFAULTS };
  }
}

function I({ children }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const Icons = {
  grid: <I><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></I>,
  currency: <I><circle cx="12" cy="12" r="5" /><path d="M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></I>,
  globe: <I><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="3.5" ry="8" /><path d="M4 12h16" /></I>,
  voice: <I><rect x="9" y="4" width="6" height="10" rx="3" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v3" /></I>,
  bell: <I><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5H4.5L6 16Z" /><path d="M10 21a2 2 0 0 0 4 0" /></I>,
  calendar: <I><rect x="4" y="6" width="16" height="14" rx="3" /><path d="M8 3v5M16 3v5M4 11h16" /></I>,
  palette: <I><path d="M12 4a8 8 0 1 0 0 16c1.5 0 2-1 1.5-2s0-2 1.5-2H17a3 3 0 0 0 3-3 8 8 0 0 0-8-9Z" /><circle cx="8.5" cy="10.5" r="0.5" /><circle cx="12" cy="8.5" r="0.5" /><circle cx="15.5" cy="10.5" r="0.5" /></I>,
  buttons: <I><circle cx="12" cy="12" r="3.5" /><circle cx="4.5" cy="12" r="1" /><circle cx="19.5" cy="12" r="1" /></I>,
  calc: <I><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" /></I>,
  income: <I><path d="M17 7 7 17M7 10v7h7" /></I>,
  round: <I><circle cx="6" cy="17" r="1" /><circle cx="11" cy="17" r="1" /><path d="M15 17h5m-2.5-2.5L20 17l-2.5 2.5" /></I>,
  transfer: <I><path d="M4 8h13m-3-3 3 3-3 3M20 16H7m3-3-3 3 3 3" /></I>,
  plusminus: <I><path d="M12 4v6M9 7h6M8 17h8M4 4v16" opacity="0" /><path d="M12 5v6M9 8h6M9 17h6M5 12h.01" opacity="0" /><path d="M12 4v7M8.5 7.5h7M8.5 17h7" /></I>,
  importIcon: <I><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M12 4v8m0 0-3-3m3 3 3-3" /></I>,
  exportIcon: <I><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M12 12V4m0 0L9 7m3-3 3 3" /></I>,
  database: <I><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></I>,
  robot: <I><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 8V4m0 0h3" /><circle cx="9.5" cy="13" r="0.5" /><circle cx="14.5" cy="13" r="0.5" /></I>,
  heart: <I><path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20Z" /></I>,
  mail: <I><rect x="4" y="6" width="16" height="12" rx="3" /><path d="m5 8 7 5 7-5" /></I>,
  lock: <I><rect x="6" y="11" width="12" height="9" rx="3" /><path d="M9 11V8a3 3 0 0 1 6 0v3" /></I>,
  doc: <I><rect x="6" y="4" width="12" height="16" rx="3" /><path d="M9.5 9h5M9.5 12.5h5M9.5 16h3" /></I>,
  personX: <I><circle cx="10" cy="8" r="3.5" /><path d="M4.5 20a6 6 0 0 1 11 0" /><path d="m16.5 9.5 4 4m0-4-4 4" /></I>,
  chevron: <I><path d="m10 7 5 5-5 5" /></I>,
};

function Row({ icon, label, value, badge, danger, onPress }) {
  return (
    <button className={`settings-row ${danger ? "danger" : ""}`} onClick={onPress}>
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-label">{label}</span>
      {badge && <span className="settings-badge">{badge}</span>}
      {value && <span className="settings-row-value">{value}</span>}
    </button>
  );
}

function ToggleRow({ icon, label, on, onFlip }) {
  return (
    <button className="settings-row" onClick={onFlip}>
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-label">{label}</span>
      <span className={`switch ${on ? "on" : ""}`}>
        <span className="switch-knob" />
      </span>
    </button>
  );
}

export default function SettingsSheet({ onClose, onOpenCategories }) {
  const [toggles, setToggles] = useState(loadToggles);

  function flip(key) {
    haptic();
    setToggles((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function exportCsv() {
    haptic();
    const rows = await fetchExpenses({ limit: 10000 });
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "id,Дата,Кошелёк,Категория,Сумма,Заметка",
      ...rows.map((r) =>
        [r.id, r.created_at, r.wallet, r.category, r.amount, r.description ?? ""].map(esc).join(",")
      ),
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "traty.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={onClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Настройки</span>
        <span className="icon-button-spacer" />
      </div>

      <p className="settings-section">Основные</p>
      <div className="settings-group">
        <Row icon={Icons.grid} label="Категории" onPress={onOpenCategories} />
        <Row icon={Icons.currency} label="Валюта по умолчанию" value="KZT" />
        <Row icon={Icons.globe} label="Язык интерфейса" value="русский" />
        <Row icon={Icons.voice} label="Язык голоса" value="русский (Казахстан)" />
        <Row icon={Icons.bell} label="Напоминания" value="Выключены" />
        <Row icon={Icons.calendar} label="Первый день недели" value="Понедельник" />
        <Row icon={Icons.palette} label="Тема" value="Системная" />
      </div>

      <p className="settings-section">Персонализация</p>
      <div className="settings-group">
        <Row icon={Icons.buttons} label="Кнопки добавления операций" />
        <ToggleRow icon={Icons.calc} label="Калькулятор" on={toggles.calculator} onFlip={() => flip("calculator")} />
        <ToggleRow icon={Icons.income} label="Всегда показывать доходы" on={toggles.alwaysShowIncome} onFlip={() => flip("alwaysShowIncome")} />
        <ToggleRow icon={Icons.round} label="Округлять итоги" on={toggles.roundTotals} onFlip={() => flip("roundTotals")} />
        <ToggleRow icon={Icons.transfer} label="Перевод как доход/расход" on={toggles.transferAsFlow} onFlip={() => flip("transferAsFlow")} />
        <ToggleRow icon={Icons.plusminus} label="Корректировка как доход/расход" on={toggles.adjustmentAsFlow} onFlip={() => flip("adjustmentAsFlow")} />
      </div>

      <p className="settings-section">Импорт и экспорт</p>
      <div className="settings-group">
        <Row icon={Icons.importIcon} label="Импорт" badge="BETA" />
        <Row icon={Icons.exportIcon} label="Экспорт (CSV)" onPress={exportCsv} />
        <Row icon={Icons.database} label="Резервное копирование" />
      </div>

      <div className="settings-group">
        <Row icon={Icons.robot} label="Автоматизация" value="Команды и диплинки" />
      </div>

      <p className="settings-section">Поддержка</p>
      <div className="settings-group">
        <Row icon={Icons.heart} label="Оставить отзыв" />
        <Row icon={Icons.mail} label="Помощь и поддержка" />
        <Row icon={Icons.lock} label="Политика конфиденциальности" />
        <Row icon={Icons.doc} label="Условия использования" />
      </div>

      <div className="settings-group">
        <Row icon={Icons.personX} label="Удалить учётную запись" danger />
      </div>
    </div>
  );
}
