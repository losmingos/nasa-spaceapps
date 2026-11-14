# Especificación Técnica: Simulación de Visión Infrarroja (SWIR) en Marte VR

Documento de diseño óptico, físico y visual para la implementación de un visor infrarrojo capaz de penetrar tormentas de polvo marciano en **Meta Quest 2** (Proyecto NASA Space Apps).

---

## 1. Física del Polvo Marciano y Óptica Atmosférica

### 1.1. Tamaño y Distribución de Partículas
Para determinar qué longitud de onda logra atravesar una tormenta de polvo sin sufrir dispersión severa, se consideran dos regímenes de partículas:

* **Partículas en suspensión (Aerosoles atmosféricos):**
  * **Media (radio efectivo $r_{\text{eff}}$):** $\approx 1.5\ \mu\text{m}$ ($3\ \mu\text{m}$ de diámetro).
  * **Rango total:** Desde $0.1\ \mu\text{m}$ (polvo fino en alta atmósfera) hasta $10\ \mu\text{m}$ (partículas levantadas cerca de la superficie durante tormentas locales o *dust devils*).
  * **Granos de saltación (arrastre eólico cercano al suelo):** Entre $20\ \mu\text{m}$ y $100\ \mu\text{m}$ (caen rápidamente, no permanecen en suspensión alta).
* **Capa de polvo depositado sobre superficies/sensores:**
  * **Media habitual:** Entre $10\ \mu\text{m}$ y $100\ \mu\text{m}$ en zonas rocosas barridas por el viento (ej. cráter Jezero).
  * **Rango total:** Desde $< 2\ \mu\text{m}$ (recubrimiento electrostático fino) hasta varios metros en depósitos sedimentarios o dunas.

### 1.2. Fórmulas de Penetración y Atenuación

#### A. Parámetro de Tamaño de Mie ($x$)
Determina el régimen de dispersión en función del radio de la partícula ($r$) y la longitud de onda ($\lambda$):

$$x = \frac{2\pi r}{\lambda}$$

* **Dispersión de Mie ($x \gtrsim 1$):** La luz visible ($\lambda \approx 0.4 - 0.7\ \mu\text{m}$) choca y rebota contra las partículas de $1.5\ \mu\text{m}$, generando una neblina opaca de color naranja/ocre.
* **Condición de transparencia ($x \ll 1$, en la práctica $x \le 0.3$):** Para entrar en régimen de dispersión de Rayleigh y atravesar el aerosol:

$$\lambda \ge \frac{2\pi r}{0.3} \approx 20 \cdot r$$

* **Banda seleccionada (SWIR - Infrarrojo de Onda Corta):**
  * **Longitud de onda base ($\lambda$):** **$1.65\ \mu\text{m}$ ($1650\ \text{nm}$)** (ventana estándar para sensores *InGaAs*).
  * **Rango sintonizable opcional:** Entre **$1.0\ \mu\text{m}$ y $2.5\ \mu\text{m}$** mediante rueda de filtros o filtro acústico-óptico (AOTF).

#### B. Ley de Beer-Lambert (Atenuación de la Señal)
Controla la intensidad de luz recibida ($I$) frente a la emitida/reflejada ($I_0$) según la profundidad óptica ($\tau$):

$$I(\lambda) = I_0(\lambda) \cdot e^{-\tau(\lambda)}$$

Donde la profundidad óptica depende de la concentración de partículas ($N$), la sección eficaz de extinción ($Q_{\text{ext}}$) y la distancia al objeto ($d$):

$$\tau(\lambda) = N \cdot \pi r^2 \cdot Q_{\text{ext}}(r, \lambda) \cdot d$$

* **Conversión de opacidad en simulación:** En una tormenta activa con opacidad visible $\tau_{\text{vis}} \approx 4.20$, el cambio a SWIR ($1.65\ \mu\text{m}$) reduce la extinción en un **85%**:

$$\tau_{\text{SWIR}} \approx 0.15 \cdot \tau_{\text{vis}} \approx 0.63$$

---

## 2. Arquitectura de Sensores (Hardware Simulado)

* **Sensor Principal:** **InGaAs (Arseniuro de Galio-Indio)** sensible al espectro SWIR ($0.9 - 1.7\ \mu\text{m}$ o extendido hasta $2.5\ \mu\text{m}$).
* **Óptica:** Lentes de silicio/germanio con recubrimiento antirreflejos IR.
* **Nota de diseño multiespectral:** Un mismo sensor InGaAs puede variar su longitud de onda dentro de la banda SWIR usando filtros intercambiables. Para saltos hacia el infrarrojo térmico lejano (LWIR, $8 - 14\ \mu\text{m}$), la arquitectura real requiere un segundo sensor (microbolómetro) acoplado mediante un espejo dicroico.

---

## 3. Especificación Visual y Shaders (Modo SWIR)

### 3.1. Atmósfera y Niebla Volumétrica
* **Eliminación de niebla naranja:** Desactivar completamente el *scattering* atmosférico visible (color ocre `#C86D3B`).
* **Niebla SWIR:** Sustituir por una niebla exponencial monocromática neutra (gris medio) con densidad reducida al 15% respecto al modo visible.

