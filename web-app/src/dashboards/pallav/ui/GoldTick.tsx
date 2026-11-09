// The success mark of the redesign (MJ: no green tick): a gold ring and check drawn once, then still. Decorative; the words beside it carry the meaning.
export function GoldTick({ size = 72 }: { size?: number }) {
  return (
    <svg className="gold-tick" width={size} height={size} viewBox="0 0 92 92" aria-hidden="true" focusable="false">
      <circle className="gt-ring" cx="46" cy="46" r="42" />
      <path className="gt-check" d="M30 47.5 41 58.5 63 35" />
    </svg>
  );
}
