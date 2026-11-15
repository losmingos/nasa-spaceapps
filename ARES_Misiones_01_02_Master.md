---
title: "ARES | Mission and SARA design dossier"
subtitle: "NASA Space Apps Challenge 2026 · Jezero Crater, Mars"
version: "1.0 · Consolidated scenario design"
date: "2026-11-14"
language: "en"
status: "Fictional demonstration design"
---

# ARES mission design dossier

This production reference covers ARES-01, **The Last Sample**, and ARES-02, **Nightfall Protocol**. Both scenarios take place during fictional future expeditions. Terrain, geology, weather observations and human spaceflight precedents inform the design. Vehicle systems, crew, thresholds and mission events are simulated. See the [technical documentation](DOCUMENTATION.md) for the playable implementation and [resource credits](RESOURCES.md) for the source datasets.

## 1. Shared principles

ARES brings together mapping, topography, weather, navigation, suit and rover telemetry and hazard assessment. SARA presents the evidence, explains uncertainty and recommends actions. The astronaut confirms consequential decisions. Under a critical simulated limit, SARA issues a short operational instruction to stop work.

- Crew safety takes priority over sample recovery and equipment delivery.
- Record provenance, time, units and quality. The proposed labels distinguish observed, derived, simulated and design-assumption values.
- Treat degraded sensors and uncertain navigation as explicit conditions. Navigation combines hypothetical inertial, terrain and rover-beacon references.
- Dust affects visibility, instruments, contamination and mobility. The relatively thin Martian atmosphere limits wind force. Keep the visual effects grounded in those hazards.
- A rock impact can damage the outer suit cover. Read the pressure trend before evaluating the pressure layer.
- The rover can shelter the crew while essential systems have power. Assess energy and thermal loads over time.
- The single astronaut is a production simplification. Preserve visible time transitions when editing long walks or drives.

| Layer | Role and provenance |
| --- | --- |
| Optical imagery and elevation | Orbital products establish terrain and broad obstacles within the source resolution |
| Geology | Published Jezero mapping and Wildcat Ridge observations inform target selection |
| Atmosphere | Historical MEDA wind, temperature, pressure, dust and solar measurements |
| Suit and rover | Simulated pressure, power, navigation, battery, heat and propulsion readings |
| Navigation | Surveyed corridors, risk polygons, detours and position uncertainty |

MEDA's radiative measurements describe the weather environment. Astronaut ionizing radiation dose is a separate quantity. Dust optical depth and visibility distance are also distinct quantities.

## 2. ARES-01 · The Last Sample

The astronaut aims to collect a small, fine-grained mudstone core on a fictional terrace inspired by Wildcat Ridge. A core could preserve depositional layers, mineralogy, chemistry and organic compounds for later analysis. Perseverance cores from the real outcrop were about 13 mm in diameter and 60 mm long. The fictional terrace is reached on foot because narrow, rocky ground constrains the rover.

Reconnaissance, photography and site selection precede the scene. The remaining sequence is surface preparation or abrasion, coring while preserving stratigraphic context, then retrieval, sealing and identification. The main core is unfinished when the astronaut aborts. Save the site, progress and images for a later attempt.

### Scenario figures

| Parameter | Original film treatment | Playable reference |
| --- | --- | --- |
| Rover to site | 350 m on foot | 70 m |
| Surveyed detour | 65 m added | 13 m added |
| Rover to base | 2.4 km | 2.4 km |
| Work remaining | About 10 minutes | About 10 minutes |
| Film duration | About 3:30 | Reference playback runs 2:58 |
| Final position fix | About 90 m remaining after an edit | About 18 m in the scripted briefing |

Original optional test values were −25 °C, 720 Pa, 7 m/s wind, 2,500 m visibility, 76% suit battery and 3 h 10 min of oxygen. These are design values. The simulated decision follows a worsening trend and a shrinking navigation margin. The January 2022 regional storm and MEDA measurements provide historical references. An exterior camera can lose contrast before the rover loses all landmarks.

### Original storyboard

