import { getApiAuth } from './apiAuth.js';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');

export function getApiUrl() {
  return API_URL;
}

export async function api(path, { method = 'GET', body, username, token, formData, signal } = {}) {
  const headers = {};
  const auth = getApiAuth();
  const resolvedUsername = username ?? auth.username;
  const resolvedToken = token ?? (await auth.getAccessToken?.());

  if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;
  if (resolvedUsername) headers['X-Dev-User'] = resolvedUsername;

  let payload = body;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: payload,
    signal,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
