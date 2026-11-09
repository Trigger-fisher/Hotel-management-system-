import { siteCopy as c } from "@shared/site/copy";
import { pricingPage as p } from "@shared/site/pages";
import { CtaBand, PageIntro, Tick } from "@/components/site/parts";
import { SiteShell, sitePageMetadata } from "@/components/site/SiteShell";

// The website's Pricing page: the two plans and what each includes. No prices are published: each hotel gets a quote (MJ sets them).
export const metadata = sitePageMetadata(p.meta);

export default function PricingPage() {
  return (
    <SiteShell current={p.meta.path}>
      <PageIntro eyebrow={p.eyebrow} title={p.title} lead={p.lead} />
      <section className="hp-section hp-section-sm hp-tint">
        <div className="hp-wrap">
          <div className="hp-plans">
            {p.plans.map((plan) => (
              <article key={plan.id} className={`hp-plan${"featured" in plan && plan.featured ? " hp-plan-featured" : ""}`}>
                <p className="hp-plan-for">{plan.for}</p>
                <h2>{plan.name}</h2>
                <p className="hp-plan-price">{p.quote}</p>
                <p>{plan.body}</p>
                <a className="hp-btn hp-btn-solid hp-btn-lg" href={c.demoPath}>{plan.cta}</a>
              </article>
            ))}
          </div>

          <h2 className="hp-h2 hp-compare-h">{p.compareTitle}</h2>
          <div className="hp-compare" role="region" aria-label={p.compareTitle} tabIndex={0}>
            <table>
              <thead>
                <tr><th scope="col">Feature</th>{p.plans.map((plan) => <th key={plan.id} scope="col">{plan.name}</th>)}</tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{r.hotel ? <><Tick small /><span className="hp-sr">Included</span></> : <span className="hp-dash" aria-label="Not included">—</span>}</td>
                    <td>{r.group ? <><Tick small /><span className="hp-sr">Included</span></> : <span className="hp-dash" aria-label="Not included">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hp-included">
            <h3>{p.included.title}</h3>
            <ul className="hp-points">
              {p.included.items.map((it) => <li key={it}><Tick small />{it}</li>)}
            </ul>
          </div>
        </div>
      </section>
      <CtaBand />
    </SiteShell>
  );
}
