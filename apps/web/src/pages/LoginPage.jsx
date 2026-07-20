import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import LanguageSwitcherIcon from '../components/LanguageSwitcherIcon.jsx';
import AppBrand from '../components/AppBrand.jsx';

export default function LoginPage() {
  const { username, user, login, authError, clearAuthError } = useAuth();
  const { t } = useI18n();
  const [value, setValue] = useState(() => localStorage.getItem('df_username') || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (username && user) return <Navigate to="/bots" replace />;

  const submit = async (e) => {
    e.preventDefault();
    clearAuthError?.();
    setError('');
    const clean = value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
      setError(t('login.usernameError'));
      return;
    }
    setSubmitting(true);
    const ok = await login(clean);
    setSubmitting(false);
    if (!ok) setValue(clean);
  };

  const shownError = error || authError;

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-card-top">
          <h1 className="brand">
            <AppBrand />
          </h1>
          <LanguageSwitcherIcon />
        </div>
        <p>{t('login.tagline')}</p>
        <div className="field">
          <label htmlFor="username">{t('login.username')}</label>
          <input
            id="username"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
              clearAuthError?.();
            }}
            placeholder={t('login.usernamePlaceholder')}
            autoFocus
            disabled={submitting}
          />
        </div>
        {shownError && <p className="error-text">{shownError}</p>}
        <button className="btn btn-accent" type="submit" disabled={submitting || !value.trim()}>
          {submitting ? t('login.connecting') : t('login.enter')}
        </button>
      </form>
    </div>
  );
}
