import { useEffect, useState } from "react";
import { fetchInsights } from "../api";

export default function InsightsSheet({ period, onClose }) {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInsights(period)
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setText(data.text);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-card" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-title">✦ Инсайты</div>
        {loading && <div className="sheet-spinner" />}
        {!loading && error && <p className="sheet-error">{error}</p>}
        {!loading && !error && <p className="sheet-text">{text}</p>}
        <button className="sheet-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
