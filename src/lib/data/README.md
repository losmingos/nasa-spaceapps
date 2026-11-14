# Jarvis data: MEDA curves, MEDA snapshot and mission points

## `meda-curves.json`: MEDA daily curves replayed at the scene's local time

Built by `scripts/build_meda.ts` (`npm run data:meda`). Read by `src/lib/jarvis/weather.ts` (client telemetry) and `src/lib/server/jarvis/prompt.ts` (only the newest published sol, for the static provenance text).

**There is no real-time MEDA feed.** The MEDA team releases calibrated and derived data to the NASA PDS in batches, about three times a year. At build time (2026-11-14) the newest published sol was **1859** (2026-05-13/14 UTC, folder `sol_1740_1859`). The next Mars 2020 PDS release was announced for 2026-12-08. Re-run `npm run data:meda` after a release and it picks up the new sols automatically.

**Source:** NASA PDS Atmospheres Node, Mars 2020 MEDA bundle, <https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/>, folders `data_calibrated_env/sol_XXXX_YYYY/sol_NNNN/` and `data_derived_env/...`. Each curve lists the exact product files it used (`files`, relative to `base_url`).

| Field | Product | Column(s) |
|---|---|---|
| `air_temp_c` | `CAL_ATS` | Mean of `ATS_LOCAL_TEMP1`–`3` (the three sensors on the mast booms, ~1.45 m), K → °C. ATS 4–5 sit on the rover body and are not used. |
| `pressure_pa` | `DER_PS` | `PRESSURE` |
| `relative_humidity_pct` | `DER_RHS` | `LOCAL_RELATIVE_HUMIDITY` |
| `ground_temp_c` | `CAL_TIRS` | `GROUND_TEMP` (TIRS ground brightness temperature), K → °C |
| `wind_ms` | `DER_WS` | `HORIZONTAL_WIND_SPEED`. Only exists up to sol 313. |

**Method.** Every value is the mean of all samples in a 10-minute LMST bin (bin *i* covers minutes 10*i* to 10*i*+10 after local midnight, so 144 bins). A bin with no sample is `null`. MEDA usually records about 30 minutes of every hour (plus some full hours), so many bins are null. The client interpolates linearly between bins with data across gaps of up to 2 h. Rows from another sol (by the LMST sol prefix) and out-of-range values (fill values such as 999999999) are ignored. The product version (`P01`/`P02`/`P03`) is read from the folder listing, and the newest version is used.

**Curves.**
- `latest`: the newest sol with usable temperature and pressure (≥ 48 filled bins each and no gap longer than 2 h).
- `season`: one sol per 10° Ls bin (36 bins). For each bin the script tries the sols of the newest Mars year first, closest to the bin centre, and keeps the first usable one. The client picks the curve whose Ls is closest to the scene's Ls. `empty_ls_bins` lists bins with no usable sol.
- `storm`: sol 313 (2022-01-05/06), the real arrival of the January 2022 regional dust storm, with wind until ~13:08 LMST.

**Mars time.** `src/lib/mars-clock.ts` (import-free) uses the Allison & McEwen (2000) / NASA GISS Mars24 algorithm, with the same constants as `src/lib/mars-time.ts`. The visor's "local sol" is the Mars Sol Date at Jezero LMST (longitude 77.41° E). The Mars 2020 mission sol is local sol − 52304. Checks:
- Landing at 2021-02-18 20:55 UTC (Earth receive time) gives mission sol 0.67, ≈ 16:04 LMST. The landing itself, 11 min earlier, was at ≈ 15:53 LMST.
- The PDS label start times of sol 313 (2022-01-05T18:55:07Z) and sol 1859 (2026-05-13T06:57:14Z) give exactly mission sol 313.000 and 1859.000, that is, LMST midnight.
- Sol 1762 starts on 2026-02-02 (~15 UTC).
- The computed Ls matches the labels' `start_solar_longitude` (for sol 1859, 281.32° vs 281.325°). The build prints the largest difference.
- The Mars year follows the Clancy et al. convention (MY 1 began on 1955-04-11). Computed start dates: MY 36 2021-02-07, MY 37 2022-12-26, MY 38 2024-11-12, MY 39 2026-09-29/30.

