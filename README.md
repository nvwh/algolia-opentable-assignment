# OpenTable restaurant discovery: initial design

This branch keeps the first version of the interface (tagged `v1.0.0`). The current version, the one deployed as the live demo, is on `main`.

It runs on the same data pipeline and Algolia configuration as `main`, so you can compare the two designs side by side. It is meant for local use only.

## Run it locally

Needs Node 20.6+ and a free Algolia application.

    npm install
    cp .env.example .env      # App ID, Admin key (scripts only), Search-only key (frontend)
    npm run data:all          # prepare records, apply settings, upload to Algolia
    npm run dev

If the index was already set up from `main`, you can skip `npm run data:all`.

For the approach, data preparation and search configuration, see the README on `main`.
