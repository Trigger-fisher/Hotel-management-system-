import { featuresPage as p } from "@shared/site/pages";
import { CtaBand, Icon, PageIntro } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's Features page: every part of the product, grouped as the hotel's menu is.
export const metadata = sitePageMetadata(p.meta);

export default function FeaturesPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead}>
        <nav className="hp-jump" aria-label="Feature groups">
          {p.groups.map((g) => <a key={g.id} href={`#${g.id}`}>{g.title}</a>)}
        </nav>
      </PageIntro>
      {p.groups.map((g, i) => (
        <section key={g.id} id={g.id} className={`hp-section hp-section-sm${i % 2 ? "" : " hp-tint"}`}>
          <div className="hp-wrap hp-fgroup">
            <div className="hp-fgroup-head">
              <span className="hp-chip"><Icon name={g.icon} /></span>
              <h2>{g.title}</h2>
              <p>{g.body}</p>
            </div>
            <div className="hp-fgroup-list">
              {g.items.map((f) => (
                <article key={f.title}>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}
      <CtaBand />
    </SiteShell>
  );
}
