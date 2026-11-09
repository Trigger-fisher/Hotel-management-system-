// The desktop app's front end: the web app's real screens (web-app/src, common/ui-shared), bundled without the Next.js server.
// Nothing here is copied from the web app: the screens are imported from where they live, so a change there reaches the desktop on the next build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const webApp = path.resolve(here, '../web-app');
const shared = path.resolve(here, '../common/ui-shared');
const nextReact = path.join(webApp, 'node_modules/next/dist/compiled');

// HMS_DESKTOP_API=real talks to the cloud API once token sign-in exists (step 2). Until then the app runs on the web app's own mock data.
const api = process.env.HMS_DESKTOP_API === 'real' ? 'real' : 'mock';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The web app's public folder as it is: Pallav's stylesheets, icon font, logos.
  publicDir: path.join(webApp, 'public'),
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^next\/dynamic$/, replacement: path.join(here, 'src/shims/next-dynamic.tsx') },
      { find: /^next\/navigation$/, replacement: path.join(here, 'src/shims/next-navigation.ts') },
      { find: /^@shared\//, replacement: `${shared}/` },
      { find: /^@\//, replacement: `${webApp}/src/` },
      // The React that Next.js ships and the web app runs on: the screens use its ViewTransition, which the published react package does not have yet.
      // One copy for everything, so the desktop build behaves as the web app does and hooks never see two Reacts.
      { find: /^react$/, replacement: `${nextReact}/react/index.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${nextReact}/react/jsx-runtime.js` },
      { find: /^react\/jsx-dev-runtime$/, replacement: `${nextReact}/react/jsx-dev-runtime.js` },
      { find: /^react-dom$/, replacement: `${nextReact}/react-dom/index.js` },
      { find: /^react-dom\/client$/, replacement: `${nextReact}/react-dom/client.js` },
    ],
  },
  define: {
    'process.env.NEXT_PUBLIC_API': JSON.stringify(api),
    'process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO': JSON.stringify(api === 'mock' ? '1' : ''),
    'process.env.NEXT_PUBLIC_BUILD_ID': JSON.stringify(process.env.HMS_BUILD_ID ?? 'desktop'),
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify(''),
  },
  server: { port: 1420, strictPort: true, fs: { allow: [path.resolve(here, '..')] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
