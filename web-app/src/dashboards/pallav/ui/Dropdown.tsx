'use client';

// Bootstrap's dropdown without its JavaScript: it closes on an outside press and on Escape.
//   <Dropdown button={(p) => <button className="btn btn-outline-p" {...p}>Menu</button>} align="end">items</Dropdown>
// Items use Pallav's markup: <a className="dropdown-item">.
// Phones: a menu of three or more items opens as a bottom sheet over a dimmed page (hms-overrides.css .dd-sheet), drawn under <body> so no card clips it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownToggleProps {
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
  onClick: () => void;
}

const PHONE = '(max-width: 768px)';
const SHEET_FROM = 3;

export function Dropdown({
  button,
  children,
  align = 'start',
  menuClassName = '',
  className = '',
  offset = 0,
  autoClose = true,
}: {
  button: (p: DropdownToggleProps) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  menuClassName?: string;
  className?: string;
  /** Pixels below the button (Pallav's data-bs-offset="0,18"). */
  offset?: number;
  /** false = data-bs-auto-close="outside": a click inside keeps it open. */
  autoClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState(false);
  // a menu that would run past the bottom of the screen (the chat composer, the last rows) opens upwards instead
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el && !el.contains(t) && !(menu && menu.contains(t))) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, el, menu]);
  // an open menu stays on screen: a menu aligned to its button's edge that would run past the screen's edge is moved back inside (8 px margin)
  const menuNode = useRef<HTMLDivElement | null>(null);
  const menuRef = useCallback((n: HTMLDivElement | null) => {
    menuNode.current = n;
    setMenu(n);
  }, []);
  useLayoutEffect(() => {
    const m = menuNode.current;
    if (!m) return;
    m.style.translate = '';
    if (!open) {
      if (up) setUp(false);
      return;
    }
    if (sheet) return;
    const r = m.getBoundingClientRect();
    if (!up && el && r.bottom > window.innerHeight - 8 && el.getBoundingClientRect().top - 8 >= r.height) {
      setUp(true);
      return;
    }
    const room = document.documentElement.clientWidth;
    let dx = 0;
    if (r.right > room - 8) dx = room - 8 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (dx) m.style.translate = `${Math.round(dx)}px 0`;
  }, [open, sheet, menu, up, el]);
  // decided as it opens: the items are already in the DOM (hidden), so they can be counted
  const toggle = () => {
    const next = !open;
    if (next) setSheet(window.matchMedia(PHONE).matches && (menu?.querySelectorAll('.dropdown-item').length ?? 0) >= SHEET_FROM);
    setOpen(next);
  };
  const asSheet = open && sheet;
  const list = (
    <div
      ref={menuRef}
      className={`dropdown-menu${align === 'end' ? ' dropdown-menu-end' : ''}${open ? ' show' : ''}${asSheet ? ' dd-sheet' : ''} ${menuClassName}`}
      style={asSheet ? undefined : { ...(up ? { bottom: '100%', top: 'auto' } : { top: '100%' }), ...(align === 'end' ? { right: 0, left: 'auto' } : { left: 0 }), transform: offset ? `translate3d(0, ${up ? -offset : offset}px, 0)` : undefined }}
      onClick={autoClose ? () => setOpen(false) : undefined}
    >
      {asSheet ? <div className="dd-grip" aria-hidden="true" /> : null}
      {children}
    </div>
  );
  return (
    <div className={`dropdown ${className}`} ref={setEl}>
      {button({ 'aria-expanded': open, 'aria-haspopup': 'menu', onClick: toggle })}
      {asSheet ? (
        createPortal(
          <>
            <div className="dd-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
            {list}
          </>,
          document.body,
        )
      ) : (
        list
      )}
    </div>
  );
}
