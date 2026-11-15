# Datos de Jezero

## Datos que carga el visor

| Producto | Uso y resolución | Créditos |
| --- | --- | --- |
| [DTM del abanico deposicional de Jezero](https://www.uahirise.org/dtm/PSP_002387_1985), `DTEEC_002387_1985_003798_1985_A01.IMG` | Elevaciones del par estéreo HiRISE `PSP_002387_1985` y `PSP_003798_1985`, captado por Mars Reconnaissance Orbiter. El original tiene 1,00965 m por muestra. `static/terrain/jezero.bin` conserva una muestra de cada 16 filas y columnas, con una separación de 16,15 m. Las elevaciones se refieren al datum Mars 2000. | NASA/JPL-Caltech/Universidad de Arizona |
| [Ortomosaico HiRISE de Jezero](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif), `JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif` | El mismo GeoTIFF monocromo de 25 cm por píxel que usa `jezero-viewer`. El visor carga `static/terrain/jezero-ortho.webp`, remuestreado a unos 3 m por píxel y teñido en el material. Las zonas sin datos conservan el color base de la malla. | NASA/JPL-Caltech/USGS/Universidad de Arizona |
| [Mapa geológico USGS SIM 3464](https://doi.org/10.3133/sim3464), unidad `Aeb` | Sus polígonos de `Eolian bedform unit` delimitan zonas eólicas superpuestas en color ocre y usadas para reducir la velocidad de movimiento. La penalización `0,62×` es una regla de simulación, no una medición física. El mapa es regional (1:75 000), por lo que las zonas no describen cada parche de arena a escala de botas. | USGS Astrogeology Science Center; Sun y Stack (2020) |

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

El reloj calcula la hora solar media local (LMST) y el número de sol de la escala Mars Sol Date ajustado a Jezero. La posición solar determina la dirección de la luz y el disco del Sol; la luz y el color del crepúsculo siguen siendo una aproximación visual. El horizonte del DTM puede ocultar el disco cuando el rayo atraviesa el terreno. [Algoritmo Mars24 de NASA GISS](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) · [Secuencia calibrada del ocaso marciano de Curiosity](https://science.nasa.gov/resource/sunset-at-mars-gale-crater-curiosity/)

Los colores del cielo cerca del Sol toman como referencia las observaciones de NASA: el polvo fino dispersa luz azul hacia la zona del Sol durante el amanecer y el ocaso, mientras que el resto del cielo conserva tonos rojizos y anaranjados. La persistencia del crepúsculo se aproxima con una transición prolongada; no es un cálculo radiativo de la cantidad de polvo a cada altura. [NASA: colores del amanecer y atardecer en Marte](https://science.nasa.gov/solar-system/planets/mars/what-does-a-sunrise-sunset-look-like-on-mars/)

### Fobos y Deimos

El visor calcula posiciones topocéntricas aproximadas a partir de los elementos orbitales medios de JPL SSD, referidos a la época J2000, y de la rotación y ubicación de Jezero. Se usan sus radios para aproximar el tamaño angular y la dirección solar para sombrear la fase. Deimos tiene un tamaño mínimo de representación para que no desaparezca al ocupar menos de un píxel. **No son efemérides de precisión:** JPL advierte que los elementos medios sirven para describir la forma y orientación general de las órbitas, y recomienda Horizons para posiciones precisas. [Elementos orbitales medios de JPL SSD](https://ssd.jpl.nasa.gov/sats/elem/sep.html) · [API de efemérides JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [Parámetros físicos de Marte y sus satélites (NASA/NSSDC)](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html)

El modo tormenta recrea la pérdida de luz directa y la caída de visibilidad observadas por Opportunity. Las ráfagas de polvo fino se generan en el visor, con las imágenes de Perseverance como referencia visual. [Cielo oscurecido de Opportunity](https://science.nasa.gov/resource/a-darkened-mars-sky/) · [Ráfaga captada por Perseverance](https://science.nasa.gov/blog/everything-is-dust-in-the-wind/)

## Capas de inspección del MVP

La capa `Danger` usa `GeoUnits_v1` del [mapa geológico SIM 3464](https://pubs.usgs.gov/publication/sim3464), publicado por Sun y Stack (2020), en `static/terrain/jezero-geology.json`, como prior de consistencia del suelo. El archivo contiene las unidades que intersectan el área del DTM, consultadas del [servicio GIS público de USGS](https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8) y simplificadas para su vista previa. El 70 % del riesgo de consistencia procede de ese prior por unidad geológica y el 30 % restante de la rugosidad local de la ortofoto HiRISE (desviación típica de luminancia normalizada). La capa es regional (~1:75 000); el mapa base semi-controlado puede diferir 100–200 m de la cartografía de operaciones y la textura orbital es una medida fotométrica, no geotécnica. Úsala como orientación, no como dato de precisión para pisadas.

Las capas del visor se derivan de `static/terrain/jezero.bin` y de la malla de 16,15 m: relieve, cálculo de peligro e infrarrojo simulado. `SWIR` es una simulación basada en `infrarrojoSpec.md`, no una imagen espectral medida; su albedo por unidad geológica es una aproximación visual. En la simulación infrarroja el polvo suspendido no atenúa la escena, porque el sensor SWIR lo atraviesa; solo se dibujan granos saltantes de 20–100 µm como trazas blancas, junto con ruido de sensor y respuesta por distancia.
## Polvo y meteorología de Jezero

La instantánea `src/lib/data/meda-snapshot.json` resume observaciones del sol 313 de Perseverance (5–6 de enero de 2022), cuando una tormenta regional llegó a Jezero. Se pueden consultar las series originales en el [archivo MEDA del nodo de Atmósferas de NASA PDS](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda_11282022.html). La instantánea enlaza los productos CSV usados para temperatura, presión, humedad y viento.

El perfil horario `src/lib/data/meda-temperature-sol313.json` se deriva de `ATS_LOCAL_TEMP1-3` del [CSV calibrado de MEDA del sol 313](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0300_0419/sol_0313/WE__0313___________CAL_ATS_________________P01.CSV). Cada hora LMST promedia las lecturas válidas de los tres sensores a 1 Hz, convertidas de kelvin a °C; algunas horas tienen menos muestras. El visor usa las curvas de `src/lib/data/meda-curves.json`, que interpolan observaciones MEDA de distintas horas y estaciones y mezclan la curva de la tormenta del sol 313 cuando corresponde. El perfil horario queda como referencia reproducible de ese sol, no como predicción meteorológica.

El oxígeno restante es una simulación de autonomía: parte de 312 minutos, disminuye mientras el visor está activo usando un reloj acelerado 12× para que el cambio se aprecie en una demostración y se reinicia al iniciar la misión. Mientras se corre, consume a 1,6 veces la tasa base; durante la tormenta se aplica además el multiplicador existente. Estos factores son supuestos de juego, no mediciones fisiológicas de MEDA.

Para calibrar el aspecto de la tormenta, el artículo de Lemmon et al. analiza la evolución del polvo y del viento en Jezero durante los soles 309–321. Informa de una profundidad óptica visible máxima cercana a 2 y de un pico de viento de unos 22 m/s; las observaciones también muestran que el viento cambió de dirección alrededor del sitio. [Artículo en *Geophysical Research Letters*](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2022GL100126) · [copia de acceso abierto en PubMed Central](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/).

**Límite de los datos:** la opacidad máxima (~2) es un valor publicado para el episodio de varios soles, no una lectura MEDA simultánea con la instantánea del sol 313. Ese día, `dust_opacity` queda en `null` porque no hay una lectura directa de opacidad para esa hora; los valores Mastcam-Z disponibles antes y después del episodio están documentados en el JSON. El modo tormenta puede usar el máximo publicado como techo visual y las mediciones MEDA disponibles como referencia de viento y ambiente, pero la progresión entre ambos sigue siendo una animación, no una reproducción temporal exacta. No se debe presentar una dirección fija de viento como observación representativa de toda la tormenta.

Los CSV directos que alimentan la instantánea del sol 313 son: [temperatura ATS](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0300_0419/sol_0313/WE__0313___________CAL_ATS_________________P01.CSV), [presión](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_PS__________________P03.CSV), [humedad](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_RHS_________________P03.CSV) y [viento](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_WS__________________P02.CSV). La serie Mastcam-Z de opacidad usada como contexto está en [Mendeley Data](https://data.mendeley.com/datasets/gktjp9jptb/2) y está marcada como preliminar por su autor.

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
