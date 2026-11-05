import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DynamicTable, Heading, Inline, Link, Lozenge, SectionMessage, Select, Spinner, Stack, Text, UserPicker,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const APPEARANCE = { high: 'removed', medium: 'moved', low: 'success' };
const riskCell = (x) => (
  <Stack space="space.050">
    <Lozenge appearance={APPEARANCE[x.risk]}>{x.risk}</Lozenge>
    {x.reasons.length ? <Text size="small">{x.reasons.join(', ')}</Text> : null}
  </Stack>
);
const ownerCell = (s) => (s ? <Stack space="space.050"><Text weight="bold">{s.name}</Text><Text size="small">{s.why}</Text></Stack> : <Text>nobody found</Text>);

function WorkTable({ items, person }) {
  const [done, setDone] = useState({});
  const approve = async (w) => {
    setDone((d) => ({ ...d, [w.key]: 'saving' }));
    try {
      await invoke('reassign', { key: w.key, accountId: w.suggested.accountId });
      setDone((d) => ({ ...d, [w.key]: `assigned to ${w.suggested.name}` }));
    } catch (e) {
      setDone((d) => ({ ...d, [w.key]: `failed: ${String(e?.message ?? e)}` }));
    }
  };
  const head = { cells: ['Work item', 'Status', 'Risk', 'Suggested owner (graph evidence)', 'Manager'].map((c) => ({ key: c, content: c })) };
  const rows = items.map((w) => ({
    key: w.key,
    cells: [
      { key: 'item', content: <Stack space="space.050"><Link href={w.webUrl ?? '#'}>{w.key}</Link><Text>{w.summary}</Text></Stack> },
      { key: 'status', content: w.status },
      { key: 'risk', content: riskCell(w) },
      { key: 'owner', content: ownerCell(w.suggested) },
      {
        key: 'act',
        content: done[w.key] && done[w.key] !== 'saving'
          ? <Text>{done[w.key]}</Text>
          : w.suggested
            ? <Button appearance="primary" isDisabled={done[w.key] === 'saving'} onClick={() => approve(w)}>Approve</Button>
            : <Text>{`stays with ${person}`}</Text>,
      },
    ],
  }));
  return <DynamicTable caption="Open work, highest risk first" head={head} rows={rows} emptyView="No open work assigned." />;
}

function PagesTable({ pages }) {
  const head = { cells: ['Page', 'Last updated', 'Risk', 'Suggested keeper (graph evidence)'].map((c) => ({ key: c, content: c })) };
  const rows = pages.map((p) => ({
    key: p.id,
    cells: [
      { key: 'page', content: <Link href={p.webUrl ?? '#'}>{p.title}</Link> },
      { key: 'when', content: (p.lastUpdatedAt ?? '').slice(0, 10) },
      { key: 'risk', content: riskCell(p) },
      { key: 'owner', content: ownerCell(p.suggested) },
    ],
  }));
  return <DynamicTable caption="Confluence pages they created or own" head={head} rows={rows} emptyView="No pages found." />;
}

function Publish({ person }) {
  const [spaces, setSpaces] = useState([]);
  const [space, setSpace] = useState(null);
  const [state, setState] = useState(null);
  useEffect(() => { invoke('spaces').then(setSpaces, () => setSpaces([])); }, []);
  const go = async () => {
    setState({ busy: true });
    setState(await invoke('publish', { person, spaceKey: space.value }).catch((e) => ({ error: String(e?.message ?? e) })));
  };
  return (
    <Stack space="space.100">
      <Heading as="h3" size="small">Handoff page</Heading>
      <Inline space="space.100" alignBlock="center">
        <Box xcss={{ width: '260px' }}>
          <Select placeholder="Confluence space" options={spaces.map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }))} onChange={setSpace} />
        </Box>
        <Button appearance="primary" isDisabled={!space || state?.busy} onClick={go}>Publish in Confluence</Button>
      </Inline>
      {state?.url ? <SectionMessage appearance="success" title="Handoff page published"><Link href={state.url}>{state.title}</Link></SectionMessage> : null}
      {state?.error ? <SectionMessage appearance="error" title="Could not publish"><Text>{state.error}</Text></SectionMessage> : null}
    </Stack>
  );
}

function App() {
  const [person, setPerson] = useState(null);
  const [result, setResult] = useState(null);
  const load = (p) => {
    setPerson(p);
    setResult(null);
    if (p?.id) invoke('brief', { person: p.id }).then(setResult, (e) => setResult({ error: String(e?.message ?? e) }));
  };
  const s = result?.summary;
  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading as="h2" size="medium">Who is leaving, changing role or going on leave?</Heading>
        <Text>Handoff Brief reads the Teamwork Graph for that person: open Jira work, Confluence pages, teams and goals, and who already works next to each item.</Text>
        <Box xcss={{ maxWidth: '360px' }}>
          <UserPicker label="Person" name="person" placeholder="Pick a person" onChange={load} />
        </Box>
      </Stack>
      {person && !result ? <Spinner label="Reading the Teamwork Graph" /> : null}
      {result?.error ? <SectionMessage appearance="warning" title="Could not prepare the handoff"><Text>{result.error}</Text></SectionMessage> : null}
      {s ? (
        <Stack space="space.300">
          <SectionMessage appearance={s.highRisk ? 'warning' : 'information'} title={`Handoff for ${result.person.name}`}>
            <Text>{`${n(s.openWork, 'open work item')}, ${n(s.pages, 'page')}, ${n(s.teams, 'team')}, ${n(s.goals, 'goal or project', 'goals or projects')}. ${s.highRisk} at high risk, ${s.withoutSuccessor} without a suggested owner.`}</Text>
          </SectionMessage>
          {result.warnings?.length ? (
            <SectionMessage appearance="warning" title="Part of the Teamwork Graph could not be read on this site">
              <Text>{result.warnings.join(' · ')}</Text>
            </SectionMessage>
          ) : null}
          <WorkTable items={result.workItems} person={result.person.name} />
          <PagesTable pages={result.pages} />
          <Text>{`Teams: ${result.teams.map((t) => `${t.displayName} (${t.members})`).join(', ') || 'none'}. Goals and projects: ${result.goals.map((g) => g.name).join(', ') || 'none'}.`}</Text>
          <Publish person={result.person.accountId} />
        </Stack>
      ) : null}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
