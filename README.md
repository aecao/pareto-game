# Pareto Game

A static Roosevelt Island mapping study, designed for GitHub Pages.

## Siting mode

Select **Siting** in the header to explore the Queens waterfront pilot. The
existing **Explore** view and its building popups remain available.

The pilot contains **101 groups / 1,082 tax lots**: 80 ranked multi-lot
assemblages and 21 unranked groups (18 singletons and three groups with
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
  80 complete multi-lot candidates. Constant components tie at one.
- Score = 100 × weighted component sum. Scores are not feasibility percentages.
  Exact-score ties share minimum rank; site ID orders tied rows. Displayed
  scores are rounded but ranks use full precision.
- All existing residential units are presumed removed. Conditional net units =
  gross target minus existing units removed, not an achieved forecast, net
  affordable-unit gain, or displaced-household count. Unknowns stay unknown;
  singles and incomplete groups never become ranked by changing weights.
- At defaults, **zero of 80 ranked sites** meet 5,000 units under the proxy.
  At a 1,000-unit target with other defaults unchanged, seven meet the proxy
  target. Neither result demonstrates legal/financial/engineering feasibility.

The 1,000-foot shoreline corridor is a speculative screening boundary, not a
landing or bridge-approach standard. Assemblages are maximal shared-edge groups
within tax blocks, not verified legal zoning lots. Capacity, approvals,
ownership, displacement, affordability delivery and costs remain unresolved.
This is a **mode-neutral redevelopment screen** shared with no-bridge
redevelopment, not a comparison of pedestrian/bike, transit or vehicle bridge
benefits. Retention adds/removes zero units.

### Data and reproducibility

[`assets/siting/pilot.json`](assets/siting/pilot.json) is a roughly 247 KB static
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
validator compares JavaScript against Python for all 101 groups across five
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
JSON and CSV assets. Leaflet, fonts and basemap tiles retain their existing
external-network dependencies.

## Tests

No package installation is required. With Node.js 24, run:

```powershell
node --test tests\siting-model.test.cjs
```

Tests verify the complete original ranking, changed assumptions and weights,
ties, constant components, unknowns, negative net gains, exact target thresholds
and invalid inputs. The browser UI has also been checked at desktop and mobile
sizes, including map/list selection, reset, error/retry and Explore restoration.

## Publish with GitHub Pages

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. Push to `main` to trigger the deployment workflow. The site will be available at https://aecao.github.io/pareto-game/ after the first successful deployment.

The workflow tests the Siting model before publishing. All asset URLs are
relative, so deployment under the `/pareto-game/` project path works without a
backend. Local changes are not published until committed and pushed.

Building and place assets belong in [`assets/buildings/`](assets/buildings/); see its README for the expected GeoJSON format.