# Datos de Jezero

## Datos que carga el visor

| Producto | Uso y resolución | Créditos |
| --- | --- | --- |
| [DTM del abanico deposicional de Jezero](https://www.uahirise.org/dtm/PSP_002387_1985), `DTEEC_002387_1985_003798_1985_A01.IMG` | Elevaciones del par estéreo HiRISE `PSP_002387_1985` y `PSP_003798_1985`, captado por Mars Reconnaissance Orbiter. El original tiene 1,00965 m por muestra. `static/terrain/jezero.bin` conserva una muestra de cada 16 filas y columnas, con una separación de 16,15 m. Las elevaciones se refieren al datum Mars 2000. | NASA/JPL-Caltech/Universidad de Arizona |
| [Ortomosaico HiRISE de Jezero](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif), `JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif` | El mismo GeoTIFF monocromo de 25 cm por píxel que usa `jezero-viewer`. El visor carga `static/terrain/jezero-ortho.webp`, remuestreado a unos 3 m por píxel y teñido en el material. Las zonas sin datos conservan el color base de la malla. | NASA/JPL-Caltech/USGS/Universidad de Arizona |

## Regenerar los archivos

Descarga el IMG y el GeoTIFF de la tabla. Para la ortoimagen instala `numpy`, `rasterio` y `Pillow` en tu entorno Python.

```sh
python scripts/build_terrain.py DTEEC_002387_1985_003798_1985_A01.IMG
python scripts/build_ortho.py DTEEC_002387_1985_003798_1985_A01.IMG JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif
```

El generador reproyecta el GeoTIFF ortográfico a la proyección equirectangular del DTM, recorta la textura entre los centros de la primera y la última muestra de la malla y ajusta el contraste entre los percentiles 1 y 99. El canal alfa marca las zonas sin cobertura.

## Referencias para el detalle a ras de suelo

- La panorámica en color natural de Mastcam-Z sirve de referencia para la iluminación, el cielo y el horizonte. [Panorámica de Perseverance, PIA23727](https://www.jpl.nasa.gov/images/pia23727-perseverances-mastcam-z-first-high-resolution-panorama/)
- El mosaico del sol 66 sirve de referencia para recrear las formas y el color de las rocas. [Rocas fotografiadas por Mastcam-Z](https://science.nasa.gov/photojournal/perseverances-mastcam-z-images-intriguing-rocks/)

## Hora e iluminación

El reloj calcula la hora solar media local (LMST) y el número de sol de la escala Mars Sol Date ajustado a Jezero. La hora solar verdadera determina la dirección de la luz, con la estación calculada para el sol seleccionado. Los colores del cielo y la intensidad ambiental se aproximan según la altura del Sol. [Algoritmo Mars24 de NASA GISS](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)

El modo tormenta recrea la pérdida de luz directa y la caída de visibilidad observadas por Opportunity. Las ráfagas de polvo fino se generan en el visor, con las imágenes de Perseverance como referencia visual. [Cielo oscurecido de Opportunity](https://science.nasa.gov/resource/a-darkened-mars-sky/) · [Ráfaga captada por Perseverance](https://science.nasa.gov/blog/everything-is-dust-in-the-wind/)

## ARES-01 models

| Asset | Provenance | Adaptation |
| --- | --- | --- |
| Pressurized crew rover | [Space Exploration Vehicle](https://science.nasa.gov/3d-resources/space-exploration-vehicle/), NASA Langley Research Center / Advanced Concepts Lab | NASA's original GLB was decimated and its textures resized and converted to WebP. The bundled Meshopt GLB keeps the original scale and uses approximately 58,000 triangles and 1.89 MB on disk. This vehicle is a NASA concept for surface exploration. |
| Rotary-percussive drill | [Perseverance rover components](https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/) and [NASA/JPL coring close-up](https://www.jpl.nasa.gov/news/nasas-perseverance-rover-successfully-cores-its-first-rock/) | Original low-poly ARES geometry. The stand, controls and housing are fictional. Perseverance's hollow coring bit is the functional reference. |
| Sample tubes and carrier | [NASA/JPL sample tube and caching system](https://www.jpl.nasa.gov/news/nasa-perseverance-mars-rover-to-acquire-first-sample/) and [NASA Science core retention](https://science.nasa.gov/blog/how-to-retain-a-core/) | Original low-poly ARES geometry with empty titanium-colored tubes and a fictional carrier. No core appears after the mission aborts. |

The rover source is also available in [NASA's 3D Resources repository](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Space%20Exploration%20Vehicle). See [NASA media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) for NASA media and identifiers.
