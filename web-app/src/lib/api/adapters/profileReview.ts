// Super Admin "Possible duplicates" (platform migration 0132) against the real server: /api/v1/platform/profiles (ui-shared/dashboards/profileReview.ts).
import type { DuplicatePage, KeepApartInput, MergeInput, MergeResult, ProfileReviewApi } from '@shared/dashboards/profileReview';

import { get, post } from '../client';

const BASE = '/platform/profiles';

export function createHttpProfileReviewApi(): ProfileReviewApi {
  return {
    duplicates: (q) => get<DuplicatePage>(`${BASE}/duplicates`, { kind: q.kind, search: q.search, page: q.page, pageSize: q.pageSize }),
    merge: (input: MergeInput) => post<MergeResult>(`${BASE}/merge`, input),
    keepApart: (input: KeepApartInput) => post<{ kept: boolean }>(`${BASE}/keep-apart`, input),
    undoKeepApart: (input: KeepApartInput) => post<{ undone: boolean }>(`${BASE}/keep-apart/undo`, input),
  };
}
