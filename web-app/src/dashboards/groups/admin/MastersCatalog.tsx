'use client';

// The expense catalogue of one business (Pallav: masters/_catalog.blade.php): categories with the priced items under each.
import { useMemo, useState, type FormEvent } from 'react';
import { adminCopy, masterScopeLabel, type CatalogCategory, type CatalogItem, type ExpenseCatalog, type MasterList, type MasterScope } from '@shared/dashboards/admin';
import { formatINR } from '@shared/dashboards/format';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { AmountTile, Bi, Button, Dialog, EmptyState, IconButton, Modal, Table } from '@/dashboards/pallav/ui';
import { adminApi } from './api';
import { Sections, matchesWords } from './masterParts';

const t = adminCopy.masters.catalog;

export function MastersCatalog({ list, scope, words, onPick }: { list: MasterList; scope: MasterScope; words: string[]; onPick: (setKey: string) => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { state } = useAsync(() => adminApi.getExpenseCatalog(list.set.key, scope), [list.set.key, scope, version]);
  const [category, setCategory] = useState<{ cat: CatalogCategory | null } | null>(null);
  const [item, setItem] = useState<{ cat: CatalogCategory; item: CatalogItem | null } | null>(null);
  const [removeCat, setRemoveCat] = useState<CatalogCategory | null>(null);
  const [removeItem, setRemoveItem] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const both = list.scope === 'both';
  const catalog: ExpenseCatalog | null = state.status === 'ready' ? state.data : null;
  const refresh = () => setVersion((v) => v + 1);

  // A category shows whole when its own name matches, else only the items that match (master-search.js)
  const view = useMemo(() => {
    if (!catalog) return [];
    if (words.length === 0) return catalog.categories;
    return catalog.categories.flatMap((c) => {
      if (matchesWords(c.name, words)) return [c];
      const items = c.items.filter((i) => matchesWords(`${i.name} ${(i.pricePaise / 100).toFixed(2)}`, words));
      return items.length ? [{ ...c, items }] : [];
    });
  }, [catalog, words]);

  async function remove(call: () => Promise<{ ok: true; data: { message: string } } | { ok: false; error: Parameters<typeof errorText>[0] }>) {
    setBusy(true);
    const res = await call();
    setBusy(false);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); refresh(); } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const noMatch = words.length > 0 && catalog !== null && view.length === 0;
  const noForm = (e: FormEvent) => e.preventDefault();

  return (
    <>
      {/* Shown above the catalogue when the search box matches nothing (master-search.js hides the categories, the card stays) */}
      {noMatch ? <div className="card"><EmptyState icon="search" title={adminCopy.masters.noMatch.title(words.join(' '))} text={adminCopy.masters.noMatch.text} /></div> : null}

      <div className="card reveal">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span><Bi name={(list.set.icon ?? 'bi-basket').replace(/^bi-/, '')} className="me-1" /> {list.placement?.sectionLabel ?? list.set.name}</span>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <Sections list={list} onPick={onPick} />
            <Button size="sm" icon="plus-lg" onClick={() => setCategory({ cat: null })}>{t.addCategory}</Button>
          </div>
        </div>

        <div className="mc-list">
          {catalog && catalog.categories.length === 0 ? (
            <div className="empty-state">
              <div className="es-icon"><Bi name="basket" /></div>
              <div className="es-title">{t.noneTitle}</div>
              <div className="es-text">{t.noneText}</div>
            </div>
          ) : null}
          {view.map((c) => (
            <section key={c.id} className="mc-cat">
              <header className="mc-cat-head">
                <div className="mc-cat-title">
                  <Bi name="folder2-open" />
                  <strong>{c.name}</strong>
                  <span className="mc-count">{t.items(c.items.length)}</span>
                  {!both && c.shared ? <span className="pill pill-locked" title={t.bothCategory}><Bi name="diagram-2" /> {adminCopy.masters.pills.both}</span> : null}
                </div>
                <div className="mc-cat-actions">
                  <Button variant="outline" size="sm" icon="plus-lg" onClick={() => setItem({ cat: c, item: null })}>{t.addItem}</Button>
                  <IconButton icon="pencil-square" label={t.renameTip(c.name)} title={t.renameCategory} onClick={() => setCategory({ cat: c })} />
                  <form className="d-inline" onSubmit={noForm}>
                    <IconButton icon="trash" tone="danger" label={t.removeAria(c.name)} title={t.removeCategoryTip} onClick={() => setRemoveCat(c)} />
                  </form>
                </div>
              </header>

              {c.items.length === 0 ? (
                <div className="mc-empty"><Bi name="info-circle" /> {both ? t.emptyBoth : t.emptyOne}</div>
              ) : (
                <Table className="table table-hover align-middle mb-0 mc-items">
                  <thead><tr><th>{t.itemCol}</th><th className="text-end">{t.priceCol}</th><th className="text-end">{adminCopy.masters.cols.action}</th></tr></thead>
                  <tbody>
                    {c.items.map((i) => (
                      <tr key={i.id}>
                        <td className="fw-semibold">
                          {i.name}
                          {!both && i.shared ? <span className="pill pill-locked" title={t.bothItem}><Bi name="diagram-2" /> {adminCopy.masters.pills.both}</span> : null}
                        </td>
                        <td className="text-end mc-price">{formatINR(i.pricePaise)}</td>
                        <td className="text-end text-nowrap">
                          <IconButton icon="pencil-square" label={t.editAria(i.name)} title={t.editItem} onClick={() => setItem({ cat: c, item: i })} />
                          <form className="d-inline" onSubmit={noForm}>
                            <IconButton icon="trash" tone="danger" label={t.removeAria(i.name)} title={t.removeItemTip} onClick={() => setRemoveItem(i)} />
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
          ))}
        </div>
      </div>

      {category ? <CategoryForm setKey={list.set.key} scope={scope} cat={category.cat} onClose={() => setCategory(null)} onSaved={(m) => { toast.show({ tone: 'success', text: m }); setCategory(null); refresh(); }} /> : null}
      {item ? <ItemForm scope={scope} cat={item.cat} item={item.item} onClose={() => setItem(null)} onSaved={(m) => { toast.show({ tone: 'success', text: m }); setItem(null); refresh(); }} /> : null}

      <Dialog open={removeCat !== null} tone="danger" title={adminCopy.masters.remove.title(removeCat?.name ?? '')} message={both ? t.removeCategoryBoth : t.removeCategoryOne} confirmLabel={adminCopy.masters.remove.label} busy={busy}
        onCancel={() => setRemoveCat(null)} onConfirm={() => { const c = removeCat; setRemoveCat(null); if (c) void remove(() => adminApi.deleteCatalogCategory(c.id, scope)); }} />
      <Dialog open={removeItem !== null} tone="danger" title={adminCopy.masters.remove.title(removeItem?.name ?? '')} message={both ? t.removeItemBoth : t.removeItemOne} confirmLabel={adminCopy.masters.remove.label} busy={busy}
        onCancel={() => setRemoveItem(null)} onConfirm={() => { const i = removeItem; setRemoveItem(null); if (i) void remove(() => adminApi.deleteCatalogItem(i.id, scope)); }} />
    </>
  );
}

/** Add or rename a category: a name is all it has. */
function CategoryForm({ setKey, scope, cat, onClose, onSaved }: { setKey: string; scope: MasterScope; cat: CatalogCategory | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(cat?.name ?? '');
  const { busy, errors, submit } = useSubmit(['name']);
  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={adminCopy.masters.scope.eyebrow(masterScopeLabel[scope])}
      title={cat ? t.renameCategory : t.addCategory}
      onSubmit={() => void submit(() => adminApi.saveCatalogCategory(setKey, scope, cat?.id ?? null, name), (d) => onSaved(d.message))}
      footer={<Button type="submit" disabled={busy}>{cat ? adminCopy.masters.saveChanges : t.addCategoryBtn}</Button>}
    >
      <label className="form-label" htmlFor="cat_name">{t.categoryName}<span className="req">*</span></label>
      <input id="cat_name" className="form-control" maxLength={80} autoComplete="off" placeholder={t.categoryPlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
      {errors.name ? <div className="field-error">{errors.name}</div> : null}
    </Modal>
  );
}

/** Add or edit an item: a name and its price. */
function ItemForm({ scope, cat, item, onClose, onSaved }: { scope: MasterScope; cat: CatalogCategory; item: CatalogItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.pricePaise ?? 0);
  const { busy, errors, submit } = useSubmit(['name', 'price']);
  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={cat.name}
      title={item ? t.editItem : t.addItem}
      onSubmit={() => void submit(() => adminApi.saveCatalogItem(cat.id, scope, item?.id ?? null, { name, pricePaise: price }), (d) => onSaved(d.message))}
      footer={<Button type="submit" disabled={busy}>{item ? adminCopy.masters.saveChanges : t.addItemBtn}</Button>}
    >
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label" htmlFor="item_name">{t.itemName}<span className="req">*</span></label>
          <input id="item_name" className="form-control" maxLength={80} autoComplete="off" placeholder={t.itemPlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          {errors.name ? <div className="field-error">{errors.name}</div> : null}
        </div>
        <AmountTile col="col-12" label={t.priceLabel} paise={price} onChange={setPrice} hint={t.priceHint} error={errors.price} />
      </div>
    </Modal>
  );
}
