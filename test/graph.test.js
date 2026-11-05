import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient, rows, teamsFromRows, toItem } from '../src/graph.js';

test('toItem flattens the status category key', () => {
  const i = toItem({ id: 'x', key: 'OPS-1', summary: 's', status: { name: 'Done', statusCategory: { key: 'done' } }, reporter: { accountId: 'a', name: 'Ana' } });
  assert.equal(i.status.statusCategory, 'DONE');
  assert.deepEqual(i.reporter, { accountId: 'a', name: 'Ana' });
});

test('persisted query rows become one team with unique members', () => {
  const conn = { edges: [
    { node: { columns: [{ key: 't', value: { data: { id: 't1', displayName: 'Ops' } } }, { key: 'm', value: { data: { accountId: 'a', name: 'Ana' } } }] } },
    { node: { columns: [{ key: 't', value: { data: { id: 't1', displayName: 'Ops' } } }, { key: 'm', value: { data: { accountId: 'a', name: 'Ana' } } }] } },
    { node: { columns: [{ key: 't', value: { data: { id: 't1', displayName: 'Ops' } } }, { key: 'm', value: { data: { accountId: 'l', name: 'Leo' } } }] } },
  ] };
  assert.deepEqual(teamsFromRows(rows(conn)), [{ id: 't1', displayName: 'Ops', members: [{ accountId: 'a', name: 'Ana' }, { accountId: 'l', name: 'Leo' }] }]);
});

test('personGraph names every operation company_operation and merges owned pages with co-authors', async () => {
  const names = [];
  const empty = { edges: [], pageInfo: { hasNextPage: false } };
  const request = async (query) => {
    names.push(query.match(/^query (\w+)/)[1]);
    if (query.includes('atlassianUserAssignedJiraWorkItems')) return { data: { atlassianUserAssignedJiraWorkItems: { edges: [
      { node: { __typename: 'JiraWorkItem', id: 'i1', key: 'OPS-1', status: { name: 'To Do', statusCategory: { key: 'new' } } } }], pageInfo: { hasNextPage: false } } } };
    if (query.includes('customQuery') && query.includes('handoffOwnedPages')) return { data: { customQuery: { edges: [
      { node: { columns: [{ key: 'p', value: { data: { id: 'pg1', title: 'Runbook' } } }, { key: 'c', value: { data: { accountId: 'l', name: 'Leo' } } }] } }], pageInfo: { hasNextPage: false } } } };
    if (query.includes('customQuery')) return { data: { customQuery: empty } };
    if (query.includes('jiraWorkItemComments')) return { data: { o0: { edges: [{ node: { author: { accountId: 'l', name: 'Leo' } } }] } } };
    const field = query.match(/\{ (\w+)\(/)[1];
    return { data: { [field]: empty } };
  };
  const g = await createGraphClient(request).personGraph({ accountId: 'p', name: 'Priya' });
  assert.ok(names.every((n) => /^dmsco_[a-zA-Z]{4,}$/.test(n)), names.join(','));
  assert.deepEqual(g.pages, [{ id: 'pg1', title: 'Runbook', contributors: [{ accountId: 'l', name: 'Leo' }] }]);
  assert.deepEqual(g.comments, { i1: [{ author: { accountId: 'l', name: 'Leo' } }] });
});

test('a transient org permission error is retried, any other error surfaces', async () => {
  let calls = 0;
  const flaky = async (query) => {
    calls += 1;
    if (calls === 1) return { errors: [{ message: 'User is not permitted to query this organization' }] };
    const field = query.match(/\{ (\w+)\(/)?.[1] ?? 'customQuery';
    return { data: { [field]: { edges: [], pageInfo: { hasNextPage: false } }, customQuery: { edges: [] } } };
  };
  await createGraphClient(flaky).personGraph({ accountId: 'p', name: 'P' });
  const broken = async () => ({ errors: [{ message: 'Cannot query field "x"' }] });
  await assert.rejects(createGraphClient(broken).personGraph({ accountId: 'p', name: 'P' }), /Cannot query field/);
});

test('an optional section that fails becomes a warning and the brief keeps the work and pages', async () => {
  const empty = { edges: [], pageInfo: { hasNextPage: false } };
  const request = async (query) => {
    if (query.includes('customQuery')) return { errors: [{ message: "Persisted Cypher execution isn't enabled for this caller or environment" }] };
    if (query.includes('atlassianUserGoalsAndProjects')) return { errors: [{ message: 'Goals are not available on this site' }] };
    if (query.includes('atlassianUserAssignedJiraWorkItems')) return { data: { atlassianUserAssignedJiraWorkItems: { edges: [
      { node: { __typename: 'JiraWorkItem', id: 'i1', key: 'OPS-1', status: { name: 'To Do', statusCategory: { key: 'new' } } } }], pageInfo: { hasNextPage: false } } } };
    if (query.includes('jiraWorkItemComments')) return { data: { o0: { edges: [] } } };
    const field = query.match(/\{ (\w+)\(/)[1];
    return { data: { [field]: empty } };
  };
  const g = await createGraphClient(request).personGraph({ accountId: 'p', name: 'Priya' });
  assert.equal(g.workItems.length, 1);
  assert.deepEqual([g.teams, g.goals], [[], []]);
  assert.deepEqual(g.warnings.map((w) => w.split(':')[0]).sort(), ['Goals and projects', 'Pages they own', 'Teams']);
});
