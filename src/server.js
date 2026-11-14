import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import createMemoryStore from 'memorystore';
import { config } from './config.js';
import { GiteaError, authorizeUrl, createApi, exchangeCode, refreshAccessToken } from './gitea.js';
import { mapIssue, mapLabel, planMove, sameIds, scopeOf } from './board.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MemoryStore = createMemoryStore(session);
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https: http: data:; style-src 'self'; script-src 'self'; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.get('/healthz', (req, res) => res.send('ok'));

app.use(
  session({
    name: 'issueboard.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new MemoryStore({ checkPeriod: 60 * 60 * 1000 }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https://'),
      maxAge: config.sessionMaxAgeMs,
    },
  }),
);
app.use(express.json({ limit: '50kb' }));

// ---------- Auth ----------

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  req.session.returnTo = safeReturnTo(req.query.returnTo);
  req.session.save(() => res.redirect(authorizeUrl(state)));
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expected = req.session.oauthState;
  const returnTo = req.session.returnTo || '/';
  delete req.session.oauthState;
  delete req.session.returnTo;

  if (error) return res.redirect(`/?login_error=${encodeURIComponent(String(error))}`);
  if (!code || !state || !expected || state !== expected) {
    return res.redirect('/?login_error=invalid_state');
  }
  try {
    const tokens = await exchangeCode(String(code));
    const user = await createApi(tokens.accessToken).get('/user');
    req.session.regenerate((err) => {
      if (err) return res.redirect('/?login_error=session');
      req.session.auth = tokens;
      req.session.user = { id: user.id, login: user.login, fullName: user.full_name, avatar: user.avatar_url };
      req.session.save(() => res.redirect(returnTo));
    });
  } catch (e) {
    console.error('OAuth callback failed:', e.message);
    res.redirect('/?login_error=token');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('issueboard.sid');
    res.status(204).end();
  });
});

// ---------- API ----------

const refreshing = new Map();

async function getApi(req) {
  const auth = req.session.auth;
  if (!auth) throw new GiteaError(401, 'Not signed in');
  if (auth.expiresAt - 60_000 > Date.now()) return createApi(auth.accessToken);
  if (!auth.refreshToken) throw new GiteaError(401, 'Session expired');

  // Deduplicate parallel refreshes of the same session (Gitea may invalidate used refresh tokens).
  let pending = refreshing.get(req.sessionID);
  if (!pending) {
    pending = refreshAccessToken(auth.refreshToken).finally(() => refreshing.delete(req.sessionID));
    refreshing.set(req.sessionID, pending);
  }
  try {
    const tokens = await pending;
    req.session.auth = tokens;
    return createApi(tokens.accessToken);
  } catch {
    delete req.session.auth;
    throw new GiteaError(401, 'Session expired');
  }
}

const api = express.Router();

api.use((req, res, next) => {
  if (!req.session.auth) return res.status(401).json({ error: 'not_authenticated' });
  // CSRF protection in addition to SameSite=Lax: cross-site forms cannot set custom headers.
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'issue-board') {
    return res.status(403).json({ error: 'csrf' });
  }
  next();
});

api.get('/me', (req, res) => {
  res.json({ user: req.session.user, giteaUrl: config.giteaUrl });
});

// All repositories the user can access (own, collaborations, org/team repos).
api.get('/repos', async (req, res) => {
  const gitea = await getApi(req);
  const repos = await gitea.paginate('/user/repos');
  res.json(
    repos
      .filter((r) => r.has_issues !== false)
      .map((r) => ({
        fullName: r.full_name,
        owner: r.owner?.login || r.full_name.split('/')[0],
        name: r.name,
        description: r.description || '',
        private: !!r.private,
        archived: !!r.archived,
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name)),
  );
});

const repoPath = (req) => `/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}`;

async function loadLabels(gitea, req) {
  const [repoLabels, orgLabels] = await Promise.all([
    gitea.paginate(`${repoPath(req)}/labels`),
    gitea.paginate(`/orgs/${encodeURIComponent(req.params.owner)}/labels`).catch(() => []), // owner is a user
  ]);
  const byId = new Map();
  for (const l of [...orgLabels, ...repoLabels]) byId.set(l.id, mapLabel(l));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

api.get('/repos/:owner/:repo/board', async (req, res) => {
  const gitea = await getApi(req);
  const base = repoPath(req);
  const [repo, labels, open, closed] = await Promise.all([
    gitea.get(base),
    loadLabels(gitea, req),
    gitea.paginate(`${base}/issues`, { state: 'open', type: 'issues' }),
    gitea.paginate(`${base}/issues`, { state: 'closed', type: 'issues' }, config.closedLimit),
  ]);
  res.json({
    repo: {
      fullName: repo.full_name,
      url: repo.html_url,
      canWrite: !!(repo.permissions?.push || repo.permissions?.admin),
    },
    labels,
    scopes: [...new Set(labels.map((l) => l.scope).filter(Boolean))].sort(),
    issues: [...open, ...closed].filter((i) => !i.pull_request).map(mapIssue),
    closedLimit: config.closedLimit,
  });
});

api.post('/repos/:owner/:repo/issues/:index/move', async (req, res) => {
  const { scope, target } = req.body || {};
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || typeof scope !== 'string' || !scope || !target) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const gitea = await getApi(req);
  const issuePath = `${repoPath(req)}/issues/${index}`;
  const [issue, labels] = await Promise.all([gitea.get(issuePath), loadLabels(gitea, req)]);
  if (issue.pull_request) return res.status(400).json({ error: 'pr_not_supported' });

  let plan;
  try {
    const scopeLabelIds = labels.filter((l) => l.scope === scope).map((l) => l.id);
    plan = planMove(issue.labels || [], scope, { ...target, labelId: Number(target.labelId) }, scopeLabelIds);
  } catch (e) {
    return res.status(400).json({ error: e.code || 'bad_request' });
  }

  const currentIds = (issue.labels || []).map((l) => l.id);
  if (!sameIds(currentIds, plan.labelIds)) {
    if (plan.labelIds.length > 0) await gitea.put(`${issuePath}/labels`, { labels: plan.labelIds });
    else await gitea.delete(`${issuePath}/labels`);
  }
  if (issue.state !== plan.state) await gitea.patch(issuePath, { state: plan.state });

  res.json(mapIssue(await gitea.get(issuePath)));
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// ---------- Static frontend ----------

app.get('/vendor/Sortable.min.js', (req, res) =>
  res.sendFile(path.join(rootDir, 'node_modules/sortablejs/Sortable.min.js')),
);
app.use(express.static(path.join(rootDir, 'public'), { maxAge: '1h' }));

// ---------- Errors ----------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof GiteaError) {
    if (err.status === 401) {
      delete req.session?.auth;
      return res.status(401).json({ error: 'not_authenticated' });
    }
    const status = [403, 404, 409, 422].includes(err.status) ? err.status : 502;
    // Messages from Gitea itself are passed through as-is.
    return res.status(status).json({ error: 'gitea', message: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

app.listen(config.port, () => {
  console.log(`Issue Board listening on port ${config.port} (${config.baseUrl}), Gitea: ${config.giteaUrl}`);
});
