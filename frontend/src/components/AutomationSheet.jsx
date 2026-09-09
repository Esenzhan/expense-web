import { useEffect, useRef, useState } from "react";
import { API_BASE, fetchShortcutKey } from "../api";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";

// Адрес, на который шлёт шорткат Команд. Здесь же, а не только в голове:
// собирая автоматизацию заново, его приходится вводить руками.
const DRAFTS_ENDPOINT = `${API_BASE}/api/expense-drafts`;

export default function AutomationSheet({ onClose }) {
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);
  useSwipeDismissRight(pageRef, onClose);

  // Ключ грузится сразу с экраном, а не по тапу: iOS отзывает доступ к
  // буферу обмена, если между жестом и записью успел завершиться await.
  const [shortcutKey, setShortcutKey] = useState(null);
  const [keyState, setKeyState] = useState(null);
  // Буфер недоступен (старая iOS, отказ в разрешении) — показываем ключ
  // строкой ниже, длинным нажатием копируется вручную.
  const [keyShown, setKeyShown] = useState(false);

  useEffect(() => {
    fetchShortcutKey()
      .then(setShortcutKey)
      .catch(() => {
        // офлайн — тап по строке скажет об этом словами
      });
  }, []);

  function handleClose() {
    if (closing) return;
    haptic();
    setClosing(true);
    const el = pageRef.current;
    if (el) {
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(100%)";
    }
    setTimeout(onClose, 260);
  }

  // Синхронно, прямо в обработчике тапа — см. комментарий у shortcutKey.
  function copyKey() {
    haptic();
    if (!shortcutKey) {
      setKeyState("Нет сети");
      setTimeout(() => setKeyState(null), 2000);
      return;
    }
    const written = navigator.clipboard?.writeText(shortcutKey);
    if (!written) {
      setKeyShown(true);
      return;
    }
    written
      .then(() => {
        setKeyState("Скопировано");
        setTimeout(() => setKeyState(null), 2000);
      })
      .catch(() => setKeyShown(true));
  }

  return (
    <div ref={pageRef} className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Автоматизация</span>
        <span className="icon-button-spacer" />
      </div>

      <p className="settings-section">Команды (Shortcuts)</p>
      <div className="settings-group">
        <button className="settings-row" onClick={copyKey}>
          <span className="settings-row-label">Ключ для Команд</span>
          <span className="settings-row-value">{keyState || "Скопировать"}</span>
        </button>
        {/* Сам ключ — только если буфер отказал: в строке значения 48
            символов не переносятся и наезжают на название. */}
        {keyShown && (
          <div className="settings-row sync-problem">
            <span className="sync-problem-main">
              <span className="settings-key">{shortcutKey}</span>
              <span className="sync-problem-meta">Скопировать не вышло — нажми и удерживай ключ</span>
            </span>
          </div>
        )}
        <div className="settings-row sync-problem">
          <span className="sync-problem-main">
            <span className="settings-key">{DRAFTS_ENDPOINT}</span>
            <span className="sync-problem-meta">
              POST, заголовок X-Bot-Key с ключом выше, тело JSON: amount — сумма, description — заметка
            </span>
          </span>
        </div>
      </div>
      <p className="settings-section">
        Шорткат присылает сумму сюда, приложение при открытии само поднимает шторку с этой суммой — остаётся
        выбрать счёт и категорию.
      </p>
    </div>
  );
}
