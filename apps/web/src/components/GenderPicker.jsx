import React from 'react';

function IconHe() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="10" cy="10" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M14.2 5.2L19 2.8M19 2.8V7.2M19 2.8H14.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShe() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 14.25V20.5M9.25 17.75H14.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconIt() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

const OPTIONS = [
  { value: 'masculine', labelKey: 'he', Icon: IconHe },
  { value: 'feminine', labelKey: 'she', Icon: IconShe },
  { value: 'neutral', labelKey: 'it', Icon: IconIt },
];

export default function GenderPicker({ value, onChange, loading = false, disabled = false, labels }) {
  return (
    <div
      className={`gender-picker${loading ? ' is-loading' : ''}`}
      role="radiogroup"
      aria-label={labels?.group || 'Gender'}
      aria-busy={loading || undefined}
    >
      <div className="gender-picker-status-slot" aria-live="polite">
        {loading ? (
          <p className="gender-picker-status">{labels?.detecting || 'Detecting…'}</p>
        ) : (
          <p className="gender-picker-status gender-picker-status--idle" aria-hidden="true">
            &nbsp;
          </p>
        )}
      </div>
      <div className="gender-picker-options">
        {OPTIONS.map(({ value: optionValue, labelKey, Icon }, index) => {
          const selected = !loading && value === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`gender-picker-option${selected ? ' is-selected' : ''}${
                loading ? ' is-awaiting' : ''
              }`}
              style={loading ? { animationDelay: `${index * 0.14}s` } : undefined}
              disabled={disabled || loading}
              onClick={() => onChange?.(optionValue)}
            >
              <span className="gender-picker-icon">
                <Icon />
              </span>
              <span className="gender-picker-label">{labels?.[labelKey] || labelKey}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
