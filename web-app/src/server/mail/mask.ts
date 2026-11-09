import "server-only";
// An email address shortened for a log line or a screen that must not show it whole: "a***@example.com".
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}