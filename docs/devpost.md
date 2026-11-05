# Devpost text (Handoff Brief)

Tagline: When someone leaves, changes role or goes on leave, the Teamwork Graph already knows what they hold. Handoff Brief turns that into a handoff the manager approves item by item.

## Inspiration

On a business team the handoff is the moment work disappears. A person goes on parental leave or moves to another
team, and the manager rebuilds from memory what that person owned: which Jira items were theirs, which Confluence
pages only they kept up to date, who else was already close to each one. The information is all in Atlassian. It is
just spread across products, and nobody has time to stitch it together on someone's last day.

## What it does

Pick a person on the Handoff Brief page in Jira (or ask the Handoff Brief agent in Rovo). The app reads the Teamwork
Graph for that person and shows:

- every open work item assigned to them, with a risk: overdue, due within 7 days, or nobody else works on it;
- every Confluence page they created or own, flagged when they are the only author;
- their teams and goals;
- for each item, a suggested new owner and the evidence from the graph: commented on it, reported it, co-wrote the
  page, same team. The person leaving is never suggested.

The manager approves a suggestion with one click and the work item is reassigned in Jira. Then one more click
publishes the handoff page in a Confluence space, with every item, its risk and its new owner.

## How we built it

Forge app, UI Kit page (`jira:globalPage`), Rovo agent with two actions (prepare the brief, publish the page), Node 24
runtime, Runs on Atlassian (no egress).

How the Teamwork Graph API is used: every read goes through `api.asUser().requestTeamworkGraph`, so results are
permission-filtered for the manager. Raw `cypherQuery` is refused for new apps, so the app combines curated queries
(`atlassianUserAssignedJiraWorkItems`, `jiraWorkItemComments` batched with GraphQL aliases, `atlassianUserContent`,
`confluencePageContributors`, `atlassianUserGoalsAndProjects`) with two persisted Cypher queries registered for the
app and executed with `customQuery`: one walks user, team and teammates in a single traversal, the other walks the
pages the user owns and every co-author of each page. The scoring that picks the suggested owner is deterministic code
with unit tests; Rovo only explains the result.

## Challenges

The Teamwork Graph API is in preview. `cypherQuery` is closed to new apps, so the traversals the curated catalog does
not cover had to be registered as persisted queries. The org permission check of the preview API sometimes fails once
and passes on the next call, so the client retries only that error. A Jira page cannot reach Confluence with the
user's token, so the handoff page is written by the app, with granular Confluence scopes.

## What's next

Reassign pages too (Confluence page owner), include Loom videos and pull requests the person created (the graph
already has them), and a scheduled brief for managers when an out-of-office starts.


## Testing instructions

1. Install Handoff Brief with the installation link in the repository README (https://github.com/DesignMaster-Solutions/handoff-brief) on a Jira Cloud site; installing apps with Teamwork Graph scopes needs an organization admin. Install it in Confluence too when asked, for the handoff page.
2. In Jira, open **Apps > Handoff Brief** and pick a person in **Person**. The first time, Forge asks you to allow access on your behalf.
3. Approve a suggested owner on any work item (it is reassigned in Jira), then pick a space and **Publish in Confluence**.
4. In Rovo, change the agent to **Handoff Brief** and ask it to prepare the handoff for a person by name.

On a site where you are the only user, pick yourself: the brief lists your open work and pages, and the new owner says "nobody found", because the graph has nobody else next to those items. To see a suggestion, invite one colleague and have them comment on one of your work items; once the Teamwork Graph has the comment, the brief suggests them ("commented 1x"). If your site has no teams or goals, or the graph refuses one of the reads, the brief says which part could not be read and still lists the work and the pages. `scripts/seed-demo.mjs` in the repository creates the demo used in the video (project OPS, pages and comments, one phase per person).
