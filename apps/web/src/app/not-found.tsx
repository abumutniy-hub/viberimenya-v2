import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-page">
      <section className="system-card">
        <span>Ошибка 404</span>
        <h1>Страница не найдена</h1>
        <p>Ссылка могла устареть. Вернитесь на главную или откройте каталог.</p>
        <div>
          <Link href="/">На главную</Link>
          <Link href="/catalog">В каталог</Link>
        </div>
      </section>
    </main>
  );
}
