import React from 'react';
import { useI18n } from '../lib/i18n.jsx';
import AppBrand from './AppBrand.jsx';

/** Same boot pattern as MetronAI: wordmark + ink spinner on paper. */
export default function AppLoading({ label }) {
  const { t } = useI18n();
  const text = label || t('common.loading');
  return (
    <div className="boot-wrap" aria-busy="true">
      <div className="boot-panel">
        <h1 className="brand">
          <AppBrand />
        </h1>
        <span className="spinner spinner-md" role="status" aria-label={text}>
          <span className="sr-only">{text}</span>
        </span>
      </div>
    </div>
  );
}
