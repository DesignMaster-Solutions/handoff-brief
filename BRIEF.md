# Handoff Brief: build brief (Codegeist 2026, 3rd entry of Design Master Solutions LLC)

## Why this entry exists
- Codegeist 2026 (Atlassian, Devpost: https://codegeist2026.devpost.com/ , rules: /rules) pays 1st US$ 15,000,
  2nd US$ 8,000 and 3rd US$ 5,000 in EACH of 3 categories, plus 4 bonus pools of 6 x US$ 1,500.
- Our 2 entries cover Apps for Software Teams (Release Gate, bonus Marketplace) and Apps for Specialized
  Industries (Deadline Desk, bonus Atlassian MCP). Nothing of ours is in **Apps for Business Teams**, and nothing
  is in the **Best apps with Teamwork Graph integration** bonus ("connects data into the graph and/or consumes data
  from the TWG API").
- Rules allow multiple unique submissions per entrant; one submission can win 1 grand prize + 1 bonus.
- Deadline: 22/12/2026 17:00 BRT. Target: submitted by 15/11/2026, then polish.

## Judging (5 criteria, 20% each)
Technological Implementation (thorough use of Forge + at least one Atlassian capability: Jira, Confluence, JSM,
Bitbucket, Teamwork Graph, Rovo), Design (complete, coherent product, not a proof of concept), Potential Impact
(credible, specific real problem for a real audience, and the demo shows it solved), Innovation, Presentation
(video under 5 min shows it working end to end; pitch says problem, who, why).

## Product (default idea; change it only if the Teamwork Graph data cannot support it, and write why)
Business teams lose work and decisions when someone goes on leave, changes role or leaves. Handoff Brief uses the
Teamwork Graph to collect, for one person, what they own and touch across Jira and Confluence (open work items,
pages they own or were the last to edit, teams, goals/projects, recent comments) and turns it into a handoff brief:
what is open, what is at risk, who already works next to each item (suggested new owner from the graph), and a
Confluence handoff page plus reassignments that the manager approves item by item.
Surfaces: a Jira global/project page (UI Kit) and a Rovo agent with an action ("prepare the handoff for X").

## Teamwork Graph facts we already verified (05/11/2026, Impressora R376)
- TWG API is in Forge **Preview, open to all users**: no EAP needed (our FRGEAP-2350 request is moot).
- Endpoint on our site answered: POST https://dms-release-gate.atlassian.net/gateway/api/graphql/twg with
  `query dmsco_echoTest { echo(myString: "hello twg") }` -> `{"data":{"echo":"hello twg"}}`.
  The operation name MUST have the shape `company_operation` (company >= 3 chars, operation >= 4).
- With an API token (basic auth) `cypherQuery` is refused: "restricted and not available to this client. Use a
  persisted query via customQuery instead". From Forge, the documented path is
  `api.asUser().requestTeamworkGraph(query, variables)` (backend) or `requestTeamworkGraph` from `@forge/bridge`,
  with scopes like `read:graph:issue:jira` in the manifest. First step of the build: prove a Cypher read from
  inside the Forge app; if it is refused there too, use persisted Cypher queries (docs: /platform/teamwork-graph/
  persisted-cypher-queries/).
- Docs: https://developer.atlassian.com/platform/teamwork-graph/call-the-teamwork-graph-api/ ,
  /object-types/, /relationships/, /scopes/ .

## Where and how
- Forge, Developer Space "Design Master Solutions" (Atlassian account in the vault entry `atlassian:dms`; read the
  username with `cld vault get atlassian:dms --field username`, never type it in a command).
- Install and demo on dms-release-gate.atlassian.net (Jira + Confluence + JSM trials at US$ 0). Never add a
  payment method or upgrade anything paid.
- Copy patterns from ../release-gate and ../deadline-desk (UI Kit page, ESM resolver import fix 0583a48,
  node --test). Do not modify those two repos: they are live entries.
- Demo data must be real objects on the site (seeded issues/pages/teams), never invented numbers in the pitch.
- Deliver: public repo (MIT), README with judge instructions, install link (distribution "sharing"), video under
  5 min on the Design Master Solutions YouTube channel, new Devpost project under the DMS LLC organization,
  category Apps for Business Teams, bonus Best apps with Teamwork Graph integration, with the explanation of how
  the TWG API is used.
