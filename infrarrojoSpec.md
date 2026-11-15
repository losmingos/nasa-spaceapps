# Short-wave infrared vision for Mars VR

Optical, physical and visual design for the Meta Quest 2 visor. This specification records proposed hardware and rendering targets. See [Jezero data and asset credits](RESOURCES.md) for the behaviour of the shipped simulator.

## 1. Martian dust and atmospheric optics

### Particle size and distribution

The design considers suspended aerosols, grains bouncing close to the ground, and dust deposited on surfaces and sensors.

- **Suspended aerosol.** The representative effective radius is about 1.5 µm (3 µm in diameter). The proposed range runs from 0.1 µm for fine dust high in the atmosphere to 10 µm for particles lifted near the ground during local storms or dust devils.
- **Saltation grains.** Grains between 20 and 100 µm move close to the surface and fall quickly.
- **Deposited dust.** The design assumes a typical layer of 10–100 µm in windswept rocky areas such as Jezero. A fine electrostatic coating can be thinner than 2 µm, while sedimentary deposits and dunes can reach several metres.

### Size parameter and attenuation

The Mie size parameter relates particle radius to wavelength:

$$x = \frac{2\pi r}{\lambda}$$

At $x \gtrsim 1$, suspended dust scatters visible wavelengths of about 0.4–0.7 µm and creates the familiar ochre haze. A design threshold of $x \le 0.3$ for weak scattering implies:

$$\lambda \ge \frac{2\pi r}{0.3} \approx 20 \cdot r$$

The selected visual channel is 1.65 µm (1650 nm), within the standard InGaAs range. An optional design would tune from 1.0 to 2.5 µm using a filter wheel or an acousto-optic tunable filter. At a representative radius of 1.5 µm, the selected band gives $x \approx 5.7$. The SWIR contrast improvement below is a rendering assumption.

Beer–Lambert attenuation relates received intensity to incident or reflected intensity and optical depth:

$$I(\lambda) = I_0(\lambda) \cdot e^{-\tau(\lambda)}$$

For particle number concentration $N$, dimensionless extinction efficiency $Q_{\text{ext}}$ and distance $d$:

$$\tau(\lambda) = N \cdot \pi r^2 \cdot Q_{\text{ext}}(r, \lambda) \cdot d$$

The original rendering target applies an 85% reduction from an illustrative visible optical depth of 4.20:

$$\tau_{\text{SWIR}} \approx 0.15 \cdot \tau_{\text{vis}} \approx 0.63$$

## 2. Simulated sensor

- **Detector.** InGaAs (indium gallium arsenide) sensitive from 0.9 to 1.7 µm, or up to 2.5 µm for extended-range designs.
- **Optics.** Infrared antireflection-coated silicon/germanium lenses were proposed for the conceptual sensor.
- **Multispectral design.** Interchangeable filters select channels within the detector response. Long-wave thermal infrared (8–14 µm) would require a second detector, such as a microbolometer, coupled by a dichroic mirror.

## 3. SWIR rendering targets

### Atmosphere and distance

Remove the visible ochre scattering (`#C86D3B`). The original shader target replaces it with neutral exponential grey fog at 15% of the visible-mode density.

| Distance | Design target |
| --- | --- |
| 0–20 m | Maximum sharpness and subtle local contrast to reveal fissures, rocks and tracks |
| 20–80 m | Gradual loss of fine contrast as the path through airborne dust grows |
| Over 80 m | Mild depth-dependent Gaussian blur and a transition to uniform grey at the horizon |

### Particles and sensor noise

The 20–100 µm saltation grains have $x \gg 1$. Emit grains 0.5–6 m from the camera with motion streaks along the wind vector. Sunlit grains appear as light grey or white streaks. Nearby out-of-focus grains appear as diffuse dark spots.

The original readout-noise target updates monochrome grain at 72 Hz. Noise increases in deep shadows and dark sky to simulate automatic gain control and decreases in well-lit areas.

The optical effects call for subtle darkening around the lens edge and 1–2 pixels of displacement at the outer edges to suggest a wide-angle lens.

## 4. Monochrome reflectance targets

The SWIR view maps reflected infrared intensity to greyscale from 0.0 (black) to 1.0 (white).

| Surface | Target albedo | Appearance |
| --- | --- | --- |
| Fine dust and loose regolith | 0.75–0.90 | Bright, light grey soil and dunes |
| Clean basalt | 0.15–0.25 | Dark charcoal with high contrast around faces and cracks |
| Dust-covered rock | 0.65–0.80 | Light upper faces and dark sides that define the relief |
| Metal and hardware | 0.85–1.00 | Bright highlights and strong specular reflections |
| Water ice and frost | 0.05–0.12 | Almost black, with strong absorption bands near 1.5 and 2.0 µm |
| Martian sky | 0.05–0.15 | Dark grey to black with a faint horizon halo |

## 5. World-space telemetry HUD

The design places a head-locked HUD 1.8 m from the eye. It uses monospaced white text (`#FFFFFF`, 80% opacity) and a thin black outline (`#000000`, 60% opacity) for contrast.

1. **Upper left · sensor settings**
   - `SENSOR: InGaAs SWIR-1`
   - `WAVELENGTH: λ = 1.65 µm (1650 nm)`, with a slider if 1.0–2.5 µm tuning is available
   - `AGC GAIN: AUTO (+12 dB)`
2. **Upper right · storm and opacity**
   - `STORM STATUS: ACTIVE DUST EVENT`
   - `OPTICAL DEPTH (τ): VIS 4.20 ➔ SWIR 0.63`
   - `VISIBILITY RANGE: 165 m (VIS: 4.5 m)`
   - `WIND VECTOR: 22.4 m/s [→]`, driven by the same vector as the nearby particles
3. **Centre · reticle**
   - Minimal crosshair with a raycast readout for the point and material under the reticle
   - `DIST: 42.8 m`
   - `SWIR ALBEDO: 0.81 [REGOLITH/DUST]`
