export default function ExpenseList({ expenses, onDelete }) {
  return (
    <div>
      <p className="section-title">Последние траты</p>
      <div className="expense-list">
        {expenses.length === 0 && (
          <p style={{ color: "var(--stone)", fontSize: 14 }}>
            Пока пусто — скажи что-нибудь вроде «500 на такси».
          </p>
        )}
        {expenses.map((e) => (
          <div className="expense-row" key={e.id} onClick={() => onDelete?.(e.id)}>
            <div className="meta">
              <span className="category">{e.category}</span>
              <span className="sub">
                {e.wallet} ·{" "}
                {new Date(e.created_at).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <span className="amount">−{Number(e.amount).toLocaleString("ru-RU")} ₸</span>
          </div>
        ))}
      </div>
    </div>
  );
}
