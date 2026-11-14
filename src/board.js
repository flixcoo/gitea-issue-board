// Gitea convention for scoped labels: "scope/name" (scope = everything before the last "/").
export function scopeOf(labelName) {
  const i = labelName.lastIndexOf('/');
  return i > 0 ? labelName.slice(0, i) : null;
}

export function mapLabel(l) {
  return {
    id: l.id,
    name: l.name,
    color: '#' + String(l.color || '999999').replace(/^#/, ''),
    description: l.description || '',
    exclusive: !!l.exclusive,
    scope: scopeOf(l.name),
  };
}

export function mapIssue(i) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    author: i.user?.login,
    labels: (i.labels || []).map(mapLabel),
    assignees: (i.assignees || []).map((a) => ({ login: a.login, avatar: a.avatar_url })),
    milestone: i.milestone ? i.milestone.title : null,
    comments: i.comments,
    updatedAt: i.updated_at,
    closedAt: i.closed_at,
  };
}

/**
 * Computes the target label ids + state for moving an issue into a board column.
 * target: { column: 'open' } | { column: 'closed' } | { column: 'label', labelId }
 * Mirrors GitLab: labels of the board's scope are removed, the target column's label is added.
 */
export function planMove(issueLabels, scope, target, scopeLabelIds) {
  const keep = issueLabels.filter((l) => scopeOf(l.name) !== scope).map((l) => l.id);
  if (target.column === 'label') {
    if (!scopeLabelIds.includes(target.labelId)) throw Object.assign(new Error('Label does not belong to the selected scope'), { code: 'label_not_in_scope' });
    return { labelIds: [...keep, target.labelId], state: 'open' };
  }
  if (target.column === 'closed') return { labelIds: keep, state: 'closed' };
  if (target.column === 'open') return { labelIds: keep, state: 'open' };
  throw Object.assign(new Error('Unknown target column'), { code: 'unknown_column' });
}

export function sameIds(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
