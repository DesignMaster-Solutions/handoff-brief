import api from '@forge/api';
import ResolverModule from '@forge/resolver';

// @forge/resolver is CommonJS with exports.default: an ESM default import gets the whole module object.
const Resolver = ResolverModule.default ?? ResolverModule;

async function twg(query, variables) {
  const res = await api.asUser().requestTeamworkGraph(query, variables);
  return { status: res.status, body: await res.json() };
}

const resolver = new Resolver();
resolver.define('probe', async ({ context }) => {
  const userId = `ari:cloud:identity::user/${context.accountId}`;
  const curated = await twg(`query dmsco_handoffProbe($u: ID!) {
    atlassianUserAssignedJiraWorkItems(userId: $u, first: 5) { edges { node { __typename ... on JiraWorkItem { key summary status { name } } } } }
    atlassianUserInTeams(userId: $u) { edges { node { __typename ... on AtlassianTeam { id displayName } } } }
  }`, { u: userId });
  const cypher = await twg(`query dmsco_cypherProbe($q: String!, $p: CypherRequestParams) {
    cypherQuery(query: $q, params: $p, first: 5) { edges { node { columns { key value { __typename ... on CypherQueryResultNode { id } } } } } }
  }`, { q: 'MATCH (u:AtlassianUser {ari: $id})-[:atlassian_user_assigned_jira_work_item]->(i:JiraWorkItem) RETURN i', p: { id: userId } });
  return { userId, curated, cypher };
});
export const handler = resolver.getDefinitions();
