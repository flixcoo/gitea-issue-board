// Minimal i18n: German if the browser prefers German over English, otherwise English.

const messages = {
  en: {
    'app.title': 'Issue Board',
    'login.intro': 'Sign in with your Gitea account to see the issue boards of your repositories.',
    'login.button': 'Sign in with Gitea',
    'login.failed': 'Sign-in failed ({error}). Please try again.',
    'brand.title': 'Open Gitea',
    'repo.label': 'Repository',
    'repo.choose': 'Choose repository…',
    'repo.filter': 'Filter repositories…',
    'repo.loading': 'Loading repositories…',
    'repo.none': 'No repositories found',
    'repo.private': 'Private',
    'repo.archived': 'Archived',
    'scope.label': 'Label scope',
    'filter.label': 'Filter',
    'filter.placeholder': 'Title, #no., label, @assignee',
    'refresh': 'Reload',
    'openInGitea': 'Open in Gitea',
    'user.menu': 'Profile and settings',
    'user.signedInAs': 'Signed in as',
    'user.profile': 'Profile',
    'user.settings': 'Settings',
    'user.logout': 'Sign out',
    'col.open': 'Open',
    'col.closed': 'Closed',
    'col.closedLimit': 'Showing the last {count} closed issues',
    'card.milestone': 'Milestone',
    'card.comments': 'Comments',
    'empty.chooseRepo.title': 'Choose a repository',
    'empty.chooseRepo.text': 'Pick a repository above to open its issue board.',
    'empty.noScopes.title': 'No label scopes found',
    'empty.noScopes.before': 'This repository has no labels of the form ',
    'empty.noScopes.example': ' (e.g. ',
    'empty.noScopes.after': '). Create such labels in Gitea – ideally as “exclusive” – and reload the board.',
    'empty.loadFailed': 'Board could not be loaded',
    'toast.readOnly': 'Read-only access – issues cannot be moved.',
    'toast.moveFailed': '#{number} could not be moved: {error}',
    'error.status': 'Error {status}',
    'error.not_authenticated': 'Not signed in',
    'error.csrf': 'CSRF check failed',
    'error.bad_request': 'Invalid request',
    'error.pr_not_supported': 'Pull requests are not supported',
    'error.label_not_in_scope': 'Label does not belong to the selected scope',
    'error.unknown_column': 'Unknown target column',
    'error.not_found': 'Not found',
    'error.internal': 'Internal error',
    'error.gitea': 'Gitea error',
  },
  de: {
    'app.title': 'Issue Board',
    'login.intro': 'Melde dich mit deinem Gitea-Konto an, um die Issue Boards deiner Repositories zu sehen.',
    'login.button': 'Mit Gitea anmelden',
    'login.failed': 'Anmeldung fehlgeschlagen ({error}). Bitte erneut versuchen.',
    'brand.title': 'Gitea öffnen',
    'repo.label': 'Repository',
    'repo.choose': 'Repository wählen…',
    'repo.filter': 'Repositories filtern…',
    'repo.loading': 'Lade Repositories…',
    'repo.none': 'Keine Repositories gefunden',
    'repo.private': 'Privat',
    'repo.archived': 'Archiviert',
    'scope.label': 'Label-Scope',
    'filter.label': 'Filter',
    'filter.placeholder': 'Titel, #Nr, Label, @Assignee',
    'refresh': 'Neu laden',
    'openInGitea': 'In Gitea öffnen',
    'user.menu': 'Profil und Einstellungen',
    'user.signedInAs': 'Angemeldet als',
    'user.profile': 'Profil',
    'user.settings': 'Einstellungen',
    'user.logout': 'Abmelden',
    'col.open': 'Offen',
    'col.closed': 'Geschlossen',
    'col.closedLimit': 'Zeigt die letzten {count} geschlossenen Issues',
    'card.milestone': 'Meilenstein',
    'card.comments': 'Kommentare',
    'empty.chooseRepo.title': 'Repository wählen',
    'empty.chooseRepo.text': 'Wähle oben ein Repository aus, um dessen Issue Board zu öffnen.',
    'empty.noScopes.title': 'Keine Label-Scopes gefunden',
    'empty.noScopes.before': 'Dieses Repository hat keine Labels der Form ',
    'empty.noScopes.example': ' (z.B. ',
    'empty.noScopes.after': '). Lege solche Labels in Gitea an – am besten als „exklusiv“ – und lade das Board neu.',
    'empty.loadFailed': 'Board konnte nicht geladen werden',
    'toast.readOnly': 'Nur Lesezugriff – Issues können nicht verschoben werden.',
    'toast.moveFailed': '#{number} konnte nicht verschoben werden: {error}',
    'error.status': 'Fehler {status}',
    'error.not_authenticated': 'Nicht angemeldet',
    'error.csrf': 'CSRF-Prüfung fehlgeschlagen',
    'error.bad_request': 'Ungültige Anfrage',
    'error.pr_not_supported': 'Pull Requests werden nicht unterstützt',
    'error.label_not_in_scope': 'Label gehört nicht zum gewählten Scope',
    'error.unknown_column': 'Unbekannte Zielspalte',
    'error.not_found': 'Nicht gefunden',
    'error.internal': 'Interner Fehler',
    'error.gitea': 'Gitea-Fehler',
  },
};

function detectLang() {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const tag of prefs) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (primary in messages) return primary;
  }
  return 'en';
}

export const lang = detectLang();

export function t(key, params = {}) {
  const text = messages[lang][key] ?? messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

export const hasMessage = (key) => key in messages[lang];

// Translates static markup: data-i18n (text), data-i18n-placeholder/-title/-aria-label (attributes).
export function translateDocument(root = document) {
  document.documentElement.lang = lang;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const dataKey = `i18n${attr.replace(/(^|-)(\w)/g, (m, d, c) => c.toUpperCase())}`;
    for (const node of root.querySelectorAll(`[data-i18n-${attr}]`)) node.setAttribute(attr, t(node.dataset[dataKey]));
  }
}
