// The desktop app's entry: the job web-app/src/app/layout.tsx and app/login/page.tsx do on the web, without a server.
import { createRoot } from 'react-dom/client';

import { AuthEntry } from '@/components/auth/AuthEntry';
import { ScreenTranslator } from '@/components/ScreenTranslator';
import { themeCss } from '@/lib/theme';

import './app.css';
import './desktop.css';
import { TitleBar } from './TitleBar';

// The token values the web app writes into <head> on the server.
const style = document.createElement('style');
style.textContent = themeCss;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <>
    <TitleBar />
    <ScreenTranslator />
    <AuthEntry ended={null} noSession />
  </>,
);
