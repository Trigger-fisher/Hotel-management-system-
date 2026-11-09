// The frameless window's title bar: the logo, the connection state and the window buttons. Dragging and double-click maximise come from data-tauri-drag-region.
import { useEffect, useState } from 'react';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function appWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function TitleBar() {
  const online = useBrowserOnline();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return undefined;
    let stop: (() => void) | undefined;
    let live = true;
    void appWindow().then(async (w) => {
      const read = async () => live && setMaximized(await w.isMaximized());
      await read();
      const unlisten = await w.onResized(read);
      if (live) stop = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  const call = (action: 'minimize' | 'toggleMaximize' | 'close') => () => {
    if (inTauri) void appWindow().then((w) => w[action]());
  };

  return (
    <header className="desk-bar" data-tauri-drag-region>
      <img className="desk-bar-mark" src="/brand/mark-night.svg" alt="" />
      <span className="desk-bar-name">Easy Hotel Solutions</span>
      <div className="desk-bar-drag" data-tauri-drag-region />
      <span className="desk-bar-conn" role="status">
        <span className={`desk-bar-dot${online ? '' : ' off'}`} />
        {online ? 'Online' : 'Offline'}
      </span>
      <button type="button" className="desk-win" aria-label="Minimise" onClick={call('minimize')}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg>
      </button>
      <button type="button" className="desk-win" aria-label={maximized ? 'Restore' : 'Maximise'} onClick={call('toggleMaximize')}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {maximized ? <path d="M3.5 3.5V1.5h7v7h-2M1.5 3.5h7v7h-7z" /> : <path d="M1.5 1.5h9v9h-9z" />}
        </svg>
      </button>
      <button type="button" className="desk-win close" aria-label="Close" onClick={call('close')}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>
      </button>
    </header>
  );
}
