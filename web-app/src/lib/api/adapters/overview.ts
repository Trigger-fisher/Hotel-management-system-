// Overview over the real server: the Hotel dashboard, the daily report, the food-plan report (docs/api/admin.md "Reports and dashboard")
// and the accounting-year books (docs/api/admin.md "Accounting years").
import type { AccountingYear, BooksOverview, OverviewApi } from '@shared/dashboards/overview';

import * as api from '../client';

export function createOverviewRealApi(): OverviewApi {
  return {
    getDashboard: () => api.get('/overview/dashboard'),
    getAttention: () => api.get('/overview/attention'),
    getAnnouncements: () => api.get('/overview/announcements'),
    dismissAnnouncement: (id) => api.post(`/overview/announcements/${encodeURIComponent(id)}/dismiss`, {}),
    getDailyReport: (date) => api.get('/reports/daily', { date }),
    getFoodPlan: (month, plan) => api.get('/reports/food-plan', { month, plan }),
    getOccupancy: (month) => api.get('/reports/occupancy', { month }),
    getGst: (month) => api.get('/reports/gst', { month }),

    getBooks: () => api.get<BooksOverview>('/admin/books'),
    startNextYear: () => api.post<{ year: AccountingYear; message: string }>('/admin/books/start', {}),
    removeLatestYear: (confirm) => api.del<{ removed: Record<string, number>; message: string }>('/admin/books/latest', { confirm }),
  };
}
