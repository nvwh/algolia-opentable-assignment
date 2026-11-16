// Applies search-config/*.json to Algolia. Plumbing only: the JSON files are the configuration.
import { readFile } from 'node:fs/promises';
import { algoliasearch } from 'algoliasearch';

const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY } = process.env;
if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_KEY) {
  console.error('Missing ALGOLIA_APP_ID and/or ALGOLIA_ADMIN_KEY. Set them in .env.');
  process.exit(1);
}

const load = async (f) => JSON.parse(await readFile(new URL(`../search-config/${f}`, import.meta.url), 'utf8'));
const contract = await load('contract.json');
const settings = await load('index-settings.json');
const replicas = await load('replicas.json');
const synonyms = await load('synonyms.json');

const indexName = contract.index;
const replicaNames = Object.keys(contract.replicas);
const missing = replicaNames.filter((n) => !replicas[n]);
if (missing.length) {
  console.error(`replicas.json has no entry for: ${missing.join(', ')}`);
  process.exit(1);
}

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY);
// Writes are async tasks: wait so the next step sees the result. Log each step so a slow one is visible,
// and cap the wait (~1 min) so a stuck task fails with a message instead of polling for minutes.
const done = async (name, { taskID }) => {
  const t = Date.now();
  process.stdout.write(`  waiting for task ${taskID} on ${name}... `);
  await client.waitForTask({ indexName: name, taskID, maxRetries: 30, timeout: () => 2000 });
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};

// Preflight: one cheap call that fails fast on a wrong app ID, a non-admin key or a blocked network.
console.log(`App ${ALGOLIA_APP_ID}: checking access...`);
try {
  const { items } = await client.listIndices();
  console.log(`  ok, ${items.length} index(es) in the app`);
} catch (error) {
  console.error(`  failed: ${error.message}`);
  console.error('  Check ALGOLIA_APP_ID, that ALGOLIA_ADMIN_KEY is the Admin key (not the search key), and that this network allows *.algolia.net.');
  process.exit(1);
}

console.log(`1/3 settings on ${indexName} (creates ${replicaNames.length} replicas)`);
// 1. Main index first: declaring `replicas` is what creates them. Replicas copy settings only at
//    creation, so forwardToReplicas keeps them in sync on every re-run (searchable attributes, facets,
//    custom ranking). index-settings.json has no `ranking`, so each replica's own sort survives.
await done(indexName, await client.setSettings({
  indexName,
  indexSettings: { ...settings, replicas: replicaNames },
  forwardToReplicas: true,
}));

console.log('2/3 replica rankings');
// 2. Each replica: only the ranking that makes it a sort (the rest was forwarded in step 1).
// Not awaited with waitForTask: a replica's settings task can stay "notPublished" when polled on the replica
// name, so waiting on it hangs although the change is applied. Nothing later depends on it, so we only send it.
for (const name of replicaNames) {
  const { taskID } = await client.setSettings({ indexName: name, indexSettings: replicas[name] });
  console.log(`  sent to ${name} (task ${taskID})`);
}

console.log(`3/3 ${synonyms.length} synonyms`);
// 3. Synonyms: replace so the file stays the single source of truth, and forward so a sorted
//    search understands "bbq" the same way the default one does.
await done(indexName, await client.saveSynonyms({
  indexName,
  synonymHit: synonyms,
  replaceExistingSynonyms: true,
  forwardToReplicas: true,
}));

// Rules are managed in the Algolia dashboard by design (merchandising without code), so this script never touches them.

console.log(`Configured "${indexName}": ${Object.keys(settings).length} settings, ` +
  `${replicaNames.length} replicas (${replicaNames.join(', ')}), ${synonyms.length} synonyms.`);
