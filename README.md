# Explorador de Jezero

Visor 3D del delta occidental de Jezero. Ejecuta `npm ci` y `npm run dev` y abre la URL que muestra Vite. El visor requiere WebGL 2 y carga la cuadrícula incluida en el repositorio.

Arrastra para orbitar, usa la rueda para acercarte y el botón derecho o las flechas para desplazar la cámara. En una pantalla táctil, arrastra con un dedo para girar y usa dos dedos para mover la cámara o acercarte. Usa **Cenital** para mirar desde arriba. La escala vertical inicia en 4× y puede ajustarse a 1× para ver las proporciones físicas.

## Datos del terreno

[DTM HiRISE del delta de Jezero](https://www.uahirise.org/dtm/PSP_002387_1985), producto `DTEEC_002387_1985_003798_1985_A01`. Crédito NASA/JPL-Caltech/Universidad de Arizona.

La cuadrícula incluida conserva una muestra por cada 16 filas y columnas del DTM. Tiene 434 × 722 muestras, separadas por 16,15 m según la escala del PDS3. Su extensión rectangular es de aproximadamente 7 × 11,6 km. El visor omite los triángulos que contienen muestras sin datos. Las elevaciones están en metros respecto al datum Marte 2000. El color se deriva de la elevación.

Para regenerar el binario, descarga el IMG desde la ficha de HiRISE y ejecuta:

```sh
python scripts/build_terrain.py ruta/al/DTEEC_002387_1985_003798_1985_A01.IMG
```
