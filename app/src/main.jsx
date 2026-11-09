import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
const App = lazy(() => import('./App.jsx'));
const Demo = lazy(() => import('./Demo.jsx'));
const Landing = lazy(() => import('./Landing.jsx'));

const p = location.pathname.replace(/\/+$/, '') || '/';
const isApp = p === '/app' || p.startsWith('/app/');
if (isApp) { // the signed-in app is never indexed; public pages (/ and /demo) are
  const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow, noarchive'; document.head.appendChild(m);
  document.title = 'Field As-Built — sign in';
} else if (p === '/demo') document.title = 'Field As-Built — live demo (sample data)';
const Page = isApp ? App : p === '/demo' ? Demo : Landing;
createRoot(document.getElementById('root')).render(<Suspense fallback={<div className="empty">Loading…</div>}><Page /></Suspense>);
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && isApp) navigator.serviceWorker.register('/sw.js').catch(() => {});
