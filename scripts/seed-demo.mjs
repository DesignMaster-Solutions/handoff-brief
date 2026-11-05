// Seeds the demo: a Finance Operations team where Priya is about to go on leave.
// Real objects through the REST APIs, so the Teamwork Graph has real work, pages, comments and a team to read.
//
//   SITE=https://x.atlassian.net EMAIL=<admin> TOKEN=<admin token> PRIYA=<accountId> LEO=<accountId> \
//     node scripts/seed-demo.mjs admin            # project OPS, team, work items, admin comments
//   SITE=... EMAIL=<priya> TOKEN=<priya token> node scripts/seed-demo.mjs priya   # Priya writes her pages
//   SITE=... EMAIL=<leo> TOKEN=<leo token> node scripts/seed-demo.mjs leo         # Leo comments and co-edits
// Each phase is idempotent: it looks objects up by summary/title before creating them.

export const ITEMS = [
  { summary: 'Renew payroll provider contract before it auto-renews', due: -3, reporter: 'LEO',
    leoComments: ['I have the new quote from the provider, 6% higher. Can we talk before Friday?', 'Legal says we need 30 days notice, so this is urgent now.'] },
  { summary: 'Prepare the November month-end close checklist', due: 4, reporter: 'ADMIN',
    adminComments: ['Please include the new card reconciliation step this month.'] },
  { summary: 'Collect W-9 forms from the three new vendors', due: 20, reporter: 'PRIYA' },
  { summary: 'Update the travel expense policy for 2027', reporter: 'LEO', leoComments: ['Draft numbers for per diem are in the policy page.'] },
  { summary: 'Onboard the new office cleaning vendor', due: 10, reporter: 'ADMIN' },
  { summary: 'Reconcile October corporate card statements', due: -10, reporter: 'ADMIN', done: true },
];

export const PAGES = [
  { title: 'Payroll calendar 2027', body: '<p>Pay dates, cut-off dates and who approves each run.</p><table><tbody><tr><th>Run</th><th>Cut-off</th><th>Pay date</th></tr><tr><td>January 1</td><td>Jan 8</td><td>Jan 15</td></tr><tr><td>January 2</td><td>Jan 22</td><td>Jan 29</td></tr></tbody></table>', leoEdits: true },
  { title: 'Vendor contracts runbook', body: '<p>Where each vendor contract lives, its renewal date and the notice period.</p><ul><li>Payroll provider: renews Dec 1, 30 days notice.</li><li>Cleaning: month to month.</li></ul>' },
  { title: 'Month-end close checklist', body: '<ol><li>Bank reconciliation</li><li>Corporate card reconciliation</li><li>Accruals</li><li>Review with the controller</li></ol>' },
];

const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function client() {
  const { SITE, EMAIL, TOKEN } = process.env;
  if (!SITE || !EMAIL || !TOKEN) throw new Error('set SITE, EMAIL and TOKEN');
  const auth = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
  return async (method, path, body) => {
    const r = await fetch(`${SITE}${path}`, {
      method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
}

const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function findIssue(api, summary) {
  const res = await api('POST', '/rest/api/3/search/jql', { jql: `project = OPS AND summary ~ "\\"${summary}\\""`, fields: ['summary'], maxResults: 5 });
  return res.issues.find((i) => i.fields.summary === summary);
}

async function comment(api, key, text) {
  const { comments } = await api('GET', `/rest/api/3/issue/${key}/comment`);
  const plain = (c) => JSON.stringify(c.body);
  if (comments.some((c) => plain(c).includes(text.slice(0, 40)))) return;
  await api('POST', `/rest/api/3/issue/${key}/comment`, { body: adf(text) });
}

async function admin(api) {
  const { PRIYA, LEO } = process.env;
  if (!PRIYA || !LEO) throw new Error('set PRIYA and LEO account ids');
  const me = await api('GET', '/rest/api/3/myself');
  const who = { PRIYA, LEO, ADMIN: me.accountId };
  let project = await api('GET', '/rest/api/3/project/search?keys=OPS').then((r) => r.values[0]);
  if (!project) {
    project = await api('POST', '/rest/api/3/project', {
      key: 'OPS', name: 'Finance Operations', projectTypeKey: 'business', leadAccountId: me.accountId,
      projectTemplateKey: 'com.atlassian.jira-core-project-templates:jira-core-simplified-task-tracking',
    });
  }
  for (const i of ITEMS) {
    let issue = await findIssue(api, i.summary);
    if (!issue) {
      const fields = { project: { key: 'OPS' }, summary: i.summary, issuetype: { name: 'Task' }, assignee: { accountId: PRIYA } };
      if (i.due !== undefined) fields.duedate = day(i.due);
      issue = await api('POST', '/rest/api/3/issue', { fields });
      if (i.done) {
        const { transitions } = await api('GET', `/rest/api/3/issue/${issue.key}/transitions`);
        const t = transitions.find((x) => x.to?.statusCategory?.key === 'done');
        if (t) await api('POST', `/rest/api/3/issue/${issue.key}/transitions`, { transition: { id: t.id } });
      }
    }
    // Business projects keep reporter off the create screen; edit sets it (needs Modify Reporter for the admin).
    const { fields: f } = await api('GET', `/rest/api/3/issue/${issue.key}?fields=reporter`);
    if (f.reporter?.accountId !== who[i.reporter]) await api('PUT', `/rest/api/3/issue/${issue.key}`, { fields: { reporter: { accountId: who[i.reporter] } } });
    for (const text of i.adminComments ?? []) await comment(api, issue.key, text);
    console.log('admin', issue.key, i.summary);
  }
}

async function space(api) {
  const res = await api('GET', '/wiki/api/v2/spaces?keys=FINOPS');
  if (res.results[0]) return res.results[0];
  return api('POST', '/wiki/api/v2/spaces', { key: 'FINOPS', name: 'Finance Operations' });
}

async function findPage(api, spaceId, title) {
  const res = await api('GET', `/wiki/api/v2/spaces/${spaceId}/pages?title=${encodeURIComponent(title)}`);
  return res.results[0];
}

async function priya(api) {
  const s = await space(api);
  for (const p of PAGES) {
    const page = await findPage(api, s.id, p.title)
      ?? await api('POST', '/wiki/api/v2/pages', { spaceId: s.id, status: 'current', title: p.title, body: { representation: 'storage', value: p.body } });
    console.log('priya page', page.id, p.title);
  }
}

async function leo(api) {
  for (const i of ITEMS) {
    if (!i.leoComments) continue;
    const issue = await findIssue(api, i.summary);
    for (const text of i.leoComments) await comment(api, issue.key, text);
    console.log('leo commented', issue.key);
  }
  const s = await space(api);
  for (const p of PAGES.filter((x) => x.leoEdits)) {
    const page = await api('GET', `/wiki/api/v2/pages/${(await findPage(api, s.id, p.title)).id}?body-format=storage`);
    const note = '<p>Leo: added the February runs after the call with the provider.</p>';
    if (page.body.storage.value.includes(note)) continue;
    await api('PUT', `/wiki/api/v2/pages/${page.id}`, {
      id: page.id, status: 'current', title: page.title, body: { representation: 'storage', value: page.body.storage.value + note },
      version: { number: page.version.number + 1, message: 'February runs' },
    });
    console.log('leo edited', p.title);
  }
}

const PHASES = { admin, priya, leo };
if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = PHASES[process.argv[2]];
  if (!phase) { console.error('usage: node scripts/seed-demo.mjs admin|priya|leo'); process.exit(1); }
  phase(client()).catch((e) => { console.error(e.message); process.exit(1); });
}
