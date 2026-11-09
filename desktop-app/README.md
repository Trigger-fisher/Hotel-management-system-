# desktop-app

The Easy Hotel Solutions desktop app: a Tauri 2 window around the web app's real screens.

The screens are not copied. `vite.config.ts` imports them from `web-app/src` and `common/ui-shared` and serves `web-app/public` as they are, so a change to the web app reaches the desktop on the next build. The Next.js server is not part of it: `src/shims` stands in for the two Next.js imports the screens use, and `src/main.tsx` does the job of the web app's root layout and sign-in page.

For now it runs on the web app's mock data (`Quick login` on the sign-in screen). Token sign-in and the cloud API are step 2.

## What is here

| Path | What it is |
|---|---|
| `src/TitleBar.tsx` | The frameless window's title bar |
| `src/desktop.css` | Makes room for the title bar; nothing else about the screens changes |
| `src-tauri/` | The native side: window, permissions, icons, and later printers, scanners and the offline store |

## Run it

`web-app` needs its packages installed first (`npm install` there).

    npm install
    npm run app:dev      # the desktop window, with live reload
    npm run app:build    # an installer for this operating system

On Linux the Tauri build needs these system packages:

    sudo apt update
    sudo apt install -y pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev

## Windows installer

Windows installers cannot be built on Linux. Push this folder and run **Desktop app (Windows)** from the repository's Actions tab; the `.exe` is attached to the run.
