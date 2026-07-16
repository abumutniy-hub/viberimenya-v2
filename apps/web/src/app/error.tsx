"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="system-page">
      <section className="system-card">
        <span>Временная ошибка</span>
        <h1>Не удалось загрузить страницу</h1>
        <p>Попробуйте повторить запрос. Если ошибка сохранится, свяжитесь с магазином.</p>
        <div>
          <button type="button" onClick={reset}>Повторить</button>
          <a href="/">На главную</a>
        </div>
      </section>
    </main>
  );
}
