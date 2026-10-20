# Pareto Game

A static Roosevelt Island mapping study, designed for GitHub Pages.

## Visual style

The interface follows the visual language of [aecao/portfolio](https://github.com/aecao/portfolio):
Helvetica Neue / Helvetica / Arial, light body text, bold headings, white panels,
near-black text (`#15120f`), thin rules and square-edged controls. Navigation uses
a black outline for the active mode and black/white hover states. The portfolio's
blue (`#0035ff`) identifies top-ten sites, focus and selection accents; teal
(`#2a6c68`) marks other ranked sites, and terracotta (`#b8432f`) marks review
warnings and building footprints. Unranked sites remain gray and dashed.

UI and Leaflet overlay colors share the CSS custom properties in `styles.css`,
so map polygons and their legend stay consistent. Labels and warnings remain
explicit; color alone does not establish a site's rank or eligibility.
The system font stack needs no external font downloads. The analytical
three-panel workspace remains wider than the portfolio gallery so the map and
ranking controls can be used together.

## Connectivity mode

Select **Connectivity** for the first walking-only bridge prototype:
`Q00313_4003130001` (two-lot Queens assemblage at Costco Esplanade) from an
assumed access point on Roosevelt Island. Explore and Siting remain unchanged
and available.

Controls select **15/30/45 minutes**, baseline/bridge/both street reachability,
and baseline/bridge/both map display. The map opens with the Roosevelt Island
origin and Queens site in view. Styles and legend use the existing
portfolio-inspired palette: teal baseline, blue scenario and terracotta dashed
hypothetical/assumed access links.

This is a **fixed, precomputed snapshot**, not live routing, a freely movable
origin or an editable bridge. Both scenarios start at the Roosevelt Island
bridge landing itself, connected to the island greenway with an assumed access link.
Baseline-only hides the proposed bridge/Queens approach. The baseline can reach
Queens over the existing Roosevelt Island pedestrian crossing; the bridge
scenario adds a direct crossing to the provisional Queens landing. No Siting
scores, capacity assumptions or rankings change.

At the assumed 3 mph, Queens source-node counts at 15/30/45 minutes are
3/282/1,064 baseline versus 71/621/1,822 with the bridge. Roosevelt Island counts
are 78/148/153 in both scenarios. At 45 minutes, 465 Queens source-node times
improve and 758 additional Queens nodes are reached. These are graph diagnostics,
not jobs or population.

The 554.4-ft straight crossing and 84.7/64.5-ft Queens/island landing access
are assumptions—not engineered geometry or verified public
access. LION 26c physical
pedestrian edges connect by source node ID plus endpoint level; no connections
are invented at geometric street crossings. Sidewalk/crossing completeness,
signals, slope, clearance, ramps, stairs/elevators and operating hours remain
unverified or unmodeled. Island detail is provisional. Lines depict reachable
street intervals, not all reachable land, and this is not a pedestrian navigation
service or step-free analysis. Cycling, transit, vehicle and financial effects
are not included.

[`assets/connectivity/walking.json`](assets/connectivity/walking.json) is a
source-checked export from the companion POSTGIS walking pipeline.
It retains exact saved EPSG:4326 display geometries, source numerical summaries,
scenario settings and provenance; no simplification or browser
rerouting is performed. It omits the full citywide routing graph and display-only
buffer polygons. The browser fetches it only when Connectivity is selected;
failed downloads/invalid payloads show an explicit error and retry control,
with no success-shaped defaults. Switching modes while loading cannot turn
Connectivity layers on in another mode.

To refresh, independently validate the walking outputs, archive the existing
web snapshot, then run from the POSTGIS workspace. When changing the snapshot
contract, bump the shared `v` release token on both Connectivity scripts, the
snapshot fetch and the download link so cached validators cannot load a newer
incompatible snapshot. Snapshot fetches also revalidate the HTTP cache.

```powershell
.\.venv\Scripts\python.exe .\01_sites\validate_walking_bridge.py
.\.venv\Scripts\python.exe .\01_sites\export_connectivity_web.py --web-root 'C:\path\to\PARETO-GAME'
```

The exporter refuses overwrite, checks all source/output hashes against the
completed walking manifest and retains exact source GeoJSON and numerical values.
Node tests validate all budgets/scenarios, source findings and corrupt-snapshot
rejection. GitHub Pages runs both Siting and Connectivity tests.

## Siting mode

Select **Siting** in the header to explore the Queens waterfront pilot. The
existing **Explore** view and its building popups remain available.

The corrected pilot contains **72 groups / 984 tax lots**: 61 ranked multi-lot
assemblages and 11 unranked groups (eight singletons and three groups with
incomplete inputs). All remain visible on the map and in the ranking list.
Map selection and list selection share a detail panel. Top-ten ranks are
numbered on the map; park overlap and unresolved zoning conditions remain
visible even for highly ranked sites.

The controls recalculate locally, without a database connection:

| Parameter | Default |
|---|---|
| Gross new affordable units | 5,000 |
| Net unit size | 750 square feet |
| Net-to-gross efficiency | 82% |
| Target accommodation weight | 40% |
| Fewer existing units removed weight | 40% |
| Fewer lots to assemble weight | 20% |

Weights must be nonnegative and total 100%. Custom weights are labeled
exploratory, not the approved baseline policy. Invalid/blank inputs show an
explicit error and mark the displayed values as the **last valid results**.
Reset restores all six defaults. Input changes do not persist across reloads
and do not change the source snapshot or Python pipeline outputs.

### What the ranking means

- Required residential gross floor area = new units × net unit size ÷
  efficiency. Proxy replacement units = fixed base-FAR floor area × efficiency
  ÷ net unit size.
- Fixed base-FAR floor area = `sum(LotArea * ResidFAR)`. This represents full
  replacement, **not unused FAR, verified legal entitlement or buildable yield**.
- Accommodation = `min(proxy floor area / required floor area, 1)`.
  Fewer removals and fewer lots use inverse min-max normalization within the
  61 complete multi-lot candidates. Constant components tie at one.
- Score = 100 × weighted component sum. Scores are not feasibility percentages.
  Exact-score ties share minimum rank; site ID orders tied rows. Displayed
  scores are rounded but ranks use full precision.
- All existing residential units are presumed removed. Conditional net units =
  gross target minus existing units removed, not an achieved forecast, net
  affordable-unit gain, or displaced-household count. Unknowns stay unknown;
  singles and incomplete groups never become ranked by changing weights.
- At defaults, **zero of 61 ranked sites** meet 5,000 units under the proxy.
  At a 1,000-unit target with other defaults unchanged, seven meet the proxy
  target. Neither result demonstrates legal/financial/engineering feasibility.

The 1,000-foot shoreline corridor is a speculative screening boundary, not a
landing or bridge-approach standard. Boundary revision `roosevelt_facing_v2`
excludes the detached Dutch Kills creek shoreline **before buffering** because
it does not face Roosevelt Island. This removes 29 creek-only groups, including
`Q00291_4002910001` and the former #7/#9 groups, rather than just hiding a site
in the browser. Scores/ranks are regenerated against the corrected cohort.
The first six ranks are unchanged; the new #7 is `Q00024_4000240001`.
The previous 101-group snapshot is archived in the companion POSTGIS workspace
under `outputs/archive/20261020_before_creek_correction/`.
Assemblages are maximal shared-edge groups
within tax blocks, not verified legal zoning lots. Capacity, approvals,
ownership, displacement, affordability delivery and costs remain unresolved.
This is a **mode-neutral redevelopment screen** shared with no-bridge
redevelopment, not a comparison of pedestrian/bike, transit or vehicle bridge
benefits. Retention adds/removes zero units.

### Data and reproducibility

[`assets/siting/pilot.json`](assets/siting/pilot.json) is a roughly 203 KB static
export from the companion POSTGIS project:

- `outputs/pilot_queens_20261020/`: original ranked sites and reference geometry.
- `outputs/pilot_zoning_register_20261020/`: mapped zoning and review flags.
- PLUTO 26v2 and mapped zoning 202608. See the embedded source hashes, counts,
  snapshot identifiers, defaults and export timestamp.

Display geometry is transformed to EPSG:4326. Floor areas and other metrics
retain their original projected square-foot values; do not measure GeoJSON
coordinates as feet. No raw citywide datasets, database credentials or database
service are needed by the browser. Original lot BBLs and unranked reasons are
included. Snapshot loading errors are reported explicitly with a retry button.

To refresh, archive the existing JSON, then run these commands from the
POSTGIS workspace (substitute the app checkout path):

```powershell
& '.\.venv\Scripts\python.exe' '.\01_sites\export_siting_web.py' --web-root 'C:\path\to\PARETO-GAME'
& '.\.venv\Scripts\python.exe' '.\01_sites\validate_siting_web.py' --web-root 'C:\path\to\PARETO-GAME'
```

The exporter refuses overwrites and verifies the source manifests first. The
validator compares JavaScript against Python for all 72 groups across five
scenarios, including unit targets, unit size/efficiency and weights. Changing
eligibility, site geometry, source capacity or source policy requires a new
reviewed pipeline snapshot, not just a browser control.

## Preview locally

From the repository root, run:

```powershell
python -m http.server 4173
```

Then open http://localhost:4173.

Use HTTP rather than opening the HTML as a local file, because the map fetches
JSON and CSV assets. Leaflet and basemap tiles retain their existing
external-network dependencies.

## Tests

No package installation is required. With Node.js 24, run:

```powershell
node --test tests/*.test.cjs
```

Tests verify the complete original ranking, changed assumptions and weights,
ties, constant components, unknowns, negative net gains, exact target thresholds
and invalid inputs. The browser UI has also been checked at desktop and mobile
sizes, including map/list selection, reset, error/retry and Explore restoration.

## Publish with GitHub Pages

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. Push to `main` to trigger the deployment workflow. The site will be available at https://aecao.github.io/pareto-game/ after the first successful deployment.

The workflow tests all study models before publishing. All asset URLs are
relative, so deployment under the `/pareto-game/` project path works without a
backend. Local changes are not published until committed and pushed.

Building and place assets belong in [`assets/buildings/`](assets/buildings/); see its README for the expected GeoJSON format.

## Market mode

**Market** is a temporary, independent mode for the cleaned StreetEasy monthly
series. Its model and viewer are self-contained so the panel can later move into
another mode without coupling it to map layers or ranking calculations.

- Defaults to Queens borough median asking rent.
- Select one of 12 metrics, an available published city/borough/neighborhood
  label and an inclusive month range. Changing metric resets to that metric's
  full history and explicitly reports when a previously selected geography is
  unavailable and Queens is substituted.
- Price/rent medians, sales/rental inventories, recorded volume, sale/list ratio,
  price/rent cuts, days on market and indices are included. Index series have
  four borough geographies only; no neighborhood index is invented.
- A line chart and newest-first table preserve missing months and source
  anomalies. Gaps are not interpolated; suspect points are colored and labeled.
  For accessibility, the table supplies every chart value. Invalid date ranges
  explicitly leave the last valid chart/table visible.
- Values remain in native source units (`native_unverified`). Shares are
  fractions, not converted percentages; indices are not currency or rents.
  Display rounds to at most six decimal places; JSON retains full precision.
- No map boundaries, NTA/CD crosswalks, parcel prices, achieved rents, hedonic
  estimates, bridge premiums or affordability calculations are implied.

The roughly 4.53 MB [`assets/market/monthly.json`](assets/market/monthly.json)
loads only on first entry. It contains 367,812 cells, including 36,271 nulls,
182 distinct geography labels and six retained negative days-on-market values.
Most histories are January 2010 through September 2026; price and rental indices
start January 2005 and January 2007 respectively. This is a fixed snapshot, not a
live feed. Failed download/validation leaves controls disabled with an explicit
error and retry.

Source: the companion POSTGIS project's cleaned
`market_price_rent_monthly.parquet` and `market_indicators_monthly.parquet`.
The exporter verifies source and manifest hashes, retains native source rows,
months, values and nulls, reconstructs every cell exactly from the written JSON,
and refuses overwrite. Archive the old JSON explicitly before refreshing:

```powershell
& '.\.venv\Scripts\python.exe' '.\01_sites\export_market_web.py' --web-root 'C:\path\to\PARETO-GAME'
```

Pure model tests cover every metric/geography/month selection, missing periods,
inclusive ranges, restricted index coverage, anomaly retention and corrupt
payload rejection. Siting and Connectivity calculations are unchanged.

### Explanatory property/asset-market model

Inside Market, **Explanatory model** switches from the monthly viewer to a
self-contained four-quadrant teaching model inspired by DiPasquale–Wheaton.
It uses **no observed market or accessibility data**. It is not calibrated to
Queens/CD1/CD2 and does not estimate dollar rents, values, floor areas or a
causal bridge effect. Existing monthly geographies/metrics do not calibrate it.
The monthly viewer and model have independent loading/error states.

Each axis has a separate reference index of 100: annual per-area rent upward,
per-area asset value leftward, annual **net delivery** downward and stock
rightward. Net delivery means additions after project removals, before
background losses; unlike gross construction it can be used directly in stock
accounting. All four scenario loops appear together; the selected scenario
determines the gray curves. Colors and dash patterns distinguish loops; an
accessible table provides short-run and long-run results.

Assumptions and technical input ranges live in
[`assets/market/scenario.json`](assets/market/scenario.json), each explicitly
marked `ASSUMPTION`, not an empirical estimate. Default demand/construction
elasticities are 1, bridge willingness-to-pay shift is +40%, sustained extra
net delivery is 40% of **reference annual flow**, and cap-rate, cost and loss
multipliers are 1. These two 40% defaults are deliberately exaggerated for
visual clarity, not expected local effects; axis values and outputs are not
artificially magnified. Reset restores these illustrative values. No physical
units, reference loss percentage, actual cap rate or forecast years are
specified. Values do not persist across reloads.

For ratios `r, p, c, s` (displayed as ratio × 100):

1. Space demand: `r = d * s^(-1/epsilon)`.
2. Asset valuation: `p = r / k` (unchanged proportional NOI margin).
3. Development response: `c = (p/q)^eta + a`.
4. Long-run replacement balance: `c = lossFactor * s`.

`d` is 1 plus the assumed bridge demand percentage in bridge scenarios,
otherwise 1. `a` is extra net annual flow divided by reference annual flow
in redevelopment scenarios, otherwise zero. `k` and `q` are cap-rate and
delivery-cost multipliers. A monotone, bracketed bisection solves the positive
stock equilibrium; results must satisfy the stock-flow identity. In physical
units, `C0 = delta0 * S0` at reference equilibrium: the independently normalized
construction/stock axes do **not** imply annual construction equals all stock.
The reference depreciation/loss rate `delta0` is deliberately unspecified.

The four cases are no intervention, bridge only, redevelopment only and
combined. All share the current common cap-rate, cost and loss assumptions,
so no intervention can differ from reference 100. The short-run comparison
holds stock at reference 100 before any delivery or loss response; it ignores
anticipation of future supply. Only long-run loops appear in the diagram.
No adjustment path or completion year is forecast.

Extra delivery is assumed funded and sustained, not proven feasible or a
one-off development translated into a permanent flow. The endogenous response
may partially crowd out extra delivery. This smooth supply curve has no hard
construction threshold, zoning/land cap, financing feasibility test or explicit
vacancy/operating-cost model. Regulation, affordability, the 5,000-unit target,
site rankings and bridge routing are unchanged.

Invalid inputs show an explicit error and retain **LAST VALID RESULTS**;
download/configuration errors provide retry. Tests cover analytic default
solutions, zero/negative shifts, comparative statics and all 128 combinations
of parameter-range endpoints, checking all four equations for every result.

### Optimal FAR model

Market also includes **Optimal FAR**, an original interactive schematic of
housing price/average cost and residual land value, not a reproduction of the
supplied textbook image. It uses no observed data or calibration from other
Market views. Explicit teaching defaults and limits are in
[`assets/market/far.json`](assets/market/far.json).

Both explanatory diagrams have labeled parameter handles for pointer/touch
dragging and keyboard adjustment. Arrow keys change one configured step,
Shift+arrow changes ten, Home/End select limits, and Escape restores the
pre-drag value. Inputs, diagrams and tables update together. Axis scales stay
fixed during a drag and refit on release. Four-quadrant demand-shift and extra
delivery handles appear only when the selected scenario includes those
interventions; equilibrium markers are outputs, not free-moving inputs.
The aligned FAR plots use a compact, viewport-height-limited desktop layout;
small screens retain contained horizontal scrolling.

For gross residential FAR `F`, housing price per gross residential square foot
is `P = alpha - beta*F`; average non-land development cost per gross residential
square foot is `C = mu + gamma*F`. Both use **one arbitrary monetary unit, not
dollars or independently indexed scales**. Land residual per lot square foot
is `L = F*(P-C)`. Default `alpha=150`, `beta=15`, `mu=50`, `gamma=10` gives:

- Unconstrained residual-maximizing `F*=2`, housing price 120, average cost 70,
  land residual 100.
- Price/cost crossing `F0=4`, with zero land residual, **not** the optimum.
- Hypothetical ceiling 4, so chosen FAR remains 2 rather than building to 4.

The model maximizes the strictly concave quadratic over `0 <= F <= ceiling`,
allowing no new building with zero development residual. Thus
`F* = max(0, (alpha-mu)/(2*(beta+gamma)))`, capped by the hypothetical ceiling.
For nonpositive intercept spread, no positive development residual exists;
existing-use land value is excluded, **not asserted to be zero**. A zero
ceiling prohibits new floor area.

The upper cost curve is **average cost**, not marginal cost: an interior optimum
satisfies `P + F*P' = C + F*C'`, generally not `P=C`. The chart preserves negative
curve extrapolations, with aligned FAR axes, optimum/cap/crossing guides and an
accessible marker-value table. Defaults, invalid-input handling, reset and
load/retry are independent of the four-quadrant model and monthly-series viewer.
All 32 parameter-boundary combinations are checked against independent grid
search, plus first-order identities and no-development/binding-cap cases.

The declining price/density relation is an assumed tradeoff, not an empirical
law. Cost should include financing/required return for a real residual appraisal;
here those are not estimated. No lot area, rentable/gross conversion, existing
building acquisition/demolition, displacement, affordable-unit requirement,
bridge cost, subsidy, local cost/price, legal zoning or Siting capacity is inferred.
Raising the ceiling beyond the economic optimum alone adds no residual value.