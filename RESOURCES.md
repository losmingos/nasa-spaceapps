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
python scripts/build_terrain.py DTEEC_002387_1985_003798_1985_A01.IMG --high
python scripts/build_ortho.py DTEEC_002387_1985_003798_1985_A01.IMG JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif --high
```

El generador reproyecta el GeoTIFF ortográfico a la proyección equirectangular del DTM, recorta la textura entre los centros de la primera y la última muestra de la malla y ajusta el contraste entre los percentiles 1 y 99. El canal alfa marca las zonas sin cobertura.

La opción `--high` genera `jezero-high.bin` (867 × 1443 muestras, a 8,08 m de separación) y `jezero-ortho-high.webp` (1,5 m por píxel). Ambas calidades comparten origen y extensión. Los materiales del visor añaden polvo, grava y microrrelieve ilustrativos a la cartografía orbital.

## Referencias para el detalle a ras de suelo

- La panorámica en color natural de Mastcam-Z sirve de referencia para la iluminación, el cielo y el horizonte. [Panorámica de Perseverance, PIA23727](https://www.jpl.nasa.gov/images/pia23727-perseverances-mastcam-z-first-high-resolution-panorama/)
- El mosaico del sol 66 sirve de referencia para recrear las formas y el color de las rocas. [Rocas fotografiadas por Mastcam-Z](https://science.nasa.gov/photojournal/perseverances-mastcam-z-images-intriguing-rocks/)

## Hora e iluminación

El reloj calcula la hora solar media local (LMST) y el número de sol de la escala Mars Sol Date ajustado a Jezero. La hora solar verdadera determina la dirección de la luz, con la estación calculada para el sol seleccionado. Los colores del cielo y la intensidad ambiental se aproximan según la altura del Sol. [Algoritmo Mars24 de NASA GISS](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)

El modo tormenta recrea la pérdida de luz directa y la caída de visibilidad observadas por Opportunity. Las ráfagas de polvo fino se generan en el visor, con las imágenes de Perseverance como referencia visual. [Cielo oscurecido de Opportunity](https://science.nasa.gov/resource/a-darkened-mars-sky/) · [Ráfaga captada por Perseverance](https://science.nasa.gov/blog/everything-is-dust-in-the-wind/)
