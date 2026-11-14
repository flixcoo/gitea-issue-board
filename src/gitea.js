import { config } from './config.js';

export class GiteaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${config.giteaInternalUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: `${config.baseUrl}/auth/callback`,
      ...params,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new GiteaError(401, body.error_description || body.error || `Token request failed (${res.status})`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export const exchangeCode = (code) => tokenRequest({ grant_type: 'authorization_code', code });
export const refreshAccessToken = (refreshToken) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

export function authorizeUrl(state) {
  const url = new URL(`${config.giteaUrl}/login/oauth/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', `${config.baseUrl}/auth/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.oauthScopes) url.searchParams.set('scope', config.oauthScopes);
  return url.toString();
}

export function createApi(token) {
  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${config.giteaInternalUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      throw new GiteaError(res.status, (data && data.message) || res.statusText || 'Gitea error');
    }
    return { data, headers: res.headers };
  }

  // Fetches all pages of a list endpoint (up to maxItems).
  async function paginate(path, query = {}, maxItems = Infinity) {
    const items = [];
    const limit = 50; // Gitea caps this at MAX_RESPONSE_ITEMS anyway
    for (let page = 1; page <= 500 && items.length < maxItems; page++) {
      const { data, headers } = await request('GET', path, { query: { ...query, page, limit } });
      if (!Array.isArray(data) || data.length === 0) break;
      items.push(...data);
      const total = Number(headers.get('x-total-count'));
      if (Number.isFinite(total) && total > 0 && items.length >= total) break;
    }
    return items.slice(0, maxItems);
  }

  return {
    get: async (path, query) => (await request('GET', path, { query })).data,
    put: async (path, body) => (await request('PUT', path, { body })).data,
    patch: async (path, body) => (await request('PATCH', path, { body })).data,
    delete: async (path) => (await request('DELETE', path)).data,
    paginate,
  };
}
