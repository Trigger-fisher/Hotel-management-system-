// The Pager reads one shape (TableView); for a list the server pages, only the paging fields matter.
import type { TableView } from './PmsTable';

export function pagerView<T>(page: { items: T[]; page: number; pageSize: number; total: number }, paging: { setPage: (n: number) => void }): TableView<T> {
  const { items, page: n, pageSize, total } = page;
  return {
    rows: items, offset: (n - 1) * pageSize, total, search: '', setSearch: () => {}, sort: null, toggleSort: () => {},
    page: n, pages: Math.max(1, Math.ceil(total / pageSize)), perPage: pageSize, setPage: paging.setPage, setPerPage: () => {},
  };
}
