// Friendly text for a failed dashboard call (never the raw error), shared by every screen.
import { dashErrorText, serverSentence, type DashError } from '@shared/dashboards/common';

export function errorText(error: DashError): string {
  if (error.code === 'VALIDATION_FAILED') {
    const first = error.details?.fields ? Object.values(error.details.fields)[0] : undefined;
    return first ?? serverSentence(error) ?? dashErrorText.VALIDATION_FAILED;
  }
  // A part the real server has no route for yet (adapters/notYet.ts): say so plainly, never the code or a generic "not found".
  if (error.code === 'NOT_FOUND' && error.message.startsWith('No route yet')) return 'This part is not set up yet.';
  // Pallav's own sentence on a refusal (month not over, only Admin users can ...), else the friendly text for the code.
  if (error.code === 'CONFLICT' || error.code === 'FORBIDDEN') return serverSentence(error) ?? dashErrorText[error.code];
  return dashErrorText[error.code];
}

/** Field errors from a VALIDATION_FAILED result, else empty. */
export function fieldErrors(error: DashError): Record<string, string> {
  return error.code === 'VALIDATION_FAILED' ? (error.details?.fields ?? {}) : {};
}