**Signal delay.** One-way Earth–Mars light time comes from JPL's "Approximate Positions of the Planets" Keplerian elements (valid 1800–2050, ~1 % in distance). Checks: 2003-08-27 closest approach gives 0.3730 AU (3.1 min; the true value is 0.3727 AU). 2025-01-12 gives 0.642 AU (5.3 min). The 2026-01-09 solar conjunction gives 2.40 AU (20.0 min).

**Storm and dust.** On `storm_start` the client blends temperature, pressure, humidity and ground temperature from the season curve to the sol-313 curve at the same LMST, with a 60 s smoothstep. Wind comes from the sol-313 curve, so it is null after 13:08 LMST. `dust_opacity` is null in clear weather, because MEDA curves carry no optical depth. During the storm it ramps from 0.327 (Mastcam-Z, sol 311, pre-storm) towards ~2 (storm peak, Lemmon et al. 2022), with a time constant of 30 s.

**Caveats**
- These are real measurements, replayed for the scene's local time and season. They are not a live reading, and they are not from the scene's exact spot.
- Perseverance crossed Jezero's rim in December 2024 (~sol 1355). Curves after that date come from the crater rim, not from the crater floor or the delta shown in the scene (see each curve's `region`).
- The storm blend mixes two different seasons (sol 313 is at Ls ≈ 153°). A pressure jump during the blend is mostly seasonal, not caused by the storm.
- `ground_temp_c` is a brightness temperature, and some TIRS samples may be affected by rover shadow or by wheels in the field of view. The script does not filter them by quality flags.

## `meda-snapshot.json`: Mars 2020 MEDA, sol 313

Still used only for the pre-recorded lines (L01 and Q4 cite its temperature and pressure: `src/lib/jarvis/lines.ts`, `scripts/gen_lines.ts`, `ui/shared.ts`). Live telemetry uses `meda-curves.json`.

**Why sol 313 (2022-01-05/06 UTC, Ls ≈ 153°):** it is the day the January 2022 regional dust storm reached Jezero. The storm arrived in the late morning, gusts reached 22 m/s, and that afternoon had the storm's deepest pressure minimum (Lemmon et al. 2022). It is also the last sol with derived wind data before the wind sensor was damaged.

**Source:** NASA PDS Atmospheres Node, Mars 2020 MEDA bundle: <https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/>

| Field | Product (sol 313) | How it was computed |
|---|---|---|
| `air_temp_c.value` = −18.8 | `data_calibrated_env/.../WE__0313___________CAL_ATS_________________P01.CSV` | Mean of the 3 mast sensors (ATS_LOCAL_TEMP1–3), K → °C, 30 min window LMST 11:45–12:15 |
| `air_temp_c.min_sol` / `max_sol` = −77.9 / −2.9 | same | Extremes of the 1-s 3-sensor mean (04:58 / 13:38 LMST) |
| `pressure_pa` = 624.6 | `data_derived_env/.../WE__0313___________DER_PS__________________P03.CSV` | Sol mean (mean of the 24 hourly means). 613.3 Pa at the snapshot time; range 583.5–642.9 Pa |
| `relative_humidity_pct` = 0.0 | `.../WE__0313___________DER_RHS_________________P03.CSV` | 30 min window at noon. Hourly means are 0.00 from 09 to 17 LMST; the sol peak was 34.6 % at 04:28 LMST |
| `wind_ms` = 6.5 | `.../WE__0313___________DER_WS__________________P02.CSV` | Mean HORIZONTAL_WIND_SPEED, 30 min window at noon. Sol max 22.5 m/s (09:48 LMST), 22.2 m/s at 13:08 LMST |
| `dust_opacity` = null | none for sol 313 | See below |

`local_time` is LMST 12:00, which is LTST ≈ 12:34 and ≈ 2022-01-06T07:15Z (from SCLK and the label start time).

**Check against the literature:** the wind file has 22.18 m/s at LTST 13:42:15. That matches the "22 m/s at 13:42 LTST" peak reported by Lemmon et al. for sol 313.

