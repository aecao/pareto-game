# Pareto Game

A static Roosevelt Island mapping study, designed for GitHub Pages.

## Explore: GeoPackage layers

Explore includes the seven spatial layers from the supplied `mostlypluto.gpkg`.
Each heading has a visibility checkbox and a separate chevron button. Expand
the heading for **All** and individual color-coded category checkboxes, following
the Relationships / Scale filter pattern in
[roosevelt-networks](https://github.com/aecao/roosevelt-networks).
The All control is indeterminate when only some categories are selected.
Turning a layer off/on remembers its category selection. Collapsing a heading
only hides its controls; it never changes visibility or dissolves polygons.
**Historical districts starts disabled and collapsed.** Building footprints
also have a toggle.

| Layer | NYC features | Categories |
|---|---:|---|
| Empty lots | 24,380 | All source features (LandUse 11) |
| Historical districts | 31,684 | 160 named `HistDist` values |
| Industrial / transportation | 15,363 | Industrial: LandUse 06 (9,293); Transportation: 07 (6,070) |
| Lot owner type | 856,906 | Seven `OwnerType` values, including unknown |
| Parking lots | 20,429 | All source features |
| Parks properties | 2,061 | 34 `jurisdiction` categories |
| Publicly owned waterfront | 199 | All source features |

Saved QGIS category fields/labels are retained, except Industrial explicitly
uses the user-requested LandUse 06/07 classification. Category colors are
distinct within each layer. Historical districts shows **designated tax lots**,
not dissolved district outlines; 825,222 source lots without `HistDist` are
excluded, matching their disabled null category in the saved style. Unknown
ownership is not evidence of private ownership. OwnerType S keeps the source's
unexplained "null" label rather than guessing its meaning.

Lot owner type and Historical districts start off. Their independent tile
groups are not requested until each layer is enabled; toggling either on loads
only that layer's viewport tiles. Other layers start visible. Zoom to **14+**
to load neighborhood-scale detail, pan
anywhere in NYC, or use **Fit all NYC** for orientation. At smaller zooms the
overlays are deliberately hidden with a zoom notice. Home returns to Roosevelt
Island. Layer/category choices survive mode switching. Imported layers are
removed outside Explore and never affect Siting, Connectivity or Income.

The [catalog](assets/explore_lite8/index.json) describes compressed XYZ-indexed GeoJSON
tiles. Only tiles for enabled layer groups in the current viewport are requested,
with four concurrent requests and a bounded 32-tile LRU cache. Ownership,
Historical districts, and Industrial have separate groups, so enabling Historic
or Industrial does not fetch all 856,906 ownership parcels. Their source parcel
copies were verified identical before independent display export.
Display geometries are simplified in EPSG:2263 (1 ft for parcels and
vacant lots, 2 ft for parking, 5 ft for parks and waterfront), then clipped to
each tile in WGS84 and rounded to eight decimal places for display; repeated
features carry stable IDs for browser deduplication. The source-geometry
EPSG:2263 analytical output is not rounded.
The compressed web assets are 44.6 MiB total, down from 120.9 MiB in the
whole-polygon export; the optional ownership tiles account for 36.6 MiB.
Tiles are gzip files decoded with the browser's `DecompressionStream`, checked
against catalog byte counts and SHA256 hashes before use. Errors clear imported
overlays and offer Retry; no stale partial overlay is presented as success.
Canvas renderers are reused rather than accumulated when panning.

Click a feature for its category and selected source attributes (parcel BBL,
address, land use, owner type, historic designation, zoning/version; source
identifiers, names/jurisdiction/agency where supplied by other layers). Owner
names are not published. Geometry is WGS84 for display; the companion pipeline
keeps source-geometry EPSG:2263 GeoParquet and a source-hashed manifest/profiles. Thirteen invalid
parking polygons were repaired with `make_valid`; no features were dropped.
The source GeoPackage is read-only and its hash is checked before/after export.
The exporter is `01_sites/export_explore_web.py` in the companion POSTGIS folder,
configured under `datasets.explore_gpkg`. Existing outputs are immutable.

## Data mode

Select **Data**, leave the dataset on **Household income**, choose an area scale, then click a polygon or use the
keyboard-accessible area selector. Scales are **block group**,
**census tract**, **neighborhood (NTA)** (default), **community district (CDTA approximation)**,
and **borough**. Home fits all of NYC. Scale changes replace both the selectable
polygons and popup statistics; snapshots load on demand and are cached in memory.
Canvas-rendered polygons keep the citywide view lightweight; charts are generated
only when an area is opened. Failed loads clear the layer and offer Retry.

### Origin-destination (LODES)

Select **origin-destination** in the Data dropdown. Choose **Census tract** or
**Neighborhood (NTA)** in the area-scale selector. Tract scale initially shows
only **30 selectable origins**; NTA scale shows only **four origin areas**:

| Origin area | 2020 NTA / custom area | Tracts |
|---|---|---:|
| Long Island City-Hunters Point | QN0201 | 9 |
| Queensbridge-Ravenswood-Dutch Kills | QN0105 | 12 |
| Old Astoria-Hallets Point | QN0102 | 6 |
| Roosevelt Island | Custom MN0801-RI: 238.02, 238.03, 238.04 | 3 |

At **NTA scale**, both residence origins and workplace destinations aggregate to
the 2020 NTA relationships, with Roosevelt Island separated from the remainder
of Upper East Side-Lenox Hill **at both ends**. The resulting 263 destination
areas include special NTAs and the custom island split. Four origin areas
connect through **830 NTA pairs**, preserving all **42,310 NYC primary-job links**.
The **1,095 within-NTA links** are loops (including flows between different
tracts inside the same NTA). The original tract view remains available.

At NTA scale, **Show all four study-origin NTAs** draws all 830 pairs together
without changing map zoom or position. Four connection colors identify the
individual origins; origin nodes are orange and destination nodes are blue,
with origin-specific counts retained even where destination
nodes overlap. All origins use the same NTA count-to-size scale. Per-origin
summaries and full destination tables remain expandable below the color labels.
This does not add other NYC areas as residence origins.

In both commute directions and at both scales, connections between two
selectable areas are bright magenta at higher opacity, in a dedicated pane
above ordinary connections and outlines. All node markers render above these
highlighted lines. Selectability follows the current dataset and scale, not
the current single selection. Self-loops qualify too. Threshold filtering,
exact count-based widths and original counts are unchanged; in all-origin
view, the highlight overrides the origin-specific line color for these pairs.
Line opacity also increases with the square root of the pair count divided by
the fixed per-scale maximum: ordinary opacity is `0.08 + 0.47 * sqrt(ratio)`,
key-area opacity is `0.20 + 0.75 * sqrt(ratio)`. Key links are brighter than
ordinary links at equal counts. These are cartographic display assumptions,
not changes to job counts. All lines and loops are noninteractive and have no
line tooltips, allowing clicks through to selectable polygons; node tooltips
and complete count tables remain available.

The separate **destination-origin** dataset reverses the selection: choose a
workplace NTA (or one of its native 2020 tracts) to show its NYC residence
origins. Selectable areas are Financial District-Battery Park City,
Chelsea-Hudson Yards, Midtown South-Flatiron-Union Square, Midtown-Times Square,
Murray Hill-Kips Bay, East Midtown-Turtle Bay and the four original study areas.
This explicit list replaces a numerical eligibility threshold; Murray Hill in
Queens is not included. There are 10 workplace NTAs / 91 workplace tracts,
946,971 NYC-resident primary-job links, 2,411 NTA pairs and 125,023 tract pairs.
Both ends preserve the Roosevelt Island split. Orange nodes are selected
workplaces, blue nodes are residence origins, and purple outlines are linked
residence areas. Within-area connections are small loops. All NYC residences
are eligible, not just the study areas. Non-NYC residences are excluded; these
are **not total incoming employment** or observed daily trips.

Incoming views retain the threshold slider, fixed per-scale sizing, complete
count tables, explicit errors/Retry and camera invariance on selection/filtering.
Incoming and outgoing datasets have separate scale memories and caches. The
all-four-study-origins checkbox applies only to outgoing NTA view. Incoming
assets are lazy-loaded and validated for direction, NYC residence scope,
geography and exact totals.
The **Minimum job links per pair** slider filters pairs inclusively by their
primary-job-link count, from 1 to the fixed maximum pair count at the current
scale. Its logarithmic scale gives more room to small thresholds; the adjacent
numeric input accepts any exact integer in range on Enter or blur. Both
controls stay synchronized, and the slider's accessible value text reports
actual job links rather than its internal position. Invalid numeric entries
show an error and retain the last applied diagram until corrected.
It updates connections, loops, destination nodes and destination
outlines together without moving the map; origin nodes stay visible even when
no pair qualifies. All-origin filtering applies to each pair separately, not
combined destination totals. Summaries report shown/hidden pairs and job links;
full destination tables retain all counts and shares of the origin's unfiltered
NYC total. Line/node size scales remain fixed. The threshold persists between
origin selections and Home/Clear, and resets to 1 on dataset or scale loading.
At both tract and NTA scales, unfilled purple outlines show exactly the
destination areas in the displayed connections (including within-area links).
All-origin outlines are deduplicated across origins. Native 2020 TIGER tract
polygons and their existing NTA unions are used, including the Roosevelt Island
split; no ACS boundary substitution or simplification is applied. These
noninteractive outlines do not intercept origin selection and clear with the
connections. Boundary assets load only with their corresponding OD scale;
missing or invalid boundaries produce the standard Data error and Retry state.
Unchecking hides all connections without moving the map; selecting a polygon
or an origin from the dropdown returns to its single-origin diagram and unchecks
the toggle. Home/Clear selection resets the view and turns it off. Scale,
dataset and mode changes clear it; the control is unavailable outside NTA OD.

The [NTA snapshot](assets/income/origin-destination-nta.json) is about **104 KiB**
and loads only on choosing NTA scale. It has four origin polygons, compact
destination nodes and exact aggregated counts. Native 2020 tract polygons are
unioned in EPSG:2263 before computing NTA centroids; the income layer's 2024
geometry is not substituted. Every source tract has exactly one NTA assignment.
The companion `01_sites/export_origin_destination_ntas.py` writes immutable
`nta_flows.parquet`, `ntas.parquet` and the web snapshot, using the existing
validated tract outputs and relationship workbook. All NYC jobs, resident totals
and outside-NYC exclusions reconcile with the tract view.

Select a polygon or use the keyboard-accessible tract dropdown to reveal that
area's residents-to-workplace connections. Orange is the residence origin;
blue nodes are NYC workplace centroids at the selected scale. **All positive destination pairs
are shown**, not just the largest or a thresholded subset. Line widths follow
one fixed square-root scale across selections **within each geography**:
`0.6 + sqrt(jobs / max_pair_jobs) * 15.4` CSS pixels.
Destination node radii use `1.2 + sqrt(jobs / max_pair_jobs) * 6.8` CSS pixels;
the verified maximum is **185** at tract scale and **4,332** at NTA scale.
Sizes should not be compared across scales as though their denominators matched.
low-count destinations are smaller, while the orange origin stays a distinct
fixed-size marker. The square-root scale makes differences among the many small
counts visible without rescaling each origin. These are cartographic sizes, not
literal count ratios. Tooltips and an expandable destination table give exact
counts and shares. Within-area links are retained as loops. Lines are schematic
connections, not routes. Nodes use geometric centroids computed in EPSG:2263,
which can lie outside irregular or multipart tract polygons.

The [OD snapshot](assets/income/origin-destination.json) is about **680 KiB**,
loads only when this dataset is selected, and contains only origin polygons
plus compact NYC nodes and counts. It uses **2023 LODES8 release 8.4 JT01 primary
jobs**, the latest NY JT01 OD year listed by Census when checked on 2026-10-29:

- **42,310** NYC-destination job links across **11,626** tract pairs.
- **48,212** resident primary jobs in total, independently counted from RAC.
- **5,902** links to workplaces outside NYC, explicitly counted but not drawn.
- **524** same-tract links, retained in the displayed total.

These are LODES residence/workplace **primary-job links**, not observations of
daily trips, travel mode or commuting frequency. The NYC-only restriction is
user-selected. Origins are all resident blocks assigned to the selected tracts
by the official LODES block-to-tract crosswalk, including Census boundary
corrections, not workplace totals or inferred reverse flows.
Native **2020 TIGER tract geometry** is used rather than the ACS income layer's
2024 geometry. Roosevelt Island is the existing custom three-tract split, not
an official standalone NTA.

Selecting an origin replaces the diagram without changing map zoom or position,
whether selected through the dropdown or by clicking its polygon. **Home**, **Clear selection**,
or the blank dropdown choice removes nodes/connections and fits the origins at
the chosen scale (30 tracts or four NTA areas).
Leaving Data or changing datasets also clears selection. Returning starts with
origins only. The previous household-income scale and the chosen OD scale are
remembered separately when changing datasets. Transportation-by-earnings remains
tract-only; unsupported scale options are disabled per dataset.
A shared Canvas renderer bounds repeated-selection
resource use; only the selected origin's links are drawn.
OD script/data URLs are versioned so reloading fetches the current camera and
size behavior rather than reusing the earlier auto-fitting script.

The companion `01_sites/export_origin_destination.py` first profiles source
columns, keys, nulls, hashes, counts and geometry; `--export` requires approved
`datasets.lodes_origin_destination` configuration. Official decompressed
checksums are verified for OD, RAC and the existing LODES crosswalk. Analytical
Parquet outputs retain exact pair counts and EPSG:2263 tracts. Sources remain
untouched; output paths are immutable. No citywide spatial overlay or database
change is needed: all aggregation uses the official tabular crosswalk.

### Transportation by earnings and commute modes

The dataset dropdown also offers **Transportation by earnings + commute modes**,
restricted to **census tracts**. Switching back restores the previous household
scale. Click any tract to see two charts side by side (vertically on narrow
screens):

- **B08119**: worker counts stacked by six published transportation modes over
  eight individual-earnings bands, from `$1 to $9,999 or loss` to `$75,000 or more`.
  This is **individual earnings**, not household income. Public transportation
  is one combined series; taxi, motorcycle, bicycle and other means are another.
  Points use closed-band midpoints and open-tail endpoints, with unequal dollar
  spacing. Connecting grouped counts is a display convention, not a density or
  inferred within-band earnings.
- **B08301 pie**: car/truck/van/taxi, bus, subway, rail (commuter and light rail),
  ferry, motorcycle, bicycle, walked, other and worked from home. Shares use the
  B08301 total. All source counts and MOEs remain in the expandable tables;
  zero-total shares are explicitly unavailable.

The [transport snapshot](assets/income/transport-tracts.json) holds all **2,327
NYC tracts**, with **3,926,603 workers with earnings** in B08119 and **3,926,797
workers age 16+** in B08301. These universes differ; the totals are not forced to
match. B08119 uses the supplied **2020-2024 ACS native tract estimates and original
90% MOEs**. B08301 sums the existing NHGIS block groups inside each tract, with
approximate 90% MOEs computed from all contributing source cells by
root-sum-of-squares, rounded up once. Percentages are descriptive; no percentage
MOEs are fabricated.

The companion `01_sites/export_transport_tracts.py` validates every mode/band
sum, exact key membership, geometry validity and source fingerprints; its
parameters are in `datasets.transport_tracts`. Geometry is reused from the
existing tract snapshot, not duplicated. Source files remain untouched.
Transportation assets are fetched only on selection and cached separately from
income; stale responses cannot replace a newer selection. No Roosevelt Island
comparison is added. Grey marks the **90 tracts with zero estimated workers with
earnings**, not missing data; they remain clickable. Home fits all NYC.
The internal mode key remains `income` for compatibility; its visible name is Data.

### Household-income geography and methodology

The supplied `nyc2020census_tract_nta_cdta_relationships.xlsx` maps every source
block group via its 11-digit tract GEOID: **2,327 tracts**, **263 neighborhood areas**, **71 CDTAs**
and **5 boroughs**. Special-area NTAs and Joint Interest Areas are retained.
Neighborhoods use the 262 official NTAs with one user-specified split:
Roosevelt Island (tract GEOIDs `36061023802`, `36061023803`, `36061023804`;
display ID `MN0801-RI`) is separate from the remainder of `MN0801`, renamed
Upper East Side-Lenox Hill. These two display areas are labeled as custom, not
official NTAs. The split changes no tract, CDTA or borough assignments.
CDTAs approximate community districts; they are not exact legal boundaries.
NTAs/CDTAs may cross borough boundaries, while borough totals use the original
county. Aggregate polygons are unions of 2024 TIGER block groups assigned through
the 2020 crosswalk, not official NTA/CD boundary files.
Every scale includes all 6,807 source block groups and **3,334,088 estimated
households**, with no clipping, weighting or unmatched records.

The [NYC snapshot](assets/income/block-groups.json) contains Bronx **1,182**,
Brooklyn **2,156**, Manhattan **1,292**, Queens **1,803**, and Staten Island **374**
block groups. All records match 2024 TIGER/Line boundaries one-to-one; nothing is
clipped or allocated to districts. **442** block groups have zero estimated
households; their bars stay at zero, with the original nonzero MOEs retained.
These 442 zero-household block groups have grey fill and outlines, with a
"No estimated households" tooltip/popup notice. Positive-total groups remain
blue, even when individual income bands are zero. Grey is not a missing-data
claim; all groups remain clickable and their source estimates are preserved.

Source: [2020–2024 ACS five-year B19001](https://data.census.gov/table/ACSDT5Y2024.B19001)
via the supplied IPUMS NHGIS `nhgis0007` / `ds272` extract. This is **household
income**, not the individual-income measure from the earlier tract page. The
user approved the change of universe. Filled-line charts show dollar-value ticks
on x and **number of households** on y, in **2024 inflation-adjusted dollars**.
The first category is less than $10,000; the last is $200,000 or more (open-ended).
The 16 source bins have unequal income widths. Closed bins sit at their midpoints
on the dollar scale; the open-ended lowest and $200,000+ bins sit at the chart ends.
Straight segments connect the counts for display: the fill is **not** a continuous
income density or an estimate at an exact dollar amount. No smoothing or invented
within-band estimates are used. Hover/focus points for original ranges and values;
expand **Source ranges, estimates & uncertainty** for the table listing every exact
count and its own **90% MOE in households**. Original block-group MOEs are preserved.
At larger scales, estimates are sums and each MOE is an **approximation**:
`ceil(sqrt(sum(source_moe ** 2)))`. Covariances are unavailable; these are not
independently published tract/NTA/CDTA/borough ACS estimates. Popups explicitly
label the approximation. MOEs are not arithmetically summed or converted to
percentage MOEs. Small-area sampling uncertainty can be large.

On desktop the complete chart scales to the popup width without horizontal
scrolling; the source table is collapsed initially to keep the plot visible.
On narrow/mobile screens the plot can scroll horizontally to retain readable axes.
All series use darker, uniform fills (55% opacity), not gradients. Other
neighborhood charts overlay Roosevelt Island in orange with a dashed outline;
the selected neighborhood is blue. Both share the same absolute household-count
axis, scaled to the larger series; they are not normalized to percentages.
The legend, point hover/focus text and expanded uncertainty table identify both
series. Roosevelt Island's own chart and non-neighborhood scales remain single-series.

Citation: **IPUMS NHGIS, University of Minnesota, www.nhgis.org.**
Jonathan Schroeder et al. *IPUMS National Historical Geographic Information
System: Version 21.0* [dataset]. Minneapolis, MN: IPUMS. 2026.
[doi:10.18128/D050.V21.0](https://doi.org/10.18128/D050.V21.0).
The user confirmed NHGIS redistribution permission on 2026-10-27. The complete
supplied statewide table is imported locally, not bundled with the web app.

The companion exporter is `01_sites/export_income_block_groups.py`, configured
under `datasets.income_block_groups`. It preserves all **496 columns** and
**16,031 data rows** in a local Parquet import, explicitly excludes the single
descriptive header row, then exports all NYC household-income records. It
checks all 34 estimate/MOE fields, exact NHGIS/TIGER keys and band totals, and
produces EPSG:2263 GeoParquet, source hashes, validation logs and WGS84 web JSON.
Outputs are immutable; archive reviewed outputs explicitly before regeneration.
The aggregate exporter is `01_sites/export_income_geographies.py`, configured
under `datasets.income_geographies`, writing [scale snapshots](assets/income/geographies/)
and EPSG:2263 GeoParquet. It checks unique crosswalk keys, complete membership,
exact income-band totals, valid dissolved polygons and unchanged citywide totals.
The old B06010 individual-income tract snapshot remains historical only and is
not loaded by Income; the new tract scale aggregates B19001 household income.
No live Census API key or database is required by the static app.

## Visual style

The interface follows the visual language of [aecao/portfolio](https://github.com/aecao/portfolio):
Helvetica Neue / Helvetica / Arial, light body text, bold headings, white panels,
near-black text (`#15120f`), thin rules and square-edged controls. Navigation uses
a black outline for the active mode and black/white hover states. The portfolio's
blue (`#0035ff`) identifies top-ten sites meeting the current proxy target,
focus and selection accents; teal (`#2a6c68`) marks other ranked sites meeting
the target. Sites with known insufficient capacity are red (`#c62828`),
regardless of rank, and recolor when assumptions change. Other unranked or
unknown-capacity sites remain gray; all unranked sites retain dashed outlines.
Terracotta (`#b8432f`) marks review warnings and building footprints.

UI and Leaflet overlay colors share the CSS custom properties in `styles.css`,
so map polygons and their legend stay consistent. Labels and warnings remain
explicit; color alone does not establish a site's rank or eligibility.
The system font stack needs no external font downloads. The analytical
three-panel workspace remains wider than the portfolio gallery so the map and
ranking controls can be used together.

## Connectivity mode

The former Map Style selector has been removed in every mode; the light basemap
remains. In Connectivity, its place is an eight-button **Origin** selector:
Main Street (default), Coler, Cornell Tech, Long Island City, Queensbridge Houses,
Astoria Houses, Ravenswood Houses, and East River Esplanade.
All eight markers are shown. Selecting an alternate origin hides Main Street's
isochrones, metrics and origin connector, while retaining proposed bridge geometry.
Walking controls are disabled until Main Street is selected again; its existing
budget and bridge choices are preserved. No new isochrones have been generated.

Alternate locations are provisional, not verified entrances or snapped routing
nodes. Coler (BIN 1040750) and Cornell Tech (BIN 1089785) use footprint centroids
calculated in EPSG:2263, then transformed to EPSG:4326. Queens markers use the
user-supplied addresses matched by NYC GeoSearch (fallback, confidence 0.8).
East River Esplanade uses an East Midtown Greenway vertex near East 54th Street.
Marker popups expose the placement source. Main Street retains the exact current
snapshot origin, rather than a new address geocode.
The source definitions live in the companion POSTGIS `config.yaml`, under
`walking_bridge.origins`; run `01_sites/export_connectivity_origins.py` to
refresh `assets/connectivity/origins.json`. This exports only markers and checks
that Main Street agrees exactly with the existing walking snapshot.

Travel-mode buttons above the bridge toggles show **Walking** selected and
**Biking** disabled (isochrones not available yet). No biking routing is generated.
The map always compares baseline reach with the selected bridges; there is no
map-comparison dropdown. Baseline remains drawn in front of selected-bridge reach.

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

## Housing mode

Housing loads the live published Google Sheet's `developments` (gid 2081099550)
and `buildings` (gid 898231653) tabs on entry and on **Refresh from sheet**.
Publication can lag edits. A failed request or invalid schema displays an
explicit error and no chart, not a stale or fabricated fallback.

Wide, touching revenue bars are ordered highest first and stack operating-fund
revenue, capital-fund revenue, ground rent and public-safety reimbursement.
Their sum must equal the reported total. NPV columns are excluded. The period
is copied from the sheet; values are not annualized. `General` is shown
separately as unclassified, not ranked among developments.

The development chart displays revenue only; floor overlays and height columns
are currently removed. Floor fields remain preserved in the parsed source data.

A second chart uses icon arrays to show individual building unit counts, grouped
by the revenue chart's development order and then natural building-number order.
Each square is exactly one unit. Every building uses ten columns with identical
icon sizes and spacing, filling left to right from the bottom; larger counts
produce taller arrays. Category colors are preserved with no rounding.
Building labels use `aka`, with the source building name as fallback, and show
the address underneath (or explicitly say unknown). Original building names
remain the identity and sorting keys; aliases do not reorder building numbers.
Categories are market-rent, market-condo, institutional and affordable, not
bedroom types. Blank or `some` category cells remain unknown. A known total's
unallocated remainder is gray, never distributed among guessed categories.
The source table preserves unknown cells even if the remainder is zero.
Inconsistent known totals fail explicitly. Named buildings with unit data but
no development link (including an `aka` name when `building` is blank) appear
under Unassigned. Payment-only rows and unnamed placeholders are omitted.
Buildings linked to a development with no unit data remain labeled unknown.
No observation date for unit counts is supplied separately in the source.

Tests use preserved public CSV fixtures retrieved 2026-10-23 in
`tests/fixtures/housing/`; runtime does not use those fixtures.

## Siting mode

Select **Siting** in the header to explore the Queens waterfront pilot. The
existing **Explore** view and its building popups remain available.

The expanded pilot contains **176 groups / 2,621 tax lots**: 155 ranked multi-lot
assemblages and 21 unranked groups (17 singletons and four groups with
incomplete inputs). All remain visible on the map and in the ranking list.
Map selection and list selection share a detail panel. Top-ten ranks are
numbered on the map; park overlap and unresolved zoning conditions remain
visible even for highly ranked sites.

The controls recalculate locally, without a database connection:

| Parameter | Default |
|---|---|
| Gross new affordable units | 800 |
| Net unit size | 750 square feet |
| Net-to-gross efficiency | 82% |
| Target accommodation weight | 40% |
| Fewer existing units removed weight | 40% |
| Fewer lots to assemble weight | 20% |

Weights must be nonnegative and total 100%. Custom weights are labeled
exploratory, not the approved baseline policy. Invalid/blank inputs show an
explicit error and mark the displayed values as the **last valid results**.
Reset restores all six defaults. Input changes do not persist across reloads
and do not change the source snapshot or Python pipeline outputs. The browser's
initial and reset target is 800 units; the saved source snapshot and pipeline
baseline remain 5,000 units.

### What the ranking means

- Required residential gross floor area = new units × net unit size ÷
  efficiency. Proxy replacement units = fixed base-FAR floor area × efficiency
  ÷ net unit size.
- Fixed base-FAR floor area = `sum(LotArea * ResidFAR)`. This represents full
  replacement, **not unused FAR, verified legal entitlement or buildable yield**.
- Accommodation = `min(proxy floor area / required floor area, 1)`.
  Fewer removals and fewer lots use inverse min-max normalization within the
  155 complete multi-lot candidates. Constant components tie at one.
- Score = 100 × weighted component sum. Scores are not feasibility percentages.
  Exact-score ties share minimum rank; site ID orders tied rows. Displayed
  scores are rounded but ranks use full precision.
- All existing residential units are presumed removed. Conditional net units =
  gross target minus existing units removed, not an achieved forecast, net
  affordable-unit gain, or displaced-household count. Unknowns stay unknown;
  singles and incomplete groups never become ranked by changing weights.
- At the 800-unit browser default, **eight of 155 ranked sites** meet the proxy target.
  At the saved 5,000-unit baseline, **zero of 155 ranked sites** meet the target.
  At a 1,000-unit target with other defaults unchanged, seven meet the proxy
  target. Neither result demonstrates legal/financial/engineering feasibility.

The 2,000-foot shoreline corridor is a speculative screening boundary, not a
landing or bridge-approach standard. Boundary revision `roosevelt_facing_v3_2000ft`
excludes the detached Dutch Kills creek shoreline **before buffering** because
it does not face Roosevelt Island. Doubling the former 1,000-foot corridor
adds 104 groups while retaining all 72 previous groups. Whole assemblages that
intersect the corridor are retained, including portions farther inland.
Scores/ranks are regenerated over the expanded cohort. One lot in
`Q00018_4000180001` intersects the East River Subdistrict, whose chapter/section
mapping remains unresolved; the site detail explicitly flags manual rule lookup.
No effective zoning capacity is assigned.
The 1,000-foot outputs and web snapshot are preserved in the companion workspace
under `outputs/archive/20261020_before_2000ft_corridor/`.
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
validator compares JavaScript against Python for all 176 groups across six
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

Hover over four-quadrant axis/quadrant labels or either model's handle labels
to read a plain-language definition, with examples and illustrative-unit
caveats. Definitions also appear on keyboard focus; static diagram labels are
tab stops. The popover stays open while hovered and Escape dismisses it.
Definitions are available to assistive technology independently of the visible
popover. Scrolling repositions the popover or hides it when its label leaves
the viewport. Dragging, switching views or redrawing clears stale popovers
without changing assumptions.

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