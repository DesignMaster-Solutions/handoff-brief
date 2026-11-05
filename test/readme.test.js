import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUERY_KEYS } from '../src/graph.js';

// The persisted queries live on Atlassian's side; the README is the only copy of their text and of the RETURN names.
test('README carries the key and exact Cypher of every persisted query the code calls', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const key of Object.values(QUERY_KEYS)) assert.ok(readme.includes(key), `README is missing query key ${key}`);
  assert.match(readme, /-\(m:AtlassianUser\) RETURN t, m/);
  assert.match(readme, /-\(c:AtlassianUser\) RETURN p, c/);
});
