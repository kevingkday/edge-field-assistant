import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LandingPage } from './components/LandingPage';
import './index.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
}

function RootRouter() {
  const [routeKey, setRouteKey] = useState(
    () => window.location.pathname + window.location.search
  );

  useEffect(() => {
    const onPopState = () => {
      setRouteKey(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (to: string) => {
    if (window.location.pathname + window.location.search === to) return;
    window.history.pushState({}, '', to);
    setRouteKey(to);
    window.scrollTo(0, 0);
  };

  const pathname = routeKey.split('?')[0];
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return <App onNavigateHome={() => navigate('/')} />;
  }

  return <LandingPage onNavigateApp={navigate} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);
