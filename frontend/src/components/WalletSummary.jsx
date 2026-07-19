export default function WalletSummary({ totals }) {
  return (
    <div>
      <p className="section-title">Кошельки в этом месяце</p>
      <div className="wallet-grid">
        {totals.map((w) => (
          <div className="wallet-card" key={w.wallet}>
            <div className="name">{w.wallet}</div>
            <div className="amount">{Number(w.total).toLocaleString("ru-RU")} ₸</div>
          </div>
        ))}
      </div>
    </div>
  );
}
