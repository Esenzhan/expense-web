import { GOOGLE_LOGIN_URL } from "../api";

const ERROR_MESSAGES = {
  not_allowed: "Этот Google-аккаунт не подключён к приложению.",
  no_code: "Вход не завершён, попробуйте ещё раз.",
  server_error: "Что-то пошло не так на сервере, попробуйте ещё раз.",
};

export default function LoginScreen({ error }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-title">Траты</div>
        <div className="login-subtitle">Войдите, чтобы вести учёт расходов</div>
        {error && (
          <div className="login-error">{ERROR_MESSAGES[error] || "Не удалось войти."}</div>
        )}
        <a className="login-google-btn" href={GOOGLE_LOGIN_URL}>
          Войти через Google
        </a>
      </div>
    </div>
  );
}
