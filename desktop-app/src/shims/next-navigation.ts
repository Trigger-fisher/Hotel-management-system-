// Stands in for next/navigation in the desktop build. The screens only ask for the current address.
export function usePathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}
