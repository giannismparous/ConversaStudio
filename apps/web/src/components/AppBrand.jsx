import React from 'react';

export const APP_NAME = 'DialogosAI';

/**
 * Platform wordmark — match fλow/Metron product marks:
 * accent on Dialogos (product blue), AI stays ink; italic like the site.
 */
export default function AppBrand() {
  return (
    <span className="brand-dialogos">
      <span className="product-accent">Dialogos</span>AI
    </span>
  );
}
