import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, handoffPageBody } from '../src/brief.js';

const NOW = new Date('2026-11-05T12:00:00Z');
const PRIYA = { id: 'ari:cloud:identity::user/p', accountId: 'p', name: 'Priya' };
const LEO = { id: 'ari:cloud:identity::user/l', accountId: 'l', name: 'Leo' };
const ANA = { id: 'ari:cloud:identity::user/a', accountId: 'a', name: 'Ana' };

const graph = {
  person: PRIYA,
  workItems: [
    { id: 'i1', key: 'OPS-1', summary: 'Renew vendor contract', status: { name: 'In Progress', statusCategory: 'IN_PROGRESS' },
      dueAt: '2026-11-01T00:00:00Z', reporter: ANA, webUrl: 'u1' },
    { id: 'i2', key: 'OPS-2', summary: 'Quarterly payroll check', status: { name: 'To Do', statusCategory: 'TO_DO' },
      dueAt: '2026-11-09T00:00:00Z', reporter: PRIYA, webUrl: 'u2' },
    { id: 'i3', key: 'OPS-3', summary: 'Old done task', status: { name: 'Done', statusCategory: 'DONE' }, reporter: ANA },
    { id: 'i4', key: 'OPS-4', summary: 'Nobody else here', status: { name: 'To Do', statusCategory: 'TO_DO' }, reporter: PRIYA },
  ],
  comments: { i1: [{ author: LEO }, { author: LEO }, { author: PRIYA }], i2: [{ author: ANA }] },
  pages: [
    { id: 'pg1', title: 'Vendor runbook', webUrl: 'w1', lastUpdatedAt: '2026-10-30T00:00:00Z', contributors: [PRIYA, LEO] },
    { id: 'pg2', title: 'Payroll calendar', webUrl: 'w2', lastUpdatedAt: '2026-06-01T00:00:00Z', contributors: [PRIYA] },
  ],
  teams: [{ id: 't1', displayName: 'Operations', members: [PRIYA, LEO, ANA] }],
  goals: [{ id: 'g1', name: 'Close Q4 books on time', __typename: 'AtlassianGoal' }],
};

test('only unfinished work goes into the brief', () => {
  const b = buildBrief(graph, NOW);
  assert.deepEqual(b.workItems.map((w) => w.key).sort(), ['OPS-1', 'OPS-2', 'OPS-4']);
});

test('suggested owner comes from graph evidence: comments beat reporter beat team', () => {
  const b = buildBrief(graph, NOW);
  const [ops1, ops2, ops4] = ['OPS-1', 'OPS-2', 'OPS-4'].map((k) => b.workItems.find((w) => w.key === k));
  assert.equal(ops1.suggested.name, 'Leo');
  assert.match(ops1.suggested.why, /commented 2x/);
  assert.equal(ops2.suggested.name, 'Ana');
  // OPS-4: nobody touched it, falls back to a teammate, alphabetical on ties
  assert.equal(ops4.suggested.name, 'Ana');
  assert.match(ops4.suggested.why, /Operations/);
});

test('the departing person is never suggested', () => {
  const b = buildBrief(graph, NOW);
  for (const w of [...b.workItems, ...b.pages]) assert.notEqual(w.suggested?.accountId, 'p');
});

test('risk: overdue and single-handed work are high, due within 7 days is medium', () => {
  const b = buildBrief(graph, NOW);
  const byKey = Object.fromEntries(b.workItems.map((w) => [w.key, w]));
  assert.equal(byKey['OPS-1'].risk, 'high');
  assert.ok(byKey['OPS-1'].reasons.includes('overdue 4 days'));
  assert.equal(byKey['OPS-2'].risk, 'medium');
  assert.ok(byKey['OPS-2'].reasons.includes('due in 4 days'));
  assert.equal(byKey['OPS-4'].risk, 'high');
  assert.ok(byKey['OPS-4'].reasons.includes('only the leaver works on it'));
});

test('items are sorted by risk, highest first', () => {
  const b = buildBrief(graph, NOW);
  assert.deepEqual(b.workItems.map((w) => w.risk), ['high', 'high', 'medium']);
});

test('pages: a page only the leaver wrote is at risk, a co-written one goes to the co-author', () => {
  const b = buildBrief(graph, NOW);
  const [runbook, payroll] = [b.pages.find((p) => p.id === 'pg1'), b.pages.find((p) => p.id === 'pg2')];
  assert.equal(runbook.suggested.name, 'Leo');
  assert.equal(runbook.risk, 'low');
  assert.equal(payroll.risk, 'high');
  assert.ok(payroll.reasons.includes('only the leaver wrote it'));
});

test('summary counts what is in the brief', () => {
  const b = buildBrief(graph, NOW);
  assert.deepEqual(b.summary, { openWork: 3, highRisk: 3, pages: 2, teams: 1, goals: 1, withoutSuccessor: 0 });
});

test('handoff page lists every item with the suggested owner and escapes HTML', () => {
  const g = { ...graph, workItems: [{ ...graph.workItems[0], summary: 'Fix <script> & stuff' }] };
  const html = handoffPageBody(buildBrief(g, NOW), NOW);
  assert.match(html, /OPS-1/);
  assert.match(html, /Fix &lt;script&gt; &amp; stuff/);
  assert.match(html, /Leo/);
  assert.match(html, /Vendor runbook/);
});

// Jira due dates are calendar dates: the afternoon of the due day is still "due today", not overdue.
test('risk wording counts calendar days: due today, 1 day (singular), overdue only from the next day', () => {
  const item = (key, dueAt) => ({ id: key, key, summary: key, status: { name: 'To Do', statusCategory: 'TO_DO' }, dueAt, reporter: ANA });
  const g = { ...graph, comments: {}, workItems: [item('D-0', '2026-11-05T00:00:00Z'), item('D-1', '2026-11-06T00:00:00Z'), item('D-2', '2026-11-04T00:00:00Z')] };
  const byKey = Object.fromEntries(buildBrief(g, new Date('2026-11-05T18:00:00Z')).workItems.map((w) => [w.key, w]));
  assert.deepEqual(byKey['D-0'].reasons, ['due today']);
  assert.equal(byKey['D-0'].risk, 'medium');
  assert.deepEqual(byKey['D-1'].reasons, ['due in 1 day']);
  assert.deepEqual(byKey['D-2'].reasons, ['overdue 1 day']);
});
