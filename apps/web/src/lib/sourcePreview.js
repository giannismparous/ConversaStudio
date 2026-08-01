import { getApiUrl } from '../lib/api.js';

/**
 * Build a preview payload for a knowledge source (pdf iframe, text body, or url).
 */
export async function buildSourcePreview(source) {
  if (!source) throw new Error('Nothing to preview');

  if (source.type === 'url') {
    return { source, kind: 'url', url: source.uri };
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

  throw new Error('Nothing to preview for this source');
}
