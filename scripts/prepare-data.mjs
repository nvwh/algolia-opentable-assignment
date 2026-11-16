// Joins the two raw files and derives the fields listed in search-config/contract.json.
// Run: npm run data:prepare  ->  data/build/records.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const contract = JSON.parse(readFileSync('search-config/contract.json', 'utf8'))

// ---------- 1. Read and join ----------
const list = JSON.parse(readFileSync('data/raw/restaurants_list.json', 'utf8'))

// Plain split is safe here: verified no quoted fields and 8 columns on every row.
const [header, ...lines] = readFileSync('data/raw/restaurants_info.csv', 'utf8').trim().split(/\r?\n/)
const cols = header.split(';')
const csv = new Map(lines.map((l) => {
  const row = Object.fromEntries(l.split(';').map((v, i) => [cols[i], v.trim()]))
  return [String(row.objectID), row] // JSON has numbers, CSV has strings: compare as strings
}))

const joined = []
for (const r of list) {
  const c = csv.get(String(r.objectID))
  if (c) joined.push({ r, c })
}
console.log(`json in: ${list.length}, csv in: ${csv.size}, matched: ${joined.length}, unmatched: ${list.length - joined.length}`)

// ---------- 2. Cuisine groups (diner-friendly, ~21 instead of 114) ----------
const GROUPS = {
  'American': ['American', 'Contemporary American', 'Comfort Food', 'Burgers', 'Breakfast', 'Wild Game'],
  // Barbecue is its own group: inside "Southern & BBQ", a query for "bbq" matched every Creole and Southern place (test log #16).
  Southern: ['Southern', 'Contemporary Southern', 'Creole', 'Cajun', 'Creole / Cajun / Southern', 'Low Country'],
  Barbecue: ['Barbecue'],
  'Steakhouse': ['Steakhouse', 'Steak', 'Prime Rib', 'Brazilian Steakhouse'],
  'Seafood': ['Seafood'],
  'Italian': ['Italian', 'Contemporary Italian', 'Pizzeria', 'Sicilian'],
  'French': ['French', 'Contemporary French', 'Contemporary French / American', 'French American', 'Provencal', 'Bistro'],
  'Japanese': ['Japanese', 'Sushi', 'Hibachi'],
  'Asian': ['Asian', 'Pan-Asian', 'Contemporary Asian', 'Chinese', 'Dim Sum', 'Thai', 'Korean', 'Vietnamese', 'Filipino', 'Southeast Asian', 'Burmese', 'Pacific Rim', 'Eurasian'],
  'Indian': ['Indian', 'Contemporary Indian', 'South Indian'],
  'Mexican': ['Mexican', 'Mexican / Southwestern', 'Contemporary Mexican', 'Tex-Mex', 'Traditional Mexican', 'Regional Mexican', 'Southwest'],
  'Latin American': ['Latin American', 'Brazilian', 'Peruvian', 'Argentinean', 'Cuban', 'Caribbean', 'Puerto Rican', 'South American'],
  'Spanish & Tapas': ['Spanish', 'Tapas / Small Plates', 'Latin / Spanish', 'Basque', 'Portuguese'],
  'Mediterranean': ['Mediterranean', 'Greek'],
  'Middle Eastern & African': ['Middle Eastern', 'Persian', 'Lebanese', 'Moroccan', 'Syrian', 'Turkish', 'Afghan', 'Ethiopian', 'African', 'South African'],
  'European': ['European', 'Contemporary European', 'Modern European', 'Continental', 'German', 'Belgian', 'Swiss', 'Scandinavian', 'Russian', 'Eastern European', 'Austrian', 'Irish', 'British', 'English', 'Afternoon Tea'],
  'Californian & Northwest': ['Californian', 'Northwest'],
  'Hawaiian': ['Hawaii Regional Cuisine', 'Hawaiian', 'Polynesian'],
  'International & Fusion': ['Global, International', 'International', 'Fusion / Eclectic', 'Australian', 'Modern Australian'],
  'Fondue': ['Fondue'],
  'Vegetarian & Organic': ['Organic', 'Vegan', 'Vegetarian', 'Kosher'],
  'Bar & Pub': ['Gastro Pub', 'Brewery', 'Beer Garden', 'Wine Bar', 'Bar / Lounge / Bottle Service'],
}
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, types]) => types.map((t) => [t, g])))
const unmapped = new Set()
const cuisineGroup = (t) => GROUP_OF[t] ?? (unmapped.add(t), t) // fallback: its own value

// ---------- 3. Dataset statistics for popularity_score and tags ----------
const stars = joined.map(({ c }) => parseFloat(c.stars_count))
const reviews = joined.map(({ c }) => parseInt(c.reviews_count, 10))
const sorted = [...reviews].sort((a, b) => a - b)
const quantile = (p) => sorted[Math.floor(p * (sorted.length - 1))]

