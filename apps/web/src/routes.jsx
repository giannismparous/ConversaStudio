import React from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import BotsPage from './pages/BotsPage.jsx';
import BotEditorPage from './pages/BotEditorPage.jsx';
import BotCreateWizardPage from './pages/BotCreateWizardPage.jsx';
import BotTestPage from './pages/BotTestPage.jsx';
import EmbedDemoPage from './pages/EmbedDemoPage.jsx';
import Shell from './components/Shell.jsx';
import OverscrollFill from './components/OverscrollFill.jsx';
import AppLoading from './components/AppLoading.jsx';

function AppRoot() {
  return (
    <>
      <OverscrollFill />
      <Outlet />
    </>
  );
}

function searchSuffix() {
  if (typeof window === 'undefined') return '';
  return window.location.search || '';
}

function RequireUser() {
  const { ready, user, authError } = useAuth();
  if (!ready) return <AppLoading />;
  if (!user || (authError && !user)) {
    return <Navigate to={`/login${searchSuffix()}`} replace />;
  }
  return <Outlet />;
}

function HomeRedirect() {
  return <Navigate to={`/bots${searchSuffix()}`} replace />;
}

const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

export const router = createBrowserRouter(
  [
    {
      element: <AppRoot />,
      children: [
        { path: '/login', element: <LoginPage /> },
        {
          path: '/',
          element: <RequireUser />,
          children: [
            {
              element: <Shell />,
              children: [
                { index: true, element: <HomeRedirect /> },
                { path: 'bots', element: <BotsPage /> },
                { path: 'bots/new', element: <BotCreateWizardPage /> },
                { path: 'bots/:id', element: <BotEditorPage /> },
                { path: 'bots/:id/test', element: <BotTestPage /> },
              ],
            },
          ],
        },
        { path: '/embed-demo/:id', element: <EmbedDemoPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: basename === '/' ? undefined : basename }
);
