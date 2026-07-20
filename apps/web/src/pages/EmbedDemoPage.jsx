import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiUrl } from '../lib/api.js';

export default function EmbedDemoPage() {
  const { id } = useParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const src = `${getApiUrl()}/embed/${id}.js`;
    const existing = document.querySelector(`script[data-df-embed="${id}"]`);
    if (existing) {
      setReady(true);
      return undefined;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.dfEmbed = id;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
    return () => {
      // leave script; widget owns DOM nodes for demo session
    };
  }, [id]);

  return (
    <div style={{ minHeight: '100vh', padding: '2rem', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
      <h1 style={{ fontWeight: 500, letterSpacing: '-0.04em', fontSize: '1.75rem' }}>Embed demo page</h1>
      <p style={{ maxWidth: 560, color: '#6b6458' }}>
        This page only loads the public embed script — the same way a customer site would. The
        launcher should appear at the bottom.
      </p>
      <pre
        style={{
          background: '#1a1814',
          color: '#f5efe4',
          padding: '1rem',
          borderRadius: 12,
          display: 'inline-block',
        }}
      >
        {`<script src="${getApiUrl()}/embed/${id}.js" async></script>`}
      </pre>
      <p style={{ color: '#6b6458' }}>{ready ? 'Script loaded.' : 'Loading embed script…'}</p>
    </div>
  );
}
