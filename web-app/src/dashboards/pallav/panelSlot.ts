'use client';

// A place in the second panel's head (below its title row) that a screen can fill, for the payroll company-switcher card:
//   const slot = usePanelHeadSlot();  ...  slot && createPortal(<CompanySwitch />, slot)
import { useEffect, useSyncExternalStore } from 'react';

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Set by the shell (a callback ref on the empty div in `.subnav-head`). */
export function setPanelHeadSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  listeners.forEach((l) => l());
}

export function usePanelHeadSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => slot,
    () => null,
  );
}

// ---- The third panel (Pallav's Payroll Master lists): `usePanel2` asks the shell for it and returns the place to portal into. ----
//   const panel = useMemo(() => ({ title: 'Payroll Master', icon: 'sliders' }), []);
//   const slot = usePanel2(panel);  ...  slot && createPortal(<nav className="subnav-body">..</nav>, slot)
// While it is open next to the open Payroll menu, the main rail folds to its icons (Pallav never shows three panels at once).
export interface Panel2 {
  title: string;
  icon: string;
}

let panel2: Panel2 | null = null;
let slot2: HTMLElement | null = null;
const listeners2 = new Set<() => void>();
const emit2 = () => listeners2.forEach((l) => l());
const subscribe2 = (cb: () => void) => {
  listeners2.add(cb);
  return () => listeners2.delete(cb);
};

/** Set by the shell: the empty div inside the third panel. */
export function setPanel2Slot(el: HTMLElement | null): void {
  if (slot2 === el) return;
  slot2 = el;
  emit2();
}

/** Read by the shell: is a screen asking for the third panel, and what is it called. */
export function usePanel2Request(): Panel2 | null {
  return useSyncExternalStore(subscribe2, () => panel2, () => null);
}

/** For a screen: shows the third panel while mounted. Pass a stable object (useMemo). Returns where to put its list. */
export function usePanel2(spec: Panel2 | null): HTMLElement | null {
  useEffect(() => {
    panel2 = spec;
    emit2();
    return () => {
      if (panel2 === spec) {
        panel2 = null;
        emit2();
      }
    };
  }, [spec]);
  return useSyncExternalStore(subscribe2, () => slot2, () => null);
}
