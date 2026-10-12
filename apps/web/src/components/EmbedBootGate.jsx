import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import AppLoading from './AppLoading.jsx';

const EMBED_MIN_MS = 720;

function isEmbed() {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('embed') === '1'
  );
}

/**
 * Inside fλow, hold the Metron-style boot screen briefly so opening Dialogos
 * does not flash the login form the way a cold Supabase session otherwise would.
 */
export default function EmbedBootGate({ children }) {
  const embed = isEmbed();
  const { ready } = useAuth();
  const [minDone, setMinDone] = useState(!embed);

  useEffect(() => {
    if (!embed) {
      setMinDone(true);
      return undefined;
    }
    setMinDone(false);
    const id = window.setTimeout(() => setMinDone(true), EMBED_MIN_MS);
    return () => window.clearTimeout(id);
  }, [embed]);

  if (embed && (!ready || !minDone)) {
    return <AppLoading />;
  }

  return children;
}
