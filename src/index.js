import api, { route } from '@forge/api';
import ResolverModule from '@forge/resolver';
import { buildBrief, handoffPageBody } from './brief.js';
import { createGraphClient } from './graph.js';

// @forge/resolver is CommonJS with exports.default: an ESM default import gets the whole module object.
const Resolver = ResolverModule.default ?? ResolverModule;

const graph = createGraphClient(async (query, variables) => {
  const res = await api.asUser().requestTeamworkGraph(query, variables);
  if (!res.ok) throw new Error(`Teamwork Graph HTTP ${res.status}: ${await res.text()}`);
  return res.json();
});

async function product(kind, path, init) {
  // Confluence calls go as the app: the page lives in Jira, where a user token cannot reach Confluence.
  const req = kind === 'jira' ? api.asUser().requestJira(path, init) : api.asApp().requestConfluence(path, init);
  const res = await req;
  if (!res.ok) throw new Error(`${kind} ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const JSON_INIT = (method, body) => ({ method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Rovo passes a name ("Priya"), the page passes an accountId.
export async function resolvePerson(person) {
  const q = String(person ?? '').trim();
  if (!q) throw new Error('Ask the user who is leaving (a name or an Atlassian account).');
  const exact = /^[0-9]{6}:[0-9a-f-]{36}$|^[0-9a-f]{24}$/.test(q);
  const found = exact
    ? [await product('jira', route`/rest/api/3/user?accountId=${q}`)]
    : await product('jira', route`/rest/api/3/user/search?query=${q}&maxResults=5`);
  const people = found.filter((u) => u?.accountType === 'atlassian' && u.active !== false);
  if (people.length === 0) throw new Error(`Nobody called "${q}" on this site.`);
  if (people.length > 1 && !exact) {
    const same = people.filter((u) => u.displayName.toLowerCase() === q.toLowerCase());
    if (same.length !== 1) throw new Error(`More than one person matches "${q}": ${people.map((u) => u.displayName).join(', ')}. Ask which one.`);
    return { accountId: same[0].accountId, name: same[0].displayName };
  }
  return { accountId: people[0].accountId, name: people[0].displayName };
}

async function brief(person) {
  return buildBrief(await graph.personGraph(await resolvePerson(person)));
}

export async function prepareHandoff(payload) {
  try {
    return await brief(payload.person);
  } catch (e) {
    return { error: e.message };
  }
}

async function publish(person, spaceKey) {
  const b = await brief(person);
  const key = String(spaceKey ?? '').trim().toUpperCase();
  if (!key) throw new Error('Ask the user in which Confluence space the handoff page goes (space key).');
  const spaces = await product('confluence', route`/wiki/api/v2/spaces?keys=${key}`);
  const space = spaces.results?.[0];
  if (!space) throw new Error(`Confluence space ${key} not found.`);
  const now = new Date();
  const page = await product('confluence', route`/wiki/api/v2/pages`, JSON_INIT('POST', {
    spaceId: space.id, status: 'current', title: `Handoff: ${b.person.name} (${now.toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    body: { representation: 'storage', value: handoffPageBody(b, now) },
  }));
  return { title: page.title, url: `${page._links.base}${page._links.webui}`, summary: b.summary };
}

export async function publishHandoffPage(payload) {
  try {
    return await publish(payload.person, payload.spaceKey);
  } catch (e) {
    return { error: e.message };
  }
}

// Jira page (UI Kit): same brief as the agent, plus the manager's item-by-item approvals.
const resolver = new Resolver();
resolver.define('brief', ({ payload }) => prepareHandoff(payload));
resolver.define('spaces', async () => {
  const res = await product('confluence', route`/wiki/api/v2/spaces?type=global&limit=50`);
  return res.results.map((s) => ({ key: s.key, name: s.name }));
});
resolver.define('reassign', async ({ payload }) => {
  await product('jira', route`/rest/api/3/issue/${payload.key}/assignee`, JSON_INIT('PUT', { accountId: payload.accountId }));
  return { ok: true };
});
resolver.define('publish', async ({ payload }) => {
  try {
    return await publish(payload.person, payload.spaceKey);
  } catch (e) {
    return { error: e.message };
  }
});
export const handler = resolver.getDefinitions();
