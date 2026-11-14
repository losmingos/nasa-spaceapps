# Explorador de Jezero

Visor 3D del delta occidental de Jezero. Ejecuta `npm ci` y `npm run dev` y abre la URL que muestra Vite. El visor requiere WebGL 2 y carga la cuadrícula incluida en el repositorio.

Al cargar apareces a pie en el delta. Haz clic en la escena (o pulsa **Intro** con el visor enfocado) para girar con el ratón y usa **WASD** para caminar. Pulsa **Esc** para liberar el ratón. También puedes arrastrar sobre el visor o usar las flechas para mirar. El minimapa muestra el relieve local y tu rumbo. El oxígeno y la temperatura son valores simulados.

El casco muestra la hora solar media local de Jezero. Pulsa **H** y abre **Cambiar hora** para explorar otro sol u otra hora. **Volver a la hora actual** reanuda el reloj en directo.

## Datos del terreno

[DTM HiRISE del delta de Jezero](https://www.uahirise.org/dtm/PSP_002387_1985), producto `DTEEC_002387_1985_003798_1985_A01`. Crédito NASA/JPL-Caltech/Universidad de Arizona.

La cuadrícula incluida conserva una muestra por cada 16 filas y columnas del DTM. Tiene 434 × 722 muestras, separadas por 16,15 m según la escala del PDS3. Su extensión rectangular es de aproximadamente 7 × 11,6 km. El visor omite los triángulos que contienen muestras sin datos. Las elevaciones están en metros respecto al datum Marte 2000. El visor proyecta el ortomosaico HiRISE sobre la malla. Consulta [RESOURCES.md](RESOURCES.md) para ver los productos, créditos y pasos de preparación.

Para regenerar el binario, descarga el IMG desde la ficha de HiRISE y ejecuta:

```sh
python scripts/build_terrain.py ruta/al/DTEEC_002387_1985_003798_1985_A01.IMG
```

## ARES-01 · The Last Sample

Abre el visor y elige Iniciar demo para seguir el guion de 3:30. En el modo interactivo puedes decidir si continúas al primer aviso, asegurar el instrumental, confirmar el desvío y ensayar una pérdida de posición. La secuencia guía la cámara y marca los saltos temporales. Pausar y Reiniciar están disponibles durante la misión.

El reloj de la demo activa el aviso en 00:20 y, en la rama canónica, el aborto en 00:40. Son disparadores del guion. La intensidad visual del polvo, el terreno de riesgo y la presión del traje se simulan sobre el relieve HiRISE. Las posiciones de los hitos están en `src/lib/ares/route.ts`. El corredor original mide 350 m, el desvío 415 m y el trayecto en rover 2,4 km.

La interfaz muestra las intervenciones de JARVIS y publica cada cambio de diálogo como `ares01:dialogue` en `window`. El detalle tiene el tipo `Ares01Dialogue` de `src/lib/ares/ares01.ts`. El cliente de voz puede suscribirse y reproducir los eventos con `speaker === 'jarvis'`. Los eventos de caída e impacto usan `speaker === 'scene'`.
