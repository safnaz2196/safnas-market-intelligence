# Safnas Sri Lanka Market Intelligence — PUBLIC market-data-only repository

This folder contains a **standalone GitHub Actions collector**. It does not contain any of your private finance records, Firebase configuration, Gmail passwords, API keys or other secrets.

## First-time activation (free)

1. On GitHub, while signed in as `safnaz2196`, create a NEW **Public** repository named exactly `safnas-market-intelligence`. Public is necessary because the Safnas Finance website fetches the public market-data report without requiring a GitHub access token. **Do not upload your private financial backups or service-account JSON to this repository.**
2. Upload everything INSIDE this `market-feed` folder to the new repository's root. Hidden `.github/workflows/sri-lanka-intelligence.yml` must be at the repository root, not inside a `market-feed` parent folder. You may upload using GitHub Desktop or Git CLI if Chrome skips hidden folders.
3. Open that repository → **Actions** → **Sri Lanka market intelligence — scheduled public research** → **Run workflow** once. GitHub's scheduler then checks on weekdays at approximately **8:00 AM and 6:00 PM Sri Lanka time**, regardless of whether your website is open.
4. Verify the workflow's latest run succeeded, then open `market-intelligence/latest.json` in your repository. It should contain real `generatedAt`, original observation dates, and `status`. The site reads it at:
   `https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/latest.json`
5. Open Safnas Finance → **Sri Lanka Intelligence** → **Refresh research**. The research snapshot and model audit should load if published and accessible.

**Zero payment required for GitHub public repository Actions on standard GitHub-hosted runners, within GitHub's policy and fair-use limits.** Schedules are best-effort; missed or delayed jobs are possible. No actual stock-market signal is guaranteed.

### Data sources and training

- **CSE ASPI**: `POST https://www.cse.lk/api/chartData` with multipart fields `chartId=1` and `period=5`, documented in community research as an *unofficial* public exchange endpoint. Scraping and reuse may be restricted by terms or block/rate limits. When blocked, the collector retains historical observations, marks them stale, and does **not** make new forecasts.
- **S&P SL20 and turnover**: read-only public CSE snapshots when the undocumented endpoints respond. Timestamp is labeled *retrieved*, not proven end-of-day official close.
- **Sri Lanka companies**: CSE public snapshot quotes are shown as active shares, not purchase suggestions.
- **Economy**: World Bank annual series for GDP growth, annual CPI inflation, remittances/GDP, ILO-modeled unemployment, current account/GDP and exports/GDP. These may lag and be revised.
- **USD/LKR**: Frankfurter blended daily reference rate, not a remittance/dealer quote.
- **News context**: EconomyNext RSS headlines, dated and linked to publisher, never assumed accurate AI sentiment predictors.

### Model

After receiving at least 210 verified daily closes with the latest reading no more than 7 days old, the job retrains the same supervised machine-learning models from Safnas v3.4.5. Models use nine price-pattern features, purged chronological validation, untouched final audit and a majority-class baseline. Up/down output is shown only as **research**, not a probability of profit or a stock recommendation. The forecast is for **ASPI index movement over 5 or 20 market sessions**, not individual companies or the Sri Lankan economy.

A model without a convincing improvement over the baseline displays **No demonstrated forecasting edge**. No market data / stale data → **Unavailable**. Annual macroeconomic readings are **not** relabeled as short-term ML forecasts.

### Running locally without network

`node --test collector/*.test.cjs` tests parsers, freshness and model abstention without any external APIs. `node collector/update.cjs` attempts to fetch public data and writes `market-intelligence/latest.json`; it requires network access.

### Limitations

Public market sources can stop working, and an exchange might restrict redistribution. GitHub Actions will not run if you only deploy Firebase Hosting. New public repository workflow files must be committed to the default branch. This market feed is intentionally **read-only** from the finance website, so no personal finances are ever transmitted to GitHub.

## Outcome learning journal

The collector writes `market-intelligence/prediction-journal.json`. A forecast is recorded on the observation date and evaluated only once 5 or 20 later trading-session closes actually exist. Correct and incorrect outcomes are tracked. The model is independently refitted on verified history each scheduled run; merely counting past successes does **not** establish reliable predictive skill.
