// Reads everything the Teamwork Graph knows about one person, as the user who runs the app.
// Curated queries for the typed traversals; two persisted Cypher queries (registered for this app,
// see scripts/register-queries.mjs) for the traversals the catalog does not cover in one call.

export const QUERY_KEYS = {
  teammates: 'aeab7437-a8cb-462b-a126-3ea722937d97', // user -> team <- members
  ownedPagesCoauthors: 'fd3362ee-7b48-44ea-900c-75f424b8dbe4', // user -owns-> page <-contributed- users
};

const USER = '... on AtlassianUser { accountId name }';
const ITEM = `... on JiraWorkItem { id key summary dueAt webUrl status { name statusCategory { key } } reporter { ${USER} } }`;
const PAGE = '... on ConfluencePage { id title webUrl lastUpdatedAt }';
const PAGE_LIMIT = 4; // shortcut: 4 pages x 25 rows per traversal; raise for people with more than 100 open items

export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;
const toUser = (u) => (u?.accountId ? { accountId: u.accountId, name: u.name ?? u.accountId } : null);

export function toItem(n) {
  return {
    id: n.id, key: n.key, summary: n.summary, dueAt: n.dueAt ?? null, webUrl: n.webUrl ?? null,
    status: { name: n.status?.name ?? '', statusCategory: (n.status?.statusCategory?.key ?? '').toUpperCase() },
    reporter: toUser(n.reporter),
  };
}

// Persisted query rows: one edge per row, one column per RETURN name.
export function rows(connection) {
  return (connection?.edges ?? []).map((e) => Object.fromEntries((e.node?.columns ?? []).map((c) => [c.key, c.value?.data ?? null])));
}

export function teamsFromRows(rowList) {
  const teams = new Map();
  for (const { t, m } of rowList) {
    if (!t?.id) continue;
    const team = teams.get(t.id) ?? { id: t.id, displayName: t.displayName, members: [] };
    const u = toUser(m);
    if (u && !team.members.some((x) => x.accountId === u.accountId)) team.members.push(u);
    teams.set(t.id, team);
  }
  return [...teams.values()];
}

export function createGraphClient(request) {
  async function gql(name, query, variables) {
    const { data, errors } = await request(`query dmsco_${name}${query}`, variables);
    if (errors?.length) throw new Error(`Teamwork Graph ${name}: ${errors.map((e) => e.message).join('; ')}`);
    return data;
  }

  async function paged(name, field, args, fragment, variables) {
    const out = [];
    let after = null;
    for (let i = 0; i < PAGE_LIMIT; i += 1) {
      const data = await gql(name, `(${args.decl}, $after: String) { ${field}(${args.call}, first: 25, after: $after) { edges { node { __typename ${fragment} } } pageInfo { hasNextPage endCursor } } }`,
        { ...variables, after });
      const conn = data[field];
      out.push(...(conn?.edges ?? []).map((e) => e.node).filter(Boolean));
      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return out;
  }

  async function custom(name, queryKey, queryParams) {
    const out = [];
    let after = null;
    for (let i = 0; i < PAGE_LIMIT; i += 1) {
      const data = await gql(name, `($k: String!, $p: CypherRequestParams, $after: String) { customQuery(queryKey: $k, queryParams: $p, first: 25, after: $after) {
        edges { node { columns { key value { __typename ... on CypherQueryResultNode { id data { __typename ${USER} ... on AtlassianTeam { id displayName } ${PAGE} } } } } } }
        pageInfo { hasNextPage endCursor } } }`, { k: queryKey, p: queryParams, after });
      out.push(...rows(data.customQuery));
      if (!data.customQuery?.pageInfo?.hasNextPage) break;
      after = data.customQuery.pageInfo.endCursor;
    }
    return out;
  }

  // One request for many objects: GraphQL aliases, one curated field per id.
  async function perObject(name, field, ids, extraArgs, fragment) {
    if (ids.length === 0) return {};
    const decl = ids.map((_, i) => `$i${i}: ID!`).join(', ');
    const body = ids.map((_, i) => `o${i}: ${field}(id: $i${i}${extraArgs}, first: 25) { edges { node { __typename ${fragment} } } }`).join(' ');
    const data = await gql(name, `(${decl}) { ${body} }`, Object.fromEntries(ids.map((id, i) => [`i${i}`, id])));
    return Object.fromEntries(ids.map((id, i) => [id, (data[`o${i}`]?.edges ?? []).map((e) => e.node)]));
  }

  return {
    async personGraph(person) {
      const u = { u: userAri(person.accountId) };
      const user = { decl: '$u: ID!', call: 'userId: $u' };
      const [assigned, content, teamRows, ownedRows, goals] = await Promise.all([
        paged('handoffAssignedWork', 'atlassianUserAssignedJiraWorkItems', user, ITEM, u),
        paged('handoffCreatedContent', 'atlassianUserContent', { decl: '$u: ID!', call: 'userId: $u, roles: [CREATED], since: "P365D"' }, PAGE, u),
        custom('handoffTeammates', QUERY_KEYS.teammates, { userId: u.u }),
        custom('handoffOwnedPages', QUERY_KEYS.ownedPagesCoauthors, { userId: u.u }),
        paged('handoffGoals', 'atlassianUserGoalsAndProjects', { decl: '$u: ID!', call: 'userId: $u, roles: [OWNS, CONTRIBUTES]' },
          '... on AtlassianGoal { id name url } ... on AtlassianProject { id name url }', u),
      ]);

      const workItems = assigned.filter((n) => n.__typename === 'JiraWorkItem').map(toItem);
      const open = workItems.filter((i) => i.status.statusCategory !== 'DONE');
      const commentsRaw = await perObject('handoffComments', 'jiraWorkItemComments', open.map((i) => i.id), ', since: "P180D"',
        `... on JiraWorkItemComment { author { ${USER} } }`);
      const comments = Object.fromEntries(Object.entries(commentsRaw).map(([id, list]) => [id, list.map((c) => ({ author: toUser(c.author) }))]));

      // Pages: created (curated) plus owned (persisted), with co-authors from the owned traversal or the curated field.
      const pages = new Map();
      for (const n of content.filter((x) => x.__typename === 'ConfluencePage')) pages.set(n.id, { ...n, contributors: [] });
      for (const { p, c } of ownedRows) {
        if (!p?.id) continue;
        const page = pages.get(p.id) ?? { ...p, contributors: [] };
        const cu = toUser(c);
        if (cu && !page.contributors.some((x) => x.accountId === cu.accountId)) page.contributors.push(cu);
        page.fromOwned = true;
        pages.set(p.id, page);
      }
      const missing = [...pages.values()].filter((p) => !p.fromOwned).map((p) => p.id);
      const contributors = await perObject('handoffPageContributors', 'confluencePageContributors', missing, '', USER);
      for (const [id, list] of Object.entries(contributors)) pages.get(id).contributors = list.map(toUser).filter(Boolean);

      return {
        person,
        workItems,
        comments,
        pages: [...pages.values()].map(({ fromOwned, ...p }) => p),
        teams: teamsFromRows(teamRows),
        goals: goals.filter((g) => g.id).map((g) => ({ id: g.id, name: g.name, url: g.url ?? null, __typename: g.__typename })),
      };
    },
  };
}