| Screen time | Action and response | State |
| --- | --- | --- |
| 00:00 | The astronaut drills at the outcrop. SARA identifies the sediment target and the HUD shows ten minutes remaining. | `SAMPLING` |
| 00:20 | Dust lowers contrast. SARA recommends returning and asks whether to continue. | `WEATHER_ADVISORY` |
| 00:25–00:35 | The astronaut confirms continuation. SARA monitors the shrinking safety margin. | `CONTINUE_WITH_WARNING` |
| 00:40 | The measured trend crosses the simulated margin. SARA directs the astronaut to abort and return. | `EVA_ABORT` |
| 00:44–01:00 | The astronaut asks for time to finish. SARA reports the ten-minute requirement. The astronaut stops and secures the drill. | `RETURN_PREP` |
| 01:05 | Start the walk to the rover using the marked corridor. | `RETURN_EVA` |
| 01:30–01:40 | Loose regolith and lateral slope block the corridor. Stop and propose a surveyed detour when localization permits. | `HAZARD_DETECTED`, `REROUTE` |
| 01:40–02:02 | The astronaut steps on a loose rock, falls and grazes the suit on an edge. SARA checks the pressure trend and reports stable pressure with possible superficial damage. | `SUIT_DIAGNOSTIC` |
| 02:05 | A time cut advances the walk. The astronaut asks for a position check and SARA uses inertial and rover references. | `LOCALIZATION_CHECK` |
| 02:35 | The rover comes into view. Enter and confirm pressurization. | `ROVER_SHELTER` |
| 03:00 | Load the surveyed 2.4 km base route and recommend reduced speed. | `BASE_RETURN` |
| 03:30 | Cut to base. Crew safe, core pending and field records saved. | `MISSION_CLOSED` |

For the fall sequence, show the lost footing at 01:48, rock contact at 01:51, the sensor check at 01:53, a possible outer-layer damage call at 01:57 and the stable-pressure result at 02:02. An impact alone supports an uncertain damage alert. A confirmed pressure leak belongs to a separate emergency branch. If localization is degraded, hold and obtain a fresh fix before displaying a precise route. Other branches include returning at the first advisory and stopping to coordinate assistance if there is no safe corridor.

Use a yellow trend card for the advisory, a short red abort banner, a marked risk corridor and detour, and a suit diagnostic panel. Increase tension through falling contrast and concise radio calls. End with the pressurized shelter and a debrief that reports the partial scientific result.

## 3. ARES-02 · Nightfall Protocol

Deliver a spare power module and equipment to Bravo Station before a joint geological drilling operation at 06:00. A sample-transfer delay leads to an exceptionally authorized night drive after lighting, sensors, power and thermal margins are checked. Missing the delivery postpones the science operation. Protect the life-support reserve first.

### Original narrative parameters

- Leave at 20:40, about 12 km from Bravo. At 21:05, about 7 km and 8 h 55 min until the target time remain.
- The representative outside temperature is −72 °C. Battery A has 9.5 kWh usable. Normal stationary demand at 1.5 kW lasts 6 h 20 min. Remaining on that load to 06:00 would require about 13.4 kWh.
- A converter stage associated with battery B faults. Protection isolates B, cuts traction and keeps the essential bus on A. The isolated module cools.
- Verify isolation, electrical and thermal limits and the predesigned degraded mode before authorizing traction on A. The crew confirms the change. B stays isolated for later maintenance.

| Original energy model | Direct | Alternative |
| --- | --- | --- |
| Distance | 7.0 km | 8.1 km |
| Traction | 7.4 kWh | 4.5 kWh |
| Essential and thermal systems | 2.2 kWh | 2.2 kWh |
| Total | 9.6 kWh | 6.7 kWh |
| Arrival energy | −0.1 kWh | 2.8 kWh |
| Provisional reserve | 2.0 kWh | 2.0 kWh |
| Margin | Infeasible | 0.8 kWh |

The original alternative is longer across lower-resistance terrain. The equal essential loads are a simplifying assumption. A more detailed budget accounts for duration, temperature, heat demand and actual consumption.

### Playable sequence

The simulation begins roughly 70 m before the fault. Speed caps are 10 km/h and 8 km/h in degraded mode. The old playable treatment listed 105 m at 0.45 kWh and 132 m at 0.25 kWh, with a 9.15 kWh emergency reserve. Use the [technical documentation](DOCUMENTATION.md) and live HUD for the shipped route names and projections.

1. Switch on the headlights, follow the marked route and stop when the B converter faults.
2. Assess the remaining endurance, verify isolation and confirm the suit and rover are secure.
3. Cycle the airlock, walk to the amber marker, open the service hatch and reseat battery A's marked module. Close the panel, return, confirm cabin pressure and test the A bus.
4. Compare the route budgets, approve degraded drive and update the projected reserve as the rover moves.
5. Park, retrieve the spare module, cycle the airlock, walk to Bravo and hand over the cargo.

Use a quiet cockpit and a clear diagram showing A energized, B isolated and traction locked. Pair route geometry with projected consumption and arrival reserve. The final view shows the cargo delivered, life support stable and B awaiting inspection. Keep the night scene dark and readable with limited headlights.