### 3.2. Nitidez por Distancia (*Depth-Based Falloff*)
* **Primer plano ($0\text{ m} - 20\text{ m}$):** Nitidez máxima. Aplicar realce sutil de contraste local (*sharpening*) para definir grietas, rocas y huellas.
* **Media distancia ($20\text{ m} - 80\text{ m}$):** Pérdida progresiva de microcontraste debido a la columna acumulada de polvo fino en suspensión.
* **Lejanía ($> 80\text{ m}$):** Desenfoque gaussiano suave vinculado al *Depth Buffer* y transición hacia gris uniforme en el horizonte.

### 3.3. Sistema de Partículas y Ruido del Sensor
* **Granos de saltación cercanos (*Saltation Grains*):**
  * Partículas de gran tamaño ($20 - 100\ \mu\text{m}$) tienen $x \gg 1$ y **no son transparentes** al SWIR.
  * Emitir partículas 3D cerca de la cámara ($0.5\text{ m} - 6\text{ m}$) cruzando de lado a lado según el vector del viento con *motion blur* direccional:
    * Granos iluminados por el sol: trazos blancos/gris brillante.
    * Granos muy cercanos fuera de foco: manchas oscuras difusas.
* **Ruido de lectura (*InGaAs Readout Noise*):**
  * Grano monocromático dinámico actualizado a **72 Hz** (nativo de Quest 2 para evitar fatiga visual).
  * Mayor intensidad en sombras profundas y en el cielo oscuro (simulando ganancia automática *AGC*), mínimo en zonas bien iluminadas.
* **Post-procesado óptico (Inmersión VR):**
  * **Viñeteado (*Vignetting*):** Oscurecimiento suave en los bordes de la lente (simula absorción periférica de lentes de silicio/germanio y reduce el *motion sickness* en VR).
  * **Aberración cromática sutil:** Desfase mínimo de 1-2 píxeles en los extremos del visor para simular distorsión óptica de gran angular.

---

## 4. Reflectancia de Materiales en SWIR (Albedo Monocromático)

La cámara SWIR no captura color visible, sino **intensidad de radiación infrarroja reflejada**. Todos los materiales de la escena deben mapearse a una escala de grises de luminancia entre `0.0` (negro absoluto) y `1.0` (blanco puro):

| Material / Superficie | Albedo SWIR (`0.0 - 1.0`) | Apariencia Visual en Escena |
| :--- | :---: | :--- |
| **Polvo fino / Regolito suelto** | `0.75 – 0.90` | Gris muy claro / brillante. El suelo polvoriento y las dunas reflejan intensamente el SWIR. |
| **Roca basáltica limpia** | `0.15 – 0.25` | Gris carbón oscuro. Las paredes verticales y fracturas destacan por alto contraste. |
| **Roca con polvo acumulado** | `0.65 – 0.80` | Gris claro en caras superiores (donde reposa el polvo) frente a caras laterales oscuras, marcando el relieve 3D. |
| **Metales / Hardware (Rover, balizas)** | `0.85 – 1.00` | Blanco brillante con reflejos especulares fuertes. Destacan claramente sobre el terreno. |
| **Hielo de agua / Escarcha** | `0.05 – 0.12` | Casi negro. El agua presenta fuertes bandas de absorción en $1.5\ \mu\text{m}$ y $2.0\ \mu\text{m}$. |
| **Cielo marciano** | `0.05 – 0.15` | Negro / gris muy oscuro debido a la ausencia de dispersión de luz visible, con un leve halo en el horizonte. |

---

## 5. Diseño del HUD Telemétrico (World-Space VR)

El HUD debe situarse fijo respecto al casco (*Head-Locked World-Space UI*) a una distancia focal cómoda de **$1.8\ \text{m}$**, utilizando tipografía monoespaciada en blanco puro (`#FFFFFF` al 80% de opacidad) con contorno negro fino (`#000000` al 60%) para garantizar contraste sobre zonas brillantes.

### Distribución de Elementos en Pantalla

1. **Esquina Superior Izquierda — Parámetros del Sensor:**
   * `SENSOR: InGaAs SWIR-1`
   * `WAVELENGTH: λ = 1.65 µm (1650 nm)` *(con barra deslizante si se habilita sintonización entre $1.0\ \mu\text{m}$ y $2.5\ \mu\text{m}$)*
   * `AGC GAIN: AUTO (+12 dB)`

2. **Esquina Superior Derecha — Estado de la Tormenta y Opacidad:**
   * `STORM STATUS: ACTIVE DUST EVENT`
   * `OPTICAL DEPTH (τ): VIS 4.20 ➔ SWIR 0.63`
   * `VISIBILITY RANGE: 165 m (VIS: 4.5 m)`
   * `WIND VECTOR: 22.4 m/s [→]` *(sincronizado con el sistema de partículas cercanas)*

3. **Centro del Visor — Retícula de Telemetría Activa:**
   * Cruz minimalista con lectura dinámica mediante *Raycast*:
   * `DIST: 42.8 m` (distancia al punto mirado)
   * `SWIR ALBEDO: 0.81 [REGOLITH/DUST]` (identificación del material apuntado)
