import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../lib/i18n.jsx';

const VIEW = 280;
const OUT = 256;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = src;
  });
}

/**
 * Square crop modal — drag to pan, zoom slider / wheel, export PNG.
 */
export default function IconCropModal({ file, accent = '#c45f2f', onCancel, onCropped }) {
  const { t } = useI18n();
  const [src, setSrc] = useState('');
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);
  const viewportRef = useRef(null);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  offsetRef.current = offset;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setImg(null);
    setSrc('');

    (async () => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (cancelled) return;
        const image = await loadImage(dataUrl);
        if (cancelled) return;
        const fit = Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight);
        const nextOffset = {
          x: (VIEW - image.naturalWidth * fit) / 2,
          y: (VIEW - image.naturalHeight * fit) / 2,
        };
        setSrc(dataUrl);
        setImg(image);
        setMinZoom(fit);
        setZoom(fit);
        setOffset(nextOffset);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || t('crop.loadFailed'));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, t]);

  const clampOffset = (x, y, z, image = img) => {
    if (!image) return { x, y };
    const w = image.naturalWidth * z;
    const h = image.naturalHeight * z;
    // Keep the crop square covered when zoomed in; allow free center when smaller.
    const minX = Math.min(0, VIEW - w);
    const minY = Math.min(0, VIEW - h);
    const maxX = Math.max(0, VIEW - w);
    const maxY = Math.max(0, VIEW - h);
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  };

  const applyZoom = (nextZoom, pivotX = VIEW / 2, pivotY = VIEW / 2) => {
    if (!img) return;
    const z = Math.min(minZoom * 4, Math.max(minZoom, nextZoom));
    const prev = zoomRef.current;
    const scale = z / prev;
    const cur = offsetRef.current;
    const nx = pivotX - (pivotX - cur.x) * scale;
    const ny = pivotY - (pivotY - cur.y) * scale;
    setZoom(z);
    setOffset(clampOffset(nx, ny, z));
  };

  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setOffset(clampOffset(drag.current.ox + dx, drag.current.oy + dy, zoom));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      if (!img) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pivotX = e.clientX - rect.left;
      const pivotY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      applyZoom(zoomRef.current * factor, pivotX, pivotY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
    // applyZoom closes over latest img/minZoom via this effect’s deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, minZoom]);

  const apply = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUT, OUT);
      const scale = OUT / VIEW;
      ctx.drawImage(
        img,
        offset.x * scale,
        offset.y * scale,
        img.naturalWidth * zoom * scale,
        img.naturalHeight * zoom * scale
      );
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Could not export crop'))),
          'image/png',
          0.92
        );
      });
      onCropped(blob);
    } catch (err) {
      setError(err?.message || t('crop.loadFailed'));
      setBusy(false);
    }
  };

  const modal = (
    <div
      className="preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('crop.ariaLabel')}
      onClick={onCancel}
    >
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-modal-head">
          <div>
            <strong>{t('crop.title')}</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {t('crop.subtitle')}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>

        <div className="crop-stage">
          <div
            ref={viewportRef}
            className="crop-viewport"
            style={{ width: VIEW, height: VIEW, borderColor: accent }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {loading && <div className="crop-viewport-status muted">{t('crop.loading')}</div>}
            {error && !loading && <div className="crop-viewport-status">{error}</div>}
            {src && img && !error && (
              <img
                src={src}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: img.naturalWidth * zoom,
                  height: img.naturalHeight * zoom,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  display: 'block',
                }}
              />
            )}
          </div>
        </div>

        <div className="crop-controls">
          <label className="crop-zoom">
            <span className="muted">{t('crop.zoom')}</span>
            <div className="crop-zoom-row">
              <button
                type="button"
                className="btn btn-ghost crop-zoom-btn"
                disabled={!img || zoom <= minZoom + 0.001}
                onClick={() => applyZoom(zoom / 1.12)}
                aria-label={t('crop.zoomOut')}
              >
                −
              </button>
              <input
                type="range"
                min={minZoom}
                max={minZoom * 4}
                step={0.01}
                value={zoom}
                disabled={!img}
                onChange={(e) => applyZoom(Number(e.target.value))}
              />
              <button
                type="button"
                className="btn btn-ghost crop-zoom-btn"
                disabled={!img || zoom >= minZoom * 4 - 0.001}
                onClick={() => applyZoom(zoom * 1.12)}
                aria-label={t('crop.zoomIn')}
              >
                +
              </button>
            </div>
          </label>
          <button
            type="button"
            className="btn btn-accent"
            onClick={apply}
            disabled={!img || busy || Boolean(error)}
          >
            {busy ? t('crop.saving') : t('crop.useCrop')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