**Sensors with data on sol 313:** ATS, PS, RHS, TIRS, WS (partial), plus RDS in calibrated form.
- **Wind is partial.** Derived wind data on sol 313 ends at ~13:08 LMST, when the boom-2 sensor was hit by wind-blown debris. The derived WS files for sols 314–315 contain only fill values (999999999), and sols ≥ 316 have no WS file. Lemmon et al. report the other boom stopped at 14:24 on sol 315.
- **Dust opacity is null on purpose.** The Mastcam-Z optical-depth record (Lemmon, Mendeley Data, doi:10.17632/gktjp9jptb.2, marked PRELIMINARY) has no measurements between sol 311 (τ = 0.327 at 544 nm, pre-storm) and sol 319 (τ = 0.458). The published storm peak is "~2" (Lemmon et al. 2022). These bracketing values are in `dust_opacity_context`, so the telemetry can ramp from 0.33 towards ~2 with real, cited endpoints. We did not derive τ from RDS, because that needs a radiative-transfer retrieval.

**References**
- Lemmon, M. T., et al. (2022). Dust, Sand, and Winds Within an Active Martian Storm in Jezero Crater. *GRL* 49, e2022GL100126. doi:10.1029/2022GL100126
- Lemmon, M. T. (2026). The Perseverance Rover's Mastcam-Z Visible Aerosol Optical Depth Record, v2. Mendeley Data. <https://data.mendeley.com/datasets/gktjp9jptb/2>
- Conference abstract on the same storm: <https://web.lmd.jussieu.fr/~aspiga/antichambre/ABS/antoinem/oral_Lemmon_Mark.txt>

Caveat: MEDA measured at the rover's position on the crater floor, not at the scene's sample site. The snapshot is real weather from inside Jezero on that sol, not a measurement at the exact point we show.

## `../mission.ts`: points on the DTM

**Terrain:** `static/terrain/jezero.bin`, built from HiRISE DTM `DTEEC_002387_1985_003798_1985_A01` (every 16th sample): 434 × 722 nodes, 16.154 m spacing, elevations in m (Mars 2000 datum).

**Coordinate convention** (same as `src/lib/terrain.ts`):
- `x = col·spacing − width/2`, `z = row·spacing − length/2`, mesh centred on (0, 0).
- `y = elevation − low`, where `low` = −2600.27 m for the current file.
- +x = east and −z = north. This is confirmed from the DTM's PDS label: an equirectangular map with `MAP_PROJECTION_ROTATION = 0`, `POSITIVE_LONGITUDE_DIRECTION = EAST`, and line 1 at `MAXIMUM_LATITUDE`.

**Chosen points**

| Point | x, z (m) | Elevation (m) | Lat / lon (°N / °E, planetocentric) |
|---|---|---|---|
| SPAWN | 1578.9, −348.7 | −2531.8 | 18.4963 / 77.4326 |
| SAMPLE | 1575.1, −347.3 | −2531.9 | 18.4963 / 77.4326 |
| waypoint | 1720, −400 | −2531.8 | 18.4972 / 77.4351 |
| waypoint | 1920, −560 | −2534.6 | 18.4999 / 77.4386 |
| HABITAT | 2027.4, −799.6 | −2534.8 | 18.5040 / 77.4405 |

The route is 672.9 m long (640 m straight-line), bearing 45°, so `HABITAT_BEARING` stays `north-east`. At `WALK_SPEED_MS` = 1.0 that is about 11 minutes.

**How they were chosen** (Node scripts outside the repo):
1. Slope at each node from central differences.
2. **SAMPLE:** gentle crater-floor ground at the foot of the western-delta front, in the bay between two lobes. Requirements: slope < 5° at the node, no node > 10° within 48 m, a steep (> 20°) node at least 15 m higher within ~100 m, the scarp top ≥ 40 m higher within ~160 m, and valid data within ~320 m. The nearest slope > 15° is 58 m away, and the scarp face reaches ~30°.
3. **HABITAT:** no node > 5° within 48 m, valid data within ~190 m, and 450–650 m from SAMPLE.
4. **ROUTE:** grid A* (slope < 11°), simplified, then the middle waypoints were moved by hand away from the scarp foot. Each segment was sampled every 4 m. Results: max node slope 3.5°, max along-route grade 3.1°, ≥ 58 m from any slope > 15°, all on valid data.
5. **SPAWN:** 4 m from SAMPLE along the first route leg, so the player starts facing the sample with the scarp behind it.

**Caveats:** the 16 m grid does not resolve boulders, ripples or small craters. The scene team must check the points visually, especially with vertical exaggeration (mesh `scale.y`), which multiplies the heights above.
