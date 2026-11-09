import { siteCopy as c } from "@shared/site/copy";
import { CtaBand, CtaRow, HeroPreview, Icon, PANELS, Tick } from "./parts";
import { SiteShell } from "./SiteShell";

// The public EasyHotelSolutions website's home page (MJ, 25 Oct 2026; the product page, 2 Nov 2026): what the product does, a short tour, the main features, how data is kept
// apart, how it starts and the common questions, then Book a demo. Shown only to a signed-out visitor (app/page.tsx). The other pages: app/features, solutions, ...

// What search engines read: the company, the product, and the questions on the page (the same text as the FAQ, so the two never differ). Static text, no user data.
const structured = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: c.brand.name, url: c.url, email: c.contactEmail },
    { "@type": "SoftwareApplication", name: c.brand.name, applicationCategory: "BusinessApplication", operatingSystem: "Web", description: c.description, url: c.url },
    { "@type": "FAQPage", mainEntity: c.faq.items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ],
}).replace(/</g, "\\u003c");

export function SiteHome() {
  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />
      <section className="hp-hero">
        <div className="hp-wrap hp-hero-grid">
          <div className="hp-hero-copy">
            <p className="hp-eyebrow">{c.hero.eyebrow}</p>
            <h1 className="hp-h1">{c.hero.title}</h1>
            <p className="hp-lead">{c.hero.body}</p>
            <CtaRow second={{ href: "/features", label: c.hero.secondary }} />
            <p className="hp-note">{c.hero.note}</p>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section className="hp-proof" aria-label="At a glance">
        <div className="hp-wrap hp-proof-grid">
          {c.proof.map((p) => (
            <div key={p.value}>
              <b>{p.value}</b>
              <span>{p.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="hp-section" id="tour">
        <div className="hp-wrap">
          <p className="hp-eyebrow">{c.tour.eyebrow}</p>
          <h2 className="hp-h2">{c.tour.title}</h2>
          <div className="hp-tour">
            {c.tour.items.map((t, i) => {
              const Panel = PANELS[t.id];
              return (
                <div key={t.id} className={`hp-tour-row${i % 2 ? " hp-flip" : ""}`}>
                  <div className="hp-tour-copy">
                    <h3>{t.title}</h3>
                    <p>{t.body}</p>
                    <ul className="hp-points">
                      {t.points.map((p) => (
                        <li key={p}><Tick small />{p}</li>
                      ))}
                    </ul>
                  </div>
                  {Panel ? <Panel /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="hp-section hp-tint" id="features">
        <div className="hp-wrap">
          <p className="hp-eyebrow">{c.highlights.eyebrow}</p>
          <h2 className="hp-h2">{c.highlights.title}</h2>
          <div className="hp-cards">
            {c.highlights.items.map((f) => (
              <article key={f.title} className="hp-card">
                <span className="hp-chip"><Icon name={f.icon} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
          <p className="hp-more"><a href="/features">{c.highlights.more} →</a></p>
        </div>
      </section>

      <section className="hp-section" id="security">
        <div className="hp-wrap hp-split">
          <div>
            <p className="hp-eyebrow">{c.security.eyebrow}</p>
            <h2 className="hp-h2">{c.security.title}</h2>
            <p className="hp-lead">{c.security.body}</p>
          </div>
          <ul className="hp-checks">
            {c.security.items.map((s) => (
              <li key={s.title}>
                <Tick />
                <div>
                  <b>{s.title}</b>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hp-section hp-tint">
        <div className="hp-wrap">
          <p className="hp-eyebrow">{c.steps.eyebrow}</p>
          <h2 className="hp-h2">{c.steps.title}</h2>
          <ol className="hp-steps">
            {c.steps.items.map((s, i) => (
              <li key={s.title}>
                <span className="hp-step-no">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="hp-section" id="faq">
        <div className="hp-wrap hp-faq-wrap">
          <div>
            <p className="hp-eyebrow">{c.faq.eyebrow}</p>
            <h2 className="hp-h2">{c.faq.title}</h2>
          </div>
          <div className="hp-faq">
            {c.faq.items.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </SiteShell>
  );
}
