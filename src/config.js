function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Fehlende Umgebungsvariable: ${name}`);
    process.exit(1);
  }
  return value;
}

const stripSlash = (url) => url.replace(/\/+$/, '');

const giteaUrl = stripSlash(required('GITEA_URL'));

export const config = {
  port: Number(process.env.PORT || 3000),
  // Public URL of this board, e.g. https://board.example.com
  baseUrl: stripSlash(required('BASE_URL')),
  // Public Gitea URL (browser redirects, links)
  giteaUrl,
  // Optional internal Gitea URL for server-to-server calls (e.g. http://gitea:3000 in a docker network)
  giteaInternalUrl: stripSlash(process.env.GITEA_INTERNAL_URL || giteaUrl),
  clientId: required('OAUTH_CLIENT_ID'),
  clientSecret: required('OAUTH_CLIENT_SECRET'),
  sessionSecret: required('SESSION_SECRET'),
  // Only honoured by Gitea when [oauth2] ENABLE_ADDITIONAL_GRANT_SCOPES = true
  oauthScopes: process.env.OAUTH_SCOPES ?? 'read:user read:organization read:repository write:issue',
  closedLimit: Number(process.env.CLOSED_ISSUES_LIMIT || 100),
  sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_DAYS || 7) * 24 * 60 * 60 * 1000,
};
