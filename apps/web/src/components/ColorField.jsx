import React, { useEffect, useRef, useState } from 'react';

export const COLOR_PALETTE = [
  '#fffdf8',
  '#faf9f5',
  '#f5efe4',
  '#ece5d8',
  '#eee7da',
  '#ffd9a8',
  '#f7e7c5',
  '#f3d6d1',
  '#e8a088',
  '#d97757',
  '#c45f2f',
  '#a85226',
  '#b8956a',
  '#8a5a10',
  '#4a3728',
  '#6b6458',
  '#1a1814',
  '#141413',
  '#ffffff',
  '#d9ebe4',
  '#1f5a48',
  '#c9daf8',
  '#2d4a6f',
  '#8a2e22',
  '#f0ebe3',
  '#e6dcc8',
  '#d4c4a8',
  '#c9a88a',
  '#e8b89a',
  '#d4946a',
  '#b86b45',
  '#9a5535',
  '#7a4030',
  '#5c2e24',
  '#3d3a35',
  '#2a2824',
  '#1e3d36',
  '#2f6b5a',
  '#4a7c6f',
  '#a8c5bc',
  '#3d5a80',
  '#6b8cae',
  '#b8c9dc',
  '#5c4033',
];

export function normalizeHex(value, fallback = '#d97757') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

/**
 * Compact color row — select to edit via the shared ThemeColors rail.
 */
export default function ColorField({
  label,
  value,
  onChange,
  selected = false,
  onSelect,
}) {
  const safe = normalizeHex(value);

  return (
    <div className={`field color-field${selected ? ' is-selected' : ''}`}>
      <label>{label}</label>
      <div className="color-picker-row">
        <button
          type="button"
          className="color-swatch"
          style={{ background: safe }}
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Pick ${label.toLowerCase()}`}
        />
        <input
          className="color-hex"
          value={value}
          onFocus={onSelect}
          onChange={(e) => onChange(normalizeHex(e.target.value, safe))}
          placeholder="#d97757"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