## 4. SARA interaction contract

| Priority | Response |
| --- | --- |
| P0 · Immediate danger | Short call, clear alert, action and acknowledgement |
| P1 · Return, routing or conservation | Explain the reason and alternatives, then request confirmation |
| P2 · Diagnostic | State observed evidence, confidence and pending checks |
| P3 · Science | Provide detail when it does not distract from an emergency |

Shared fields include `mission_id`, `demo_time_s`, `mission_local_time`, `scene`, `jarvis_state`, `risk_level`, `sources` and `is_simulation`. ARES-01 also tracks sampling progress, dust and visibility trends, position uncertainty, rover distance, terrain risk, suit pressure and the abort flag. ARES-02 tracks A's energy, B isolation, converter and drive state, cabin pressure, thermal demand, route estimates, minimum reserve and distance to Bravo. Numeric readings need units. Sensor quality is valid, degraded or unavailable. Provenance is historical reference, simulated sensor, derived or design assumption.

For ARES-01, evaluate dust, navigation quality and return margin before selecting advisory or abort. Replan around known terrain only after verifying position. Inspect pressure after an impact and confirm pressurization at the rover. For ARES-02, protect the essential bus, compare stationary loads, verify degraded-drive limits, estimate traction and life-support energy plus uncertainty, and discard any option that spends the reserve. Continue monitoring the actual budget.

## 5. Production and acceptance

Use a deterministic, resettable scenario clock and event records with trigger, telemetry patch, visuals, line, choices and next state. Keep scenario decisions in the state machine. Use simulation labels on invented hazards, mark time cuts visibly, rehearse a missing data case and close with a debrief that identifies achieved goals and unresolved work.

| Scenario check | Expected result |
| --- | --- |
| A1 advisory at 00:20, continuation and abort at 00:40 | Advisory remains visible until the simulated threshold is crossed |
| A1 drill stopped and equipment secured | Main core remains uncollected and reconnaissance log survives |
| A1 unstable ground and poor localization | Explain measured risk, offer a surveyed route when position is reliable, otherwise hold |
| A1 suit impact | Report uncertainty until the pressure check completes |
| A1 rover and base | Distinct milestones with an explicit time transition when edited |
| A2 B fault and degraded drive | B stays isolated, A powers life support, drive follows the isolation and bus checks |
| A2 reserve decision | Show the budget deficit and select the option that preserves the reserve |
| A2 arrival | Park, deliver the module on foot and leave B isolated |

Open design questions in the original treatment included exact DEM coverage, quantitative alert thresholds, beacon and position quality, suit damage channels, A/B representation, thermal shelter loads, energy-model uncertainty, the Bravo visual and attribution. Current implementation details are documented in the [technical guide](DOCUMENTATION.md).

## 6. Scientific references

These sources support the setting and the scientific precedents used in the fictional scenarios.

- [S1 · NASA Science — Perseverance Rock Cores From 'Wildcat Ridge'](https://science.nasa.gov/resource/perseverance-rock-cores-from-wildcat-ridge/)
- [S2 · NASA Science — Dusty Differences Between Mars and Earth](https://science.nasa.gov/earth/earth-observatory/dusty-differences-between-mars-and-earth-149926/)
- [S3 · NASA — The Fact and Fiction of Martian Dust Storms](https://www.nasa.gov/solar-system/the-fact-and-fiction-of-martian-dust-storms/)
- [S4 · NASA — Spacewalk Spacesuit Basics](https://www.nasa.gov/centers-and-facilities/johnson/spacewalk-spacesuit-basics/)
- [S5 · NASA Science — Perseverance Science Highlights](https://science.nasa.gov/mission/mars-2020-perseverance/science-highlights/)
- [S6 · NASA — Perseverance Science Instruments / MEDA](https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/)
- [S7 · NASA — Human Mars Mission Surface Power Impacts on Timeline and Traverse Capabilities](https://ntrs.nasa.gov/citations/20220003043)
- [S8 · Scientific study — Dust, Sand, and Winds Within an Active Martian Storm in Jezero Crater](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/)
- [S9 · NASA Science — Grounded: First Flight Delay Due to Inclement Weather on Another World](https://science.nasa.gov/blog/grounded-first-flight-delay-due-to-inclement-weather-on-another-world/)
- [S10 · NASA PDS — MEDA calibrated data archive](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html)
- [S11 · NASA — Humans to Mars](https://www.nasa.gov/humans-in-space/humans-to-mars/)
