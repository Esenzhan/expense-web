import { useEffect, useRef, useState } from "react";
import { fetchReminderSettings, saveReminderSettings, subscribeReminderPush } from "../api";
import { haptic } from "../haptics";
import { isStandalone, urlBase64ToUint8Array } from "../push";
import { useSwipeDismissRight } from "../sheetGestures";

export const REMINDERS_ENABLED_KEY = "traty-reminders-enabled";

const DAYS = [
  { n: 1, label: "Пн" },
  { n: 2, label: "Вт" },
  { n: 3, label: "Ср" },
  { n: 4, label: "Чт" },
  { n: 5, label: "Пт" },
  { n: 6, label: "Сб" },
  { n: 7, label: "Вс" },
];

const DEFAULT_SETTINGS = {
  enabled: false,
  days: [1, 2, 3, 4, 5, 6, 7],
  time: "22:00",
  text: "Пора внести расходы и доходы.",
};

export default function RemindersSheet({ onClose }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);
  const latestRef = useRef(DEFAULT_SETTINGS);
  const textTimer = useRef(null);

  useSwipeDismissRight(pageRef, onClose);

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

  useEffect(() => {
    fetchReminderSettings()
      .then((data) => {
        const next = { enabled: data.enabled, days: data.days, time: data.time, text: data.text };
        latestRef.current = next;
        setSettings(next);
        localStorage.setItem(REMINDERS_ENABLED_KEY, JSON.stringify(next.enabled));
      })
      .catch(() => setError("Не удалось загрузить настройки"))
      .finally(() => setLoading(false));
  }, []);

  function applyLocal(next) {
    latestRef.current = next;
    setSettings(next);
    return next;
  }

  async function persist(next) {
    try {
      await saveReminderSettings(next);
      localStorage.setItem(REMINDERS_ENABLED_KEY, JSON.stringify(next.enabled));
    } catch (err) {
      setError(err.message);
    }
  }

  async function subscribeToPush() {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
      });
    }
    await subscribeReminderPush(sub.toJSON());
  }

  async function handleToggle() {
    haptic();
    setError(null);

    if (settings.enabled) {
      persist(applyLocal({ ...settings, enabled: false }));
      return;
    }

    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("Уведомления не поддерживаются в этом браузере.");
      return;
    }
    if (!isStandalone()) {
      setError("Сначала добавьте приложение на экран «Домой» — уведомления работают только в установленном приложении.");
      return;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Уведомления запрещены — разрешите их в настройках телефона.");
        return;
      }
      await subscribeToPush();
      await persist(applyLocal({ ...settings, enabled: true }));
    } catch {
      setError("Не удалось включить уведомления.");
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day) {
    haptic();
    const days = settings.days.includes(day)
      ? settings.days.filter((d) => d !== day)
      : [...settings.days, day].sort((a, b) => a - b);
    persist(applyLocal({ ...settings, days }));
  }

  function onTimeChange(event) {
    persist(applyLocal({ ...settings, time: event.target.value }));
  }

  function onTextChange(event) {
    const text = event.target.value;
    applyLocal({ ...settings, text });
    clearTimeout(textTimer.current);
    textTimer.current = setTimeout(() => persist(latestRef.current), 500);
  }

  return (
    <div ref={pageRef} className="settings-page reminders-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Напоминания</span>
        <span className="icon-button-spacer" />
      </div>

      {!loading && (
        <>
          <div className="settings-group">
            <button className="settings-row reminder-toggle-row" onClick={handleToggle} disabled={busy}>
              <span className="settings-row-label">Ежедневные напоминания</span>
              <span className={`switch ${settings.enabled ? "on" : ""}`}>
                <span className="switch-knob" />
              </span>
            </button>
          </div>

          {error && <p className="reminder-hint reminder-hint-error">{error}</p>}

          <div className="reminder-days">
            {DAYS.map(({ n, label }) => (
              <button
                key={n}
                className={`reminder-day-chip ${settings.days.includes(n) ? "on" : ""}`}
                onClick={() => toggleDay(n)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="settings-group">
            <div className="settings-row reminder-time-row">
              <span className="settings-row-label">Время</span>
              <span className="settings-row-value">{settings.time}</span>
              <input
                type="time"
                className="reminder-time-input"
                value={settings.time}
                onChange={onTimeChange}
                aria-label="Время напоминания"
              />
            </div>
          </div>

          <p className="settings-section">Текст</p>
          <textarea
            className="reminder-text"
            value={settings.text}
            onChange={onTextChange}
            placeholder="Пора внести расходы и доходы."
            maxLength={200}
          />
        </>
      )}
    </div>
  );
}
