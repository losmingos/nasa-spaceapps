# Jezero data and asset credits

## Terrain datasets

| Product | Use and resolution | Credit |
| --- | --- | --- |
| [Jezero depositional fan DTM](https://www.uahirise.org/dtm/PSP_002387_1985), `DTEEC_002387_1985_003798_1985_A01.IMG` | Elevations from HiRISE stereo pair `PSP_002387_1985` and `PSP_003798_1985`, acquired by Mars Reconnaissance Orbiter. The source sample spacing is 1.00965 m. `static/terrain/jezero.bin` retains every sixteenth row and column for a spacing of 16.15 m. Elevations use the Mars 2000 datum. | NASA/JPL-Caltech/University of Arizona |
| [Jezero HiRISE orthomosaic](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif), `JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif` | The same monochrome GeoTIFF used by `jezero-viewer`, with 25 cm pixels at source. The visor loads `static/terrain/jezero-ortho.webp`, resampled to about 3 m per pixel and tinted by the terrain material. Areas without coverage retain the mesh's base colour. | NASA/JPL-Caltech/USGS/University of Arizona |
| [USGS geologic map SIM 3464](https://doi.org/10.3133/sim3464), unit `Aeb` | Eolian bedform polygons delimit the ochre overlay and reduce movement speed by a simulated factor of 0.62. The regional map scale is 1:75,000. | USGS Astrogeology Science Center, Sun and Stack (2020) |

## Regenerate the terrain files

Download the IMG and GeoTIFF above. Install `numpy`, `rasterio` and `Pillow` in the Python environment for the orthomosaic.

```sh
python scripts/build_terrain.py DTEEC_002387_1985_003798_1985_A01.IMG
python scripts/build_ortho.py DTEEC_002387_1985_003798_1985_A01.IMG JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif
python scripts/build_terrain.py DTEEC_002387_1985_003798_1985_A01.IMG --high
python scripts/build_ortho.py DTEEC_002387_1985_003798_1985_A01.IMG JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif --high
```

The orthomosaic script reprojects the source to the DTM's equirectangular projection, crops the texture between the first and last grid sample centres and adjusts contrast between the 1st and 99th percentiles. The alpha channel marks areas without coverage.

The `--high` option creates `jezero-high.bin` (867 × 1443 samples at 8.08 m spacing) and `jezero-ortho-high.webp` (1.5 m per pixel). Both resolutions share the same origin and extent. The visor adds illustrative dust, gravel and small-scale surface details.

## Ground-level references

- The natural-colour Mastcam-Z panorama informs the lighting, sky and horizon. [Perseverance panorama, PIA23727](https://www.jpl.nasa.gov/images/pia23727-perseverances-mastcam-z-first-high-resolution-panorama/)
- The sol 66 mosaic informs rock shapes and colours. [Rocks photographed by Mastcam-Z](https://science.nasa.gov/photojournal/perseverances-mastcam-z-images-intriguing-rocks/)

## Time and lighting

The clock computes local mean solar time (LMST) and the Mars Sol Date shifted to Jezero. The Sun's position controls light direction and the solar disc. The terrain can occlude the disc, and twilight colour and brightness are approximated visually. [NASA GISS Mars24 algorithm](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) · [Curiosity's calibrated Mars sunset sequence](https://science.nasa.gov/resource/sunset-at-mars-gale-crater-curiosity/)

Fine dust scatters blue light near the Sun at sunrise and sunset, while the rest of the sky retains red and orange tones. An extended transition approximates the persistence of twilight. [NASA's Mars sunrise and sunset reference](https://science.nasa.gov/solar-system/planets/mars/what-does-a-sunrise-sunset-look-like-on-mars/)

The visor approximates the apparent positions of Phobos and Deimos from JPL's J2000 mean orbital elements, Mars's rotation and Jezero's location. Physical radii inform apparent size and the sunlight direction determines phase. Deimos has a minimum rendered size so it remains visible. Use Horizons for precise ephemerides. [JPL mean orbital elements](https://ssd.jpl.nasa.gov/sats/elem/sep.html) · [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [NASA Mars and moon physical parameters](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html)

Storm mode recreates the reduced direct light and visibility observed by Opportunity. The visor generates dust gusts using Perseverance imagery as a visual reference. [Opportunity's darkened sky](https://science.nasa.gov/resource/a-darkened-mars-sky/) · [Perseverance dust gust](https://science.nasa.gov/blog/everything-is-dust-in-the-wind/)

## Visor layers

The **Danger** layer uses simplified USGS `GeoUnits_v1` polygons intersecting the DTM in `static/terrain/jezero-geology.json`. The soil consistency estimate uses a 70% weight for the mapped geological unit and 30% for local HiRISE orthophoto roughness, measured as the standard deviation of normalized luminance. The regional map can differ from operational cartography by 100–200 m. The layer is suitable for general orientation, and the orbital texture measures brightness rather than soil strength. [USGS SIM 3464](https://pubs.usgs.gov/publication/sim3464) · [USGS GIS feature layer](https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8)

**SWIR** simulates short-wave infrared using approximate reflectance by geological unit and the same terrain mesh. Suspended dust does not attenuate the rendered SWIR scene. The effect adds streaks for bouncing 20–100 µm grains, sensor noise and distance-dependent response. [SWIR design specification](infrarrojoSpec.md)

## Jezero dust and weather

`src/lib/data/meda-snapshot.json` summarizes observations from Perseverance sol 313 (5–6 January 2022), when a regional dust storm reached Jezero. The JSON links the original CSV products for temperature, pressure, humidity and wind. [NASA PDS MEDA archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda_11282022.html)

The snapshot uses the published sol 313 products. [ATS temperature CSV](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0300_0419/sol_0313/WE__0313___________CAL_ATS_________________P01.CSV) · [Pressure CSV](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_PS__________________P03.CSV) · [Humidity CSV](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_RHS_________________P03.CSV) · [Wind CSV](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_WS__________________P02.CSV)

`src/lib/data/meda-temperature-sol313.json` contains the hourly mean of valid 1 Hz readings from `ATS_LOCAL_TEMP1-3`, converted from kelvin to Celsius. Sample counts vary by hour. The visor instead uses `meda-curves.json` to interpolate observations by local time and season and blend toward the sol 313 curve during the storm. [Calibrated sol 313 ATS CSV](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0300_0419/sol_0313/WE__0313___________CAL_ATS_________________P01.CSV) · [MEDA processing notes](src/lib/data/README.md)

The oxygen simulation starts with 312 minutes, runs at 12× speed while the visor is active and resets when a mission starts. Running consumes oxygen at 1.6× the base rate, and the storm applies a further multiplier. These are gameplay assumptions.

Lemmon et al. describe changes in dust and winds at Jezero over sols 309–321. They report a peak visible optical depth near 2, winds reaching roughly 22 m/s and changes in wind direction around the site. The published optical-depth peak bounds the visual effect. The sol 313 snapshot has no direct opacity reading for its timestamp, so `dust_opacity` is `null`. The storm progression is animated. [Lemmon et al., Geophysical Research Letters](https://doi.org/10.1029/2022GL100126) · [Open-access article](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/) · [Preliminary Mastcam-Z opacity series](https://data.mendeley.com/datasets/gktjp9jptb/2)

## ARES-01 models

| Asset | Provenance | Adaptation |
| --- | --- | --- |
| Pressurized crew rover | [Space Exploration Vehicle](https://science.nasa.gov/3d-resources/space-exploration-vehicle/), NASA Langley Research Center / Advanced Concepts Lab | NASA's original GLB was decimated and its textures resized and converted to WebP. The bundled Meshopt GLB keeps the original scale and uses approximately 58,000 triangles and 1.89 MB on disk. This vehicle is a NASA concept for surface exploration. |
| Compact drill | [Drill 01 by Fernando Quinn, Poly Haven](https://polyhaven.com/a/drill_01), via the [Innerscene CC0 GLB](https://www.innerscene.com/tools/library/3d-parts/cordless-drill-9a900ce1) | The model keeps its original dimensions, about 18 × 19 × 5 cm. Textures were resized to 512 px and converted to WebP. The cordless drill represents the fictional portable ARES tool. |
| Survey sample tubes | [Mars 2020 sample tube](https://science.nasa.gov/3d-resources/mars-2020-sample-tube/), NASA/JPL-Caltech | The printable STL was simplified, converted to GLB and scaled to [18 cm long and 2 cm in diameter](https://science.nasa.gov/photojournal/perseverances-portrait-of-the-sample-depot/). The tray and the three sealed survey samples are part of the fictional scenario. |
| Sedimentary outcrop | [Wildcat Ridge sampling mosaic](https://science.nasa.gov/resource/sample-collection-and-rock-analysis-at-wildcat-ridge/), NASA/JPL-Caltech/ASU/MSSS | Original ARES mesh inspired by fine-grained delta bedrock. The exposed ledge is approximately 1.4 × 0.9 m and rises about 0.35 m above the ground. The 5 cm abrasion patch follows the scale in the reference mosaic. |

The rover source is also available in [NASA's 3D Resources repository](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Space%20Exploration%20Vehicle). See [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) for NASA media and identifiers.

## ARES-02 models

| Asset | Provenance | Adaptation |
| --- | --- | --- |
| Bravo station pressure modules | [Habitat Demonstration Unit, part 1](https://science.nasa.gov/3d-resources/habitat-demonstration-unit/), NASA Langley Research Center / Advanced Concepts Lab. [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) | The exterior mesh was rescaled and oriented for the Bravo approach, with new vertex colors replacing the original textures and markings. The bundled GLB has 2,264 triangles and occupies approximately 69 kB. The airlock facade, approach lights, antenna and solar arrays are original ARES geometry. |
