import React from 'react';

export default function FieldLabelHelp({ label, help }) {
  if (!help) return label || null;

  return (
    <span className="field-label-with-help">
      {label || null}
      <span
        className="field-help-trigger"
        tabIndex={0}
        role="button"
        aria-label={help}
        data-help={help}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        ?
      </span>
    </span>
  );
}