// Bayesian average: few reviews pull a restaurant toward the dataset mean C.
// m = 25th percentile of review counts: only the thinnest quarter of places is
// pulled strongly toward C; the median would flatten well-reviewed places too.
const C = stars.reduce((a, b) => a + b, 0) / stars.length
const m = quantile(0.25)
const bayes = (R, v) => Math.round(((v / (v + m)) * R + (m / (v + m)) * C) * 1000) / 1000

const medianReviews = quantile(0.5)
const topDecileReviews = quantile(0.9)

// ---------- 4. Brand ----------
// Cut at the first " - ", en dash, em dash, " @ " or "(". We do NOT cut on " at " or ",":
// they mostly introduce a venue ("Grove Steakhouse at Viejas Casino", "The Restaurant at Ponte",
// "Kula Lodge & Restaurant, Inc."), which would produce wrong or empty brands.
const SPLIT = / [-–—] | @ |\(/
const brandOf = (name) => name.split(SPLIT)[0].trim() || name
const normalise = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

const spellings = new Map() // normalised brand -> Map(spelling -> count)
for (const { r } of joined) {
  const b = brandOf(r.name), k = normalise(b)
  if (!spellings.has(k)) spellings.set(k, new Map())
  spellings.get(k).set(b, (spellings.get(k).get(b) ?? 0) + 1)
}
// One canonical spelling per brand (most frequent) keeps the facet clean; sum of counts = locations.
const canonical = new Map([...spellings].map(([k, s]) => [k, {
  brand: [...s].sort((a, b) => b[1] - a[1])[0][0],
  count: [...s.values()].reduce((a, b) => a + b, 0),
}]))

// ---------- 5. Build records ----------
const https = (u) => u.replace(/^http:\/\//, 'https://')
const tagCounts = {}

const records = joined.map(({ r, c }) => {
  const R = parseFloat(c.stars_count), v = parseInt(c.reviews_count, 10), price = Number(r.price)
  const { brand, count } = canonical.get(normalise(brandOf(r.name)))

  // Tags are assumptions built only from existing fields (listed in the README).
  const tags = []
  if ((c.dining_style === 'Fine Dining' || price === 4) && R >= 4.5) tags.push('Special occasion')
  if (c.dining_style === 'Casual Dining' && price === 2) tags.push('Easy and casual')
  if (R >= 4.6 && v >= 30 && v < medianReviews) tags.push('Hidden gem')
  if (v >= topDecileReviews && R >= 4.3) tags.push('Crowd favourite')
  tags.forEach((t) => (tagCounts[t] = (tagCounts[t] ?? 0) + 1))

  return {
    objectID: String(r.objectID),
    name: r.name,
    brand,
    brand_location_count: count,
    food_type: c.food_type,
    cuisine_group: cuisineGroup(c.food_type),
    neighborhood: c.neighborhood,
    city: r.city,
    area: r.area,
    state: r.state,
    address: r.address,
    postal_code: String(r.postal_code),
    // Skip the neighborhood when it just repeats the city.
    location_label: [...new Set([c.neighborhood, r.city, r.state].filter(Boolean))].join(', '),
    price, // json price wins over price_range when they disagree
    price_label: '$'.repeat(price),
    price_range: c.price_range,
    dining_style: c.dining_style,
    stars_count: R,
    reviews_count: v,
    popularity_score: bayes(R, v),
    payment_options: r.payment_options,
    tags,
    phone: c.phone_number,
    image_url: r.image_url,
    reserve_url: https(r.reserve_url),
    mobile_reserve_url: https(r.mobile_reserve_url),
    _geoloc: r._geoloc,
  }
})

mkdirSync('data/build', { recursive: true })
writeFileSync('data/build/records.json', JSON.stringify(records))

// ---------- 6. Report ----------
const sizes = {}
records.forEach((x) => (sizes[x.cuisine_group] = (sizes[x.cuisine_group] ?? 0) + 1))
console.log(`cuisine groups: ${Object.keys(sizes).length}`, sizes)
console.log('unmapped food_type values:', [...unmapped])
console.log(`popularity_score: C=${C.toFixed(4)}, m=${m}`)
const brands = [...canonical.values()].sort((a, b) => b.count - a.count)
console.log(`brands: ${brands.length}, with 2+ locations: ${brands.filter((b) => b.count > 1).length}`)
console.log('top brands:', brands.slice(0, 10).map((b) => `${b.brand} (${b.count})`).join(', '))
console.log('tag counts:', tagCounts)

// ---------- 7. Self-check ----------
const keys = Object.keys(contract.attributes).sort().join()
assert.equal(records.length, 5000, 'expected 5000 records')
assert.ok(records.every((x) => Object.keys(x).sort().join() === keys), 'record keys differ from contract')
console.log('self-check ok')
