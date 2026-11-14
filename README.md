# Gitea Issue Board

A GitLab-style issue board for self-hosted Gitea instances.

- All issues of a repository are loaded (all open issues, closed issues up to `CLOSED_ISSUES_LIMIT`).
- Each board uses one **label scope** (e.g. `status`), which produces these columns:
  - **Open** – open issues without a label from this scope
  - one column per label in the scope (`status/todo`, `status/doing`, …)
  - **Closed** – closed issues
- Dragging and dropping a card updates the issue in Gitea (same as GitLab):
  - into a label column: remove all labels of this scope, add the target label, reopen the issue if needed
  - into *Open*: remove the labels of this scope, reopen the issue if needed
  - into *Closed*: remove the labels of this scope, close the issue
  - Labels from other scopes and labels without a scope are always kept.
- Login via Gitea (OAuth2). All API calls run with the permissions of the signed-in user.
- Columns can be reordered by dragging their headers. The order is stored in the browser per repository and scope.
- Filter: free text, `#12`, `@login`.

## Labels in Gitea

Scoped labels follow the Gitea convention `scope/name`. The scope is everything before the last `/`.
It is best to create them as **exclusive** in Gitea, so that an issue can only have one label per scope in Gitea itself as well.
Organization labels are included too.

Example: `status/todo`, `status/in-progress`, `status/review`.

## Setup

### 1. Create an OAuth2 application in Gitea

Gitea → *Settings* → *Applications* → *Manage OAuth2 Applications* (or, as an admin, under *Site Administration* → *Integrations* → *Applications*):

- Name: `Issue Board`
- Redirect URI: `https://board.example.com/auth/callback`
- "Confidential Client": **enabled**

Note down the client ID and client secret.

### 2. Configuration

```bash
cp .env.example .env
openssl rand -hex 32   # -> SESSION_SECRET
```

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | yes | Public URL of the board, e.g. `https://board.example.com` |
| `GITEA_URL` | yes | Public URL of Gitea |
| `GITEA_INTERNAL_URL` | no | Internal URL for server-to-server calls (e.g. `http://gitea:3000`) |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | yes | From step 1 |
| `SESSION_SECRET` | yes | Random string |
| `CLOSED_ISSUES_LIMIT` | no | Max. number of closed issues to load (default 100) |
| `SESSION_MAX_AGE_DAYS` | no | Session lifetime in days (default 7) |
| `OAUTH_SCOPES` | no | Only used if Gitea has `[oauth2] ENABLE_ADDITIONAL_GRANT_SCOPES = true` |

### 3. Run

```bash
docker compose up -d --build
```

The container only listens on `127.0.0.1:3000`. Put a reverse proxy with TLS in front of it, e.g. Caddy:

```
board.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

If Gitea runs on the same server in the same Docker network, you can attach the board to that network and set `GITEA_INTERNAL_URL=http://gitea:3000`.

## Development

```bash
npm install
cp .env.example .env    # BASE_URL=http://localhost:3000, adjust the redirect URI accordingly
npm run dev
npm test
```

## Architecture

- `src/server.js` – Express: OAuth2 flow, session (in-memory, the token stays on the server), API proxy
- `src/gitea.js` – Gitea API client, token exchange and refresh
- `src/board.js` – scope logic and computation of label changes when moving issues
- `public/` – frontend (vanilla JS + [SortableJS](https://github.com/SortableJS/Sortable), no build step)

Notes:

- Sessions are kept in memory. After a container restart you have to sign in again. This works without a password as long as you are still signed in to Gitea.
- Gitea does not store an order for issues. Issues within a column are therefore not sorted; they appear in the order Gitea returns them (newest first).
