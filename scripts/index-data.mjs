// Pushes data/build/records.json to Algolia. Pipeline order: prepare -> configure -> index.
import { readFileSync } from 'node:fs'
import { algoliasearch } from 'algoliasearch'

const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY } = process.env
if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_KEY) {
  // Name the variables only, never print their values.
  console.error('Missing ALGOLIA_APP_ID and/or ALGOLIA_ADMIN_KEY. Copy .env.example to .env and fill them in.')
  process.exit(1)
}

const { index: indexName } = JSON.parse(readFileSync('search-config/contract.json', 'utf8'))
const objects = JSON.parse(readFileSync('data/build/records.json', 'utf8'))

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY)

// Fills a temp index, then swaps it in atomically: no stale records, no empty window for searchers.
// Default scopes keep the settings, rules and synonyms already configured on the index.
await client.replaceAllObjects({ indexName, objects })
console.log(`Indexed ${objects.length} records into "${indexName}"`)
