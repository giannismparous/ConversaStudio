import React from 'react';
import { useI18n } from '../lib/i18n.jsx';
import AppBrand from './AppBrand.jsx';

/** Metron-style boot: centered wordmark + spinner on paper. */
export default function AppLoading({ label }) {
  const { t } = useI18n();
  return (
    <div className="boot-wrap" role="status" aria-live="polite" aria-busy="true">
      <div className="boot-panel">
        <h1 className="brand brand-lg">
          <AppBrand />
        </h1>
        <div className="boot-loading-row">
          <span className="boot-spinner" aria-hidden="true" />
          <span className="boot-loading-label">{label || t('common.loading')}</span>
        </div>
      </div>
    </div>
  );
}
