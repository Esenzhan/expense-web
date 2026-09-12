import { useEffect, useRef, useState } from "react";
import { API_BASE, fetchShortcutKey, subscribeReminderPush } from "../api";
import { haptic } from "../haptics";
import { isStandalone, urlBase64ToUint8Array } from "../push";
import { useSwipeDismissRight } from "../sheetGestures";

// Адрес, на который шлёт шорткат Команд. Здесь же, а не только в голове:
// собирая автоматизацию заново, его приходится вводить руками.
const DRAFTS_ENDPOINT = `${API_BASE}/api/expense-drafts`;

export default function AutomationSheet({ onClose }) {
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);
  const dismissPage = useSwipeDismissRight(pageRef, onClose);

  // Ключ грузится сразу с экраном, а не по тапу: iOS отзывает доступ к
  // буферу обмена, если между жестом и записью успел завершиться await.
  const [shortcutKey, setShortcutKey] = useState(null);
  const [keyState, setKeyState] = useState(null);
  // Буфер недоступен (старая iOS, отказ в разрешении) — показываем ключ
  // строкой ниже, длинным нажатием копируется вручную.
  const [keyShown, setKeyShown] = useState(false);
  const [offlineDraftsState, setOfflineDraftsState] = useState("Проверка…");

  async function ensureDraftPush(askPermission = false) {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setOfflineDraftsState("Не поддерживается");
      return;
    }
    if (!isStandalone()) {
      setOfflineDraftsState("Добавьте на экран Домой");
      return;
    }
    let permission = Notification.permission;
    if (permission === "default" && askPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setOfflineDraftsState(permission === "denied" ? "Запрещено в iOS" : "Включить");
      return;
    }

    setOfflineDraftsState("Подключение…");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      });
    }
    await subscribeReminderPush(subscription.toJSON());
    setOfflineDraftsState("Включено");
  }

  useEffect(() => {
    fetchShortcutKey()
      .then(setShortcutKey)
      .catch(() => {
        // офлайн — тап по строке скажет об этом словами
      });
  }, []);

  useEffect(() => {
    ensureDraftPush(false).catch(() => setOfflineDraftsState("Включить"));
  }, []);

  function handleClose() {
    dismissPage();
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

  function enableOfflineDrafts() {
    haptic();
    ensureDraftPush(true).catch(() => setOfflineDraftsState("Не удалось включить"));
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
        <button className="settings-row" onClick={enableOfflineDrafts}>
          <span className="settings-row-label">Черновики офлайн</span>
          <span className="settings-row-value">{offlineDraftsState}</span>
        </button>
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
        Шорткат присылает сумму сюда. При включённых офлайн-черновиках установленное приложение получает и
        сохраняет её сразу, даже когда закрыто. Позже можно открыть его без сети, выбрать счёт и категорию.
      </p>
    </div>
  );
}
