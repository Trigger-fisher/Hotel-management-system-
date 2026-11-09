import "server-only";

// The designs a hotel may pick for its own website: the folders of website-templates/templates (website-templates/docs/PLAN-CUSTOM-HOTEL-SITES.md). The key is the folder
// name, the same one the "Create hotel site" job copies into website-templates/sites/<hotel>. A new template is a new folder plus one line here; no migration.

export interface SiteTemplate {
  key: string;
  name: string;
  summary: string;
}

export const SITE_TEMPLATES: readonly SiteTemplate[] = [
  { key: "template-1", name: "Template Site One", summary: "Warm gold and deep brown, with an elegant serif heading." },
  { key: "template-2", name: "Template Site Two", summary: "Calm teal on soft white, with a classic display heading." },
  { key: "template-3", name: "Template Site Three", summary: "Terracotta and cream, with a bold, friendly serif heading." },
  { key: "template-4", name: "Template Site Four", summary: "Royal blue on pale lavender, with a refined heading." },
  { key: "template-5", name: "Template Site Five", summary: "Forest green on light mint, with a book-style heading." },
  { key: "template-6", name: "Template Site Six", summary: "Plum on soft pink, with a stately capital-letter heading." },
  { key: "template-7", name: "Template Site Seven", summary: "Deep red on blush, with a high-fashion heading." },
  { key: "template-8", name: "Template Site Eight", summary: "Sea green on pale aqua, with a clean modern heading." },
  { key: "template-9", name: "Template Site Nine", summary: "Bronze on warm sand, with a dramatic editorial heading." },
  { key: "template-10", name: "Template Site Ten", summary: "Slate grey on cool white, with a slim, quiet heading." },
];

export const templateOf = (key: string): SiteTemplate | undefined => SITE_TEMPLATES.find((t) => t.key === key);
