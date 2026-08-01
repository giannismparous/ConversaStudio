import { getApiUrl } from '../lib/api.js';
import { getApiAuth } from './apiAuth.js';
import { isSupabaseAuth } from './authMode.js';

/**
 * Build a preview payload for a knowledge source (pdf iframe, text body, or url).
 * Online uploads live in object storage behind `/files/…` keys — fetch via the
 * authenticated content endpoint and use a blob URL so iframes work.
 *
 * @param {object} source
 * @param {{ botId?: string, username?: string }} [opts]
 */
export async function buildSourcePreview(source, { botId, username } = {}) {
  if (!source) throw new Error('Nothing to preview');

  if (source.type === 'url') {
    return { source, kind: 'url', url: source.uri };
  }

  const isFile =
    source.type === 'pdf' ||
    source.type === 'txt' ||
    (source.type === 'text' && String(source.uri || '').startsWith('/files/'));

  if (isFile && botId && source.id) {
    const blob = await fetchSourceContentBlob(botId, source.id, username);
    if (source.type === 'pdf') {
      const url = URL.createObjectURL(blob);
      return { source, kind: 'pdf', url, objectUrl: true };
    }
    const text = await blob.text();
    return { source, kind: 'text', text };
  }

  if (source.uri?.startsWith('/files/')) {
    const fileUrl = `${getApiUrl()}${source.uri}`;
    if (source.type === 'pdf') {
      return { source, kind: 'pdf', url: fileUrl };
    }
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error('Could not load file');
    const text = await res.text();
    return { source, kind: 'text', text };
  }

  if (source.type === 'text' && source.uri) {
    return { source, kind: 'text', text: source.uri };
  }

  if (source.uri?.startsWith('http') && source.type === 'pdf') {
    return { source, kind: 'pdf', url: source.uri };
  }

  throw new Error('Nothing to preview for this source');
}

async function fetchSourceContentBlob(botId, sourceId, username) {
  const headers = {};
  const auth = getApiAuth();
  const token = await auth.getAccessToken?.();
  const resolvedUsername = isSupabaseAuth ? null : username ?? auth.username;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (resolvedUsername) headers['X-Dev-User'] = resolvedUsername;

  const res = await fetch(`${getApiUrl()}/bots/${botId}/sources/${sourceId}/content`, {
    headers,
  });
  if (!res.ok) {
    let message = 'Could not load file';
    try {
      const data = await res.json();
      message = data?.message || data?.error || message;
    } catch {
      /* ignore */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.blob();
}
