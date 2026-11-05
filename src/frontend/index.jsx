import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Code, Heading, Spinner, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  const [r, setR] = useState(null);
  useEffect(() => { invoke('probe').then(setR, (e) => setR({ error: String(e?.message ?? e) })); }, []);
  if (!r) return <Spinner label="Reading the Teamwork Graph" />;
  return (
    <Stack space="space.200">
      <Heading as="h2" size="medium">Teamwork Graph probe</Heading>
      <Code>{JSON.stringify(r, null, 1)}</Code>
    </Stack>
  );
}
ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
