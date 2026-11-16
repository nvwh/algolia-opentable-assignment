# Relevance test log

How to use: run each query in the live demo (and in the Algolia dashboard search preview with ranking info on), write what you see, change one setting at a time, then re-run. One row per iteration. The "Observed", "Change made" and "Result" columns stay empty until the index is live.

Unless stated, tests run with location set to the New York metro.

Iteration 1 run on 2026-11-13 with `npm run test:queries` (raw output in `docs/test-results.md`). 18 of 25 pass, 1 acceptable, 5 fixed with a setting change (re-run pending), 1 open.

| # | Query | Category | Expected | Observed | Change made | Result |
|---|---|---|---|---|---|---|
| 1 | `baltazar` | Misspelled name | Balthazar (New York) first | Balthazar, 1 hit | none | Pass |
| 2 | `ruths cris` | Misspelled name | Ruth's Chris branches, nearest first | 31 Ruth's Chris branches, Parsippany (nearest to NY) first | none | Pass |
| 3 | `walse` | Misspelled name, accent | Wallsé (New York) first | Wallsé first, then loose matches (Walter's) | none | Pass |
| 4 | `mcormick and schmicks` | Misspelled name, `&` vs "and" | McCormick & Schmick's branches | 13 McCormick & Schmick's branches; "and" vs "&" handled | none | Pass |
| 5 | `ruthschris` | Concatenated name | Ruth's Chris branches | Same 31 branches as #2: query splitting works | none | Pass |
| 6 | `cycloneanayas` | Concatenated name | Cyclone Anaya's branches (Houston) | 5 Cyclone Anaya's branches (Houston) | none | Pass |
| 7 | `texasdebrazil` | Concatenated name, 3 words | Texas de Brazil branches | 0 hits. Algolia splits a glued word into two words at most; this is three | One-way synonym texasdebrazil -> "texas de brazil" | Re-run pending |
| 8 | `nobu` | Partial name | Nobu Fifty Seven, Nobu Waikiki, Nobu San Diego before Nobuo and Mitsunobu | Nobu Fifty Seven first, then Nobuo at Teeter House (Phoenix) above Nobu San Diego: geo ranks before exactness and Phoenix is closer | aroundPrecision bands: 5 km within 80 km, 1,000 km beyond | Re-run pending |
| 9 | `melting` | Partial name | The Melting Pot branches | The Melting Pot branches, nearest first | none | Pass |
| 10 | `cyclone anaya` (location Houston) | Chain, same city | All 5 Houston branches, nearest first, branch name readable | All 5 Houston branches | none | Pass |
| 11 | `atrias pnc park` | Chain plus branch | Atria's - PNC Park first | Atria's - PNC Park, 1 hit | none | Pass |
| 12 | `ruths chris indianapolis` | Chain plus city text | The 2 Indianapolis branches first | Both Indianapolis branches, 2 hits | none | Pass |
| 13 | `italian` | Broad cuisine | Popular Italian places nearby, cuisine facet offered | 895 hits, New York Italian places first | none | Pass |
| 14 | `steak` | Broad cuisine, synonym | Steakhouse group, both "Steak" and "Steakhouse" food types | 539 hits, New York steakhouses first; steak/steakhouse synonym works | none | Pass |
| 15 | `sushi san diego` | Cuisine plus city text | Japanese or sushi places in San Diego, even when location is New York | 8 hits, San Diego area Japanese and sushi places, even from New York | none | Pass |
| 16 | `bbq houston` | Cuisine synonym plus city | Barbecue places in Houston | Creole and Southern places (Brennan's of Houston, Cast Iron Fort Worth). "bbq" matched the group name "Southern & BBQ" | Split the group into Southern and Barbecue | Re-run pending (Houston has no barbecue, so expect barbecue elsewhere) |
| 17 | `union` | Ambiguous | Restaurants named Union first, then Union Square neighborhood matches | Union Square restaurants in New York first | none | Acceptable: locally, the neighborhood is the likelier intent |
| 18 | `town` | Ambiguous, common word | Town (Carbondale, Honolulu) before "Downtown" neighborhood matches | 532 hits, nearby prefix matches (Townsquare Diner) before restaurants named Town | none yet | Open: geo before exactness. Candidate: a Rule pinning exact names, or exact before geo |
| 19 | `portland` | Ambiguous, place vs name | Portland restaurants, popular first, not only names containing "Portland" | Redmond and Hood River first: they match the metro "Portland / Oregon" and are slightly closer to New York | area moved to its own tier below city; 1,000 km far bands | Re-run pending |
| 20 | `french` with location New York, then Denver | Location sensitive | Different top results per location, nearest and popular first | New York: French Roast, Paname, Le Bernardin. Denver: Mizuna, Bistro Vendome. Different by location | none | Pass |
| 21 | `ruths chris` from a location with no data nearby (for example Europe) | Location sensitive, fallback | Results still returned, page offers the metro picker | 31 results from Paris, no dead end | none | Pass (UI shows the metro picker) |
| 22 | (empty) | Empty | Nearby restaurants ordered by distance band then popularity, no 1-review places on top | Le Bernardin, Pazza Notte, Marea: nearby and well reviewed | none | Pass |
| 23 | (empty), sort "Top rated" | Empty, sort | Order follows popularity score, not raw stars | Russell's Steaks (4.9, 2,512 reviews), Quince: Bayesian score at work, no 1-review places | none | Pass |
| 24 | `italian vegan gluten free rooftop` | Over-specified | No dead end: some words dropped, results returned | 21 hits in Las Vegas: "vegan" was typo-matched to "Vegas" | disableTypoToleranceOnWords: ["vegan"] | Re-run pending |
| 25 | `xqzv` | Nonsense | No-results state with clear-filters and popular nearby options | 0 hits | none | Pass (UI shows no-results state) |
| 26 | `romantic` / `romantic italian` | Intent word, no record contains it | Special occasion places, Italian ones for the second query | 0 hits before the rule (the word exists in no record) | Dashboard rule: remove the word, filter tags:'Special occasion' | Re-run pending |
| 27 | `cheap` | Intent word | Affordable places nearby | 0 hits: price is a filter, not searchable text | none yet | Open: same pattern as #26 with price_label:$$ |
| 28 | `5000` | Number | Unclear intent | 8 hits matching street numbers (5000 Westheimer, 5000 Kahala Ave), which look expensive by coincidence | none | Accepted: harmless, noted as address noise |
