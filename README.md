# Handoff Brief

When someone on a business team goes on leave, changes role or leaves, their work does not leave with a list.
It sits in Jira work items nobody else watches, in Confluence pages only they wrote, in teams and goals the
manager has to rebuild from memory. Handoff Brief is a Forge app for Jira that asks the **Teamwork Graph** what one
person owns and touches, and turns it into a handoff the manager can act on in minutes:

- every open work item assigned to them, with a risk (overdue, due within 7 days, nobody else works on it);
- every Confluence page they created or own, flagged when they are the only author;
- the teams and goals they are part of;
- for each item, the **suggested new owner** and the graph evidence behind it (commented on it, reported it,
  co-wrote the page, same team);
- an **Approve** button per work item that reassigns it, and a **Publish in Confluence** button that writes the
  handoff page.

The same brief is available in Rovo: the **Handoff Brief** agent answers "Prepare the handoff for Priya Nair" and can
publish the page after the user confirms.

## How the Teamwork Graph API is used

All reads run inside Forge as the user who opens the app (`api.asUser().requestTeamworkGraph`), so every row is
permission-filtered: a manager only sees what they can already see. Raw `cypherQuery` is refused for new apps
("use a persisted query via customQuery"), so the app uses the two supported paths:

| What | Teamwork Graph call |
|---|---|
| Work assigned to the person | curated `atlassianUserAssignedJiraWorkItems` (status, due date, reporter) |
| Who commented on each open item | curated `jiraWorkItemComments`, one aliased request for all items |
| Pages they created | curated `atlassianUserContent(roles: [CREATED])` |
| Who else wrote those pages | curated `confluencePageContributors` |
| Pages they own and their co-authors | persisted Cypher `owned-pages-coauthors`: `(user)-[:atlassian_user_owns_confluence_page]->(page)<-[:atlassian_user_contributed_to_confluence_page]-(coauthor)` |
| Their teams and teammates | persisted Cypher `teammates`: `(user)-[:atlassian_user_is_in_atlassian_team]->(team)<-[:atlassian_user_is_in_atlassian_team]-(member)` |
| Goals and projects | curated `atlassianUserGoalsAndProjects(roles: [OWNS, CONTRIBUTES])` |

The persisted queries are registered for this app (`POST /gateway/api/twg/cypher-queries`, keys in `src/graph.js`)
and executed with `customQuery`. Every GraphQL operation is named `dmsco_<operation>`, as the API requires.

The scoring is plain code (`src/brief.js`), not a model: a comment on the item is worth 3 points per comment, being the
reporter 2, co-writing the page 3, being in the same team 1. The person who is leaving is never suggested. Same graph
in, same brief out; Rovo only explains the result.

## For judges

1. Open the installation link (below) and install Handoff Brief on a Jira Cloud site (installing apps with Teamwork
   Graph scopes needs an organization admin). Install it in Confluence too when asked, for the handoff page.
2. In Jira, open **Apps > Handoff Brief**, pick a person in **Person**. The first time, Forge asks you to allow
   access on your behalf.
3. Approve a suggested owner on any work item (it is reassigned in Jira), then pick a space and **Publish in
   Confluence**.
4. In Rovo, change the agent to **Handoff Brief** and ask "Prepare the handoff for <name>".

Demo data: `scripts/seed-demo.mjs` creates the Finance Operations project (OPS), the work items and the pages used in
the video, in three phases (admin, the person leaving, a teammate), each with its own API token.

## Run

```bash
npm install
npm test                 # rules and graph parsing, no site needed
forge register && forge deploy && forge install --product jira && forge install --product confluence
```

Runs on Atlassian: no external egress, no storage outside Jira and Confluence. Scopes: `read:graph:*` for the
object types above, `read:jira-work`, `read:jira-user`, `write:jira-work` (reassign), `read:space:confluence`
and `write:page:confluence` (handoff page).

Built by Design Master Solutions LLC for Codegeist 2026 (Apps for Business Teams, Teamwork Graph). MIT.
