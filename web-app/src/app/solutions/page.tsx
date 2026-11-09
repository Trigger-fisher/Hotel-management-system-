import { solutionsPage as p } from "@shared/site/pages";
import { CtaBand, PageIntro, Tick } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's Solutions page: independent hotels, hotel groups and the teams who run them.
export const metadata = sitePageMetadata(p.meta);

export default function SolutionsPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      {p.items.map((s, i) => (
        <section key={s.id} id={s.id} className={`hp-section hp-section-sm${i % 2 ? "" : " hp-tint"}`}>
          <div className="hp-wrap hp-split">
            <div>
              <h2 className="hp-h2">{s.title}</h2>
              <p className="hp-lead">{s.body}</p>
            </div>
            <ul className="hp-checks">
              {s.points.map((pt) => (
                <li key={pt}><Tick /><div><b>{pt}</b></div></li>
              ))}
            </ul>
          </div>
        </section>
      ))}
      <CtaBand />
    </SiteShell>
  );
}
