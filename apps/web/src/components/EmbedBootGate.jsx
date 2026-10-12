import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

function isEmbed() {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('embed') === '1'
  );
}

function notifyFlowEmbedReady() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'simasia-embed-ready', product: 'dialogos' }, '*');
    }
  } catch {
    /* ignore */
  }
}

/**
 * Inside fλow, stay quiet while the shell shows the only branded boot.
 * Signal ready once auth has settled so fλow can uncover the iframe.
 */
export default function EmbedBootGate({ children }) {
  const embed = isEmbed();
  const { ready } = useAuth();
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    if (!embed || !ready || posted) return;
    notifyFlowEmbedReady();
    setPosted(true);
  }, [embed, ready, posted]);

  // fλow owns the visible loader — avoid a second Dialogos boot flash.
  if (embed && !ready) {
    return <div className="boot-wrap" aria-busy="true" />;
  }

  return children;
}
