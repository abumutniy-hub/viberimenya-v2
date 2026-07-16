import Link from "next/link";

export type LegalSection = {
  title: string;
  paragraphs: string[];
};

export function LegalDocument({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="legal-page">
      <nav className="legal-breadcrumbs" aria-label="Навигация">
        <Link href="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>{title}</span>
      </nav>

      <article className="legal-card">
        <span className="legal-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>

        <div className="legal-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
