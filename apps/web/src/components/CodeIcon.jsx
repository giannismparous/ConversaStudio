import React from 'react';

/** Code / embed mark — chevron brackets `<>`. */
export default function CodeIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 7L4 12l5 5" />
      <path d="M15 7l5 5-5 5" />
    </svg>
  );
}
