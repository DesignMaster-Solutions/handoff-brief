// Pure rules that turn what the Teamwork Graph knows about one person into a handoff brief.
// No I/O here: graph.js reads the graph, this file decides. Same graph in, same brief out.

const DAY = 86_400_000;
const RANK = { high: 0, medium: 1, low: 2 };

const isDone = (item) => (item.status?.statusCategory ?? '').toUpperCase() === 'DONE';
const days = (from, to) => Math.round((to - from) / DAY);

// Candidates for one object: who already works next to it, with the evidence. The leaver is never a candidate.
function pickSuccessor(leaverId, evidence) {
  const byId = new Map();
  for (const { user, points, why } of evidence) {
    if (!user?.accountId || user.accountId === leaverId) continue;
    const c = byId.get(user.accountId) ?? { accountId: user.accountId, name: user.name, score: 0, why: [] };
    c.score += points;
    c.why.push(why);
    byId.set(user.accountId, c);
  }
  const best = [...byId.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0];
  return best ? { accountId: best.accountId, name: best.name, why: best.why.join(', ') } : null;
}

function teamEvidence(graph) {
  return graph.teams.flatMap((t) => t.members.map((user) => ({ user, points: 1, why: `same team: ${t.displayName}` })));
}

function workItemEntry(graph, item, now, teammates) {
  const leaverId = graph.person.accountId;
  const comments = graph.comments[item.id] ?? [];
  const counts = new Map();
  for (const c of comments) {
    if (!c.author?.accountId || c.author.accountId === leaverId) continue;
    const prev = counts.get(c.author.accountId) ?? { user: c.author, n: 0 };
    prev.n += 1;
    counts.set(c.author.accountId, prev);
  }
  const direct = [...counts.values()].map(({ user, n }) => ({ user, points: 3 * n, why: `commented ${n}x` }));
  if (item.reporter && item.reporter.accountId !== leaverId) direct.push({ user: item.reporter, points: 2, why: 'reported it' });

  const reasons = [];
  if (item.dueAt) {
    const d = days(now, new Date(item.dueAt));
    if (d < 0) reasons.push(`overdue ${-d} days`);
    else if (d <= 7) reasons.push(`due in ${d} days`);
  }
  if (direct.length === 0) reasons.push('only the leaver works on it');
  const risk = reasons.some((r) => r.startsWith('overdue') || r.startsWith('only')) ? 'high' : reasons.length ? 'medium' : 'low';

  return {
    id: item.id, key: item.key, summary: item.summary, status: item.status?.name ?? '', dueAt: item.dueAt ?? null,
    webUrl: item.webUrl ?? null, risk, reasons,
    suggested: pickSuccessor(leaverId, [...direct, ...teammates]),
  };
}

function pageEntry(graph, page, teammates) {
  const leaverId = graph.person.accountId;
  const coauthors = (page.contributors ?? []).filter((u) => u.accountId !== leaverId);
  const reasons = coauthors.length ? [] : ['only the leaver wrote it'];
  return {
    id: page.id, title: page.title, webUrl: page.webUrl ?? null, lastUpdatedAt: page.lastUpdatedAt ?? null,
    risk: coauthors.length ? 'low' : 'high', reasons,
    suggested: pickSuccessor(leaverId, [...coauthors.map((user) => ({ user, points: 3, why: 'co-wrote the page' })), ...teammates]),
  };
}

const byRisk = (a, b) => RANK[a.risk] - RANK[b.risk];

export function buildBrief(graph, now = new Date()) {
  const teammates = teamEvidence(graph);
  const workItems = graph.workItems.filter((i) => !isDone(i)).map((i) => workItemEntry(graph, i, now, teammates)).sort(byRisk);
  const pages = graph.pages.map((p) => pageEntry(graph, p, teammates)).sort(byRisk);
  const all = [...workItems, ...pages];
  return {
    person: graph.person,
    workItems,
    pages,
    teams: graph.teams.map((t) => ({ id: t.id, displayName: t.displayName, members: t.members.length })),
    goals: graph.goals,
    summary: {
      openWork: workItems.length,
      highRisk: all.filter((x) => x.risk === 'high').length,
      pages: pages.length,
      teams: graph.teams.length,
      goals: graph.goals.length,
      withoutSuccessor: all.filter((x) => !x.suggested).length,
    },
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const owner = (s) => (s ? `${esc(s.name)} (${esc(s.why)})` : 'nobody found: pick one');

// Confluence storage format for the handoff page.
export function handoffPageBody(brief, now = new Date()) {
  const s = brief.summary;
  const work = brief.workItems.map((w) => `<tr><td><a href="${esc(w.webUrl)}">${esc(w.key)}</a> ${esc(w.summary)}</td>`
    + `<td>${esc(w.status)}</td><td>${esc(w.risk)}${w.reasons.length ? `: ${esc(w.reasons.join(', '))}` : ''}</td><td>${owner(w.suggested)}</td></tr>`).join('');
  const pages = brief.pages.map((p) => `<tr><td><a href="${esc(p.webUrl)}">${esc(p.title)}</a></td>`
    + `<td>${esc(p.risk)}${p.reasons.length ? `: ${esc(p.reasons.join(', '))}` : ''}</td><td>${owner(p.suggested)}</td></tr>`).join('');
  return [
    `<p>Handoff brief for <strong>${esc(brief.person.name)}</strong>, prepared ${now.toISOString().slice(0, 10)} by Handoff Brief from the Teamwork Graph.</p>`,
    `<p>${s.openWork} open work items, ${s.pages} pages, ${s.highRisk} at high risk, ${s.withoutSuccessor} without a suggested owner.</p>`,
    '<h2>Open work</h2>',
    `<table><tbody><tr><th>Work item</th><th>Status</th><th>Risk</th><th>Suggested owner (evidence)</th></tr>${work}</tbody></table>`,
    '<h2>Pages they wrote</h2>',
    `<table><tbody><tr><th>Page</th><th>Risk</th><th>Suggested keeper (evidence)</th></tr>${pages}</tbody></table>`,
    '<h2>Teams and goals</h2>',
    `<ul>${brief.teams.map((t) => `<li>Team ${esc(t.displayName)} (${t.members} members)</li>`).join('')}`
    + `${brief.goals.map((g) => `<li>${esc(g.__typename === 'AtlassianProject' ? 'Project' : 'Goal')} ${esc(g.name)}</li>`).join('')}</ul>`,
  ].join('');
}
