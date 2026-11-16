# OpenTable restaurant discovery, built on Algolia

**Live demo:** https://nvwh.github.io/opentable-discover/

A prototype of how OpenTable's search and discovery could feel on Algolia, built for the Algolia Solutions Engineer assignment.

**Disclaimer:** This is an unofficial concept built for a hiring assignment. It is not affiliated with, endorsed by or sponsored by OpenTable or Algolia. OpenTable’s name and logo are trademarks of OpenTable, Inc. and are used here only to illustrate the concept. Restaurant data comes from the assignment’s sample dataset.

## Approach in short

OpenTable loses bookings in two places. People who search for a restaurant misspell it or pick the wrong branch of a chain, and people who are just browsing and looking for inspiration don't get a proper experience.

This demo tackles both with one search box over one Algolia index and few replicas.

- **Data:** the two source files are joined on `objectID`, cleaned, and enriched with a cuisine group, a review-weighted popularity score (inspired by the IMDB weighted approach), a chain `brand` and a few discovery tags (Crowd favourite, Hidden gem, Special occasion).
- **Relevance:** names come first, typos are forgiven, distance ranks results without filtering them out, and popularity breaks ties. Index settings live in the repo as JSON and are applied by a script. Rules, like "romantic" leading to special-occasion places, live instead in the Algolia dashboard, where it would be more appropriate for a business team to manage them.
- **Tuning:** I ran a few realistic queries, recorded what came back and used the results to infer some conclusions. Then changed one setting at a time and ran them again. You can see [docs/TEST-LOG.md](docs/TEST-LOG.md), with screenshots in [docs/query_example](docs/query_example).
- **Experience:** the page adapts to what you are doing. With an empty search you get curated collections and places near you. Type a restaurant name and you get a compact list that makes the right branch easy to spot. Search a cuisine or a place and you get cards to browse. Every result has a Reserve button although, following a better API integration and collaboration with OpenTable could result in direct bookings from the results itself; reducing the friction to book and improving the conversion rate, potentially.

## How to run it locally

Needs Node 20.6+ and a free Algolia application.

    npm install
    cp .env.example .env      # App ID, Admin key (scripts only), Search-only key (frontend)
    npm run data:all          # prepare records, apply settings, upload to Algolia
    npm run dev

Without keys, `npm run dev` starts in preview mode on a small sample, so the UI can still be reviewed.

| Script | What it does |
|---|---|
| `data:prepare` | Joins and cleans the two files, writes `data/build/records.json` |
| `data:configure` | Applies settings, replicas and synonyms from `search-config/` |
| `data:index` | Replaces all records in the index |
| `data:all` | The three above, in order |
| `test:queries` | Runs the test-log queries against the index, writes `docs/test-results.md` |
| `dev` / `build` / `preview` | Frontend (Vite + InstantSearch.js) |
| `check:keys` | Fails if the admin key could have leaked into the frontend or the build |

## Data

**Join.** `restaurants_list.json` (5,000 records) and `restaurants_info.csv` (5,000 rows) are joined on `objectID`, cast to strings on both sides and then every row is matched.

**Cleanup.**
- Ratings, review counts and prices are cast to numbers.
- Phone numbers come from the CSV, because half of the JSON ones ended with a stray "x".
- Reserve links are upgraded to https.
- `country` is dropped (always US).
- When the two price fields disagree (220 records), `price` wins and `price_range` is kept as text.

**Enrichment.**
- `cuisine_group`: the 114 raw food types merged into 22 groups a diner would recognise ("Steak" and "Steakhouse" become Steakhouse, and so on). The raw `food_type` is kept.
- `popularity_score`: a Bayesian average, `(v / (v + m)) × R + (m / (v + m)) × C`, where R is the rating, v the review count, C the dataset mean (4.29) and m = 140 (the 25th percentile of review counts). A 5.0 with 3 reviews no longer beats a 4.7 with 4,000.
- `brand` and `brand_location_count`: the name before a separator ("Ruth's Chris Steak House - Indianapolis Northside" becomes "Ruth's Chris Steak House"). 219 brands have more than one location.
- `tags`: Crowd favourite, Hidden gem, Special occasion and Easy and casual, derived from rating, reviews, price and dining style.
- `location_label` and `price_label` for display.

**Assumptions.**
- `price` is more reliable than `price_range`.
- The brand split misreads a few generic names (two unrelated restaurants called "Town" count as one brand).
- The tags are personal rules, not OpenTable data.

## Search configuration

| Setting | Value | Why |
|---|---|---|
| Searchable attributes | `unordered(name)`, `cuisine_group, food_type`, `neighborhood, city`, `area`, `address`, `payment_options` | A name match beats a cuisine match, which beats a place match. `unordered` so a branch name ("Indianapolis") counts as much as the brand. |
| Custom ranking | `popularity_score`, `stars_count`, `reviews_count` (all desc) | Breaks ties toward places that are both good and proven. |
| Facets | `cuisine_group`, `city` and `area` (searchable), `price_label`, `dining_style`, `tags`, `state`, `payment_options`, `brand` (filter only) | Every filter in the UI maps to a facet. Rating uses a numeric filter on `stars_count`. |
| Geo | `aroundLatLngViaIP` by default, `aroundLatLng` with precise location, `aroundRadius: all`, precision bands of 5 km up to 80 km and 1,000 km beyond | Distance ranks results but never removes them, so a known restaurant in another city is still found. |
| Typos and query | Algolia defaults (1 typo from 4 letters, 2 from 8, splitting and joining words), `ignorePlurals`, `removeStopWords`, `removeWordsIfNoResults: lastWords`, no typos on "vegan" | Forgiving on names, and long queries never dead-end. "vegan" was being corrected to "Vegas". |
| Replicas | Top rated, Most reviewed, Price low to high | Standard replicas, so each sort has its own ranking. |
| Synonyms | steak/steakhouse, bbq/barbecue, pizza/pizzeria, tapas/small plates, sushi → japanese, nyc/new york, sf/san francisco, texasdebrazil → texas de brazil | Only words diners type that the data spells differently. |
| Rules (dashboard) | "romantic" / "date night" → Special occasion | Intent words that no record contains, turned into a filter. |

**How it behaves with different queries**
- **Empty:** collections plus places near you.
- **Broad** ("italian"): nearby places, best first.
- **Specific or misspelled** ("ruths cris", "baltazar"): the right restaurant, with chains listed nearest first.
- **Ambiguous** ("union", "portland"): the place match near you wins, and the test log notes where that falls short.
- **Location-sensitive** ("sushi san diego"): place words in the query count, even far from you.
- **No results:** never a dead end. You get options to loosen the search and popular picks nearby.

## Git Workflow

The repo follows GitFlow. `main` is the deployed version and `develop` is where features come together. Each piece of work has its own `feature/` branch.

An earlier, alternative design is kept on `support/1.x-initial-design` (tagged `v1.0.0`). It uses the same data and search setup with a different interface, and it gets the same functional fixes as `main`.

## What I would do next (**non-exhaustive list**)

- Click and conversion events on Reserve, to measure bookings from search and unlock re-ranking.
- More intent rules ("cheap", "fancy") and grouping chain branches for broad queries.
- Live availability in the index, so results can show bookable times.

## Notes

Being a demo, there are no automated tests and you may run into rough edges. Design is also something that would require further adjustments and is based on the information available plus combined with personal choices for demo purposes (i.e. typos have a visual red flag when they are detected and "forgiven").
