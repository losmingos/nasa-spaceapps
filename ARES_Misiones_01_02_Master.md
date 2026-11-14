---
title: "ARES | Dossier maestro de misiones y asistente SARA"
subtitle: "NASA Space Apps Challenge 2026 — Jezero Crater, Marte"
version: "1.0 — consolidación del guion"
date: "2026-11-14"
language: "es"
status: "Diseño narrativo y técnico para demostración; no procedimiento operativo certificado"
---

# ARES — Dossier maestro de escenarios

**Misiones ARES-01 «The Last Sample» y ARES-02 «Nightfall Protocol»**  
**Uso previsto:** documentación única de referencia para el equipo del hackatón, guionistas, desarrolladores, diseñadores 3D, responsables de datos, agentes de IA y presentadores.

> **Nota de rigor:** las dos misiones son **ficticias** y transcurren en un Marte humano futuro. Se apoyan en ciencia y precedentes reales de NASA, pero las posiciones de los vehículos, los astronautas, el instrumental, los modos eléctricos del rover, los umbrales y las telemetrías son **hipótesis de la demo**. No se deben anunciar como mediciones actuales ni protocolos de NASA.

## 0. Resumen ejecutivo

ARES es una interfaz de asistencia para exploración humana en Marte que integra **cartografía, topografía, meteorología, navegación, telemetría del traje y del rover y evaluación de riesgo**. Su asistente —SARA, nombre de trabajo— interpreta los datos, explica incertidumbres y recomienda actuaciones. El astronauta confirma las acciones sensibles; ante límites operacionales críticos el asistente **ordena detener una tarea en el marco del protocolo simulado**, sin sugerir que puede anular la autoridad humana o reparar hardware imposible.

**ARES-01: «The Last Sample».** Un astronauta estudia una roca sedimentaria de grano fino en una terraza del delta occidental de Jezero, inaccesible al rover. Cuando faltan diez minutos para terminar la extracción de un testigo, la atmósfera empeora. SARA recomienda volver; el astronauta decide continuar. Veinte segundos después, los datos fuerzan la **interrupción del muestreo**. En el regreso a pie, el sistema detecta una ladera de regolito poco consolidado, recalcula la ruta y posteriormente ayuda a evaluar un golpe del traje contra una roca. El astronauta vuelve al rover presurizado y después conduce 2,4 km hasta la base. **Objetivo científico parcial; seguridad conseguida.**

**ARES-02: «Nightfall Protocol».** Un astronauta debe llevar un módulo eléctrico de reserva a un compañero en la estación avanzada Bravo antes de una operación científica a las 06:00. Una incidencia técnica previa retrasa la salida y obliga a una conducción nocturna previamente autorizada. Ya en ruta, un convertidor de potencia asociado a la batería B falla y el sistema de seguridad la aísla. El rover queda inmóvil y el presupuesto energético resulta insuficiente para mantener el régimen actual de consumo hasta la mañana. SARA diagnostica el sistema, comprueba un modo de movilidad degradada alimentado por la batería A y traza un itinerario **más largo pero de menor consumo**. Se llega al destino si las comprobaciones y el margen energético siguen siendo favorables. **Objetivo logístico y seguridad conseguidos en la rama principal de la demo.**

### 0.1. Diferencia entre las dos demostraciones

| Aspecto | ARES-01 | ARES-02 |
|---|---|---|
| Espacio de la emergencia | EVA a pie, exterior polvoriento | Interior de rover presurizado, noche |
| Objetivo previo | Extraer muestra sedimentaria | Entregar material a compañero para perforación |
| Peligro primario | Deterioro de visibilidad y capacidad de navegación | Pérdida parcial de energía y tracción; riesgo térmico |
| Giro secundario | Pendiente con regolito; caída y daño superficial del traje | Dilema entre esperar/refugiarse y recuperar movilidad |
| Qué aporta SARA | Evaluación meteorológica, rutas EVA, diagnóstico del traje | Diagnóstico eléctrico, gestión térmica y optimización energética |
| Resultado | Muestreo abortado; datos geológicos preservados; regreso a base | Modo degradado, ruta de menor coste, entrega a Bravo si es seguro |

### 0.2. Recursos visibles de la demo

**Disponibles:** astronauta, rover humano conceptual de NASA, terreno 3D / mapa marciano e interfaz SARA. **Recomendados sin modelos 3D adicionales:** paneles de HUD, indicadores del traje y rover, puntos de interés, texturas de polvo, iluminaciones, alertas, rutas y pantallas interiores. **Opcionales:** contenedor/taladro de muestra como objeto mínimo; estación Bravo como marcador o silueta simple en el cierre. No obligar a modelar una ciudad marciana o un laboratorio.

---

# 1. Principios de diseño y realismo compartidos

1. **Seguridad por encima de la misión.** El sistema nunca recomienda poner el soporte vital por debajo de sus márgenes para conservar una muestra o entregar un equipo.
2. **Factual frente a sintético.** Cada dato muestra procedencia, instante de referencia, unidad, calidad y etiqueta `OBSERVADO`, `DERIVADO`, `SIMULADO` o `SUPUESTO_DE_DISEÑO`.
3. **Sin predicciones mágicas.** Un pronóstico puede tener incertidumbre. La degradación de sensores debe reflejarse en el HUD.
4. **Sin GPS terrestre en Marte.** La localización futura es una solución hipotética de navegación inercial + referencia al mapa + sensores del rover/balizas; el asistente reconoce errores de posición y puede pedir detenerse.
5. **Sin viento cinematográfico.** Los vientos marcianos pueden desplazar polvo y arena, pero su atmósfera poco densa no hace plausible que piedras grandes salgan disparadas y atraviesen el traje. La amenaza es de visibilidad, instrumentación, contaminación y movilidad. [S2, S3]
6. **El traje tiene varias capas.** Un golpe contra roca puede dañar la cubierta exterior sin perforar la capa presurizada. SARA debe comprobar la tendencia de presión; presión estable no equivale a «ausencia absoluta de todo daño». [S4]
7. **No usar el frío como sentencia inmediata.** El habitáculo del rover dispone hipotéticamente de aislamiento y reservas; la situación crítica depende de una energía calculada, no de una muerte instantánea al detenerse. [S7]
8. **El rover es conceptual.** Sus baterías A/B, modos de potencia, sistema de entrada, sensores y límites son características **inventadas de ARES**, inspiradas en conceptos de misión humana, no especificaciones verificadas de un vehículo de NASA.
9. **Diferenciar tiempo de pantalla y tiempo de misión.** Las demos incluyen saltos temporales etiquetados; 350 m a pie y 7–8 km en rover no se recorren físicamente en unos segundos.
10. **Escenario de una persona por simplificación.** Las EVA reales y expediciones a distancia requerirían un análisis cuidadoso de redundancias, equipo de apoyo y rescate. El personaje único es una decisión visual del prototipo, no una regla recomendada de operaciones reales.

## 1.1. Capas de datos propuestas

| Capa | Utilidad en ARES | Fuente científica / condición |
|---|---|---|
| Imágenes ópticas | Reconocer roca, paisaje y obstáculos | Imágenes de misiones NASA / productos orbitales; cobertura real variable |
| Topografía / pendientes | Marcar zonas peligrosas y estimar trazados | Modelo de elevación; resolución y límites explícitos |
| Geología | Seleccionar objetivos científicos | Publicaciones y cartografía geológica de Jezero [S1, S5] |
| Atmósfera | Viento, temperatura, presión, polvo, radiación solar | MEDA de Perseverance como referencia histórica [S6] |
| Traje / salud del equipo | Presión, energía, posición, integridad | Telemetría **sintética** del traje conceptual |
| Rover / energía | Estado de baterías, buses, calefacción, propulsión | Telemetría **sintética** + modelo de consumo de la demo |
| Navegación | Corredores verificados, desvíos, incertidumbre | Datos cartográficos y algoritmo de rutas propuesto |

**Diferencia importante:** el sensor de «radiación» de MEDA se refiere a la radiación solar/ambiental empleada en su sistema meteorológico, no equivale a la dosis de radiación ionizante absorbida por un astronauta. Tampoco debe confundirse la **profundidad óptica del polvo** con una distancia directa de visibilidad en metros.

---

# 2. ARES-01 — «The Last Sample»

## 2.1. Logline y objetivo

**Logline:** un astronauta debe abandonar una perforación geológica casi terminada cuando el polvo reduce la seguridad del regreso; SARA le guía por terreno difícil, comprueba un daño del traje y le ayuda a llegar al rover y a la base.

**Objetivo científico:** obtener un **testigo cilíndrico de lutita sedimentaria de grano fino** que preserve información del ambiente lacustre antiguo de Jezero: capas de deposición, mineralogía, composición química y posibles compuestos orgánicos que se analizarían después. **No es una misión para afirmar que se ha descubierto vida.**

**Contexto real:** Jezero albergó hace miles de millones de años un lago alimentado por un río; el delta conserva sedimentos de interés. En el afloramiento real Wildcat Ridge, Perseverance obtuvo testigos de unos 13 mm de diámetro por 60 mm de largo; se han descrito materiales sedimentarios finos que documentan antiguos ambientes potencialmente habitables. [S1, S5]

**Zona de la demo:** terraza rocosa ficticia del delta occidental, inspirada en Wildcat Ridge, **no la posición exacta del afloramiento real**. El rover se queda en un emplazamiento seguro, porque la terraza está separada por un paso estrecho con bloques, pendientes y suelo irregular: un vehículo presurizado podría atascarse o perder estabilidad; el astronauta sí accede a pie con precaución.

## 2.2. Parámetros acordados

| Parámetro | Valor canónico | Estado |
|---|---:|---|
| Distancia rover → afloramiento | 350 m a pie | Simulado |
| Distancia rover estacionado → base | 2,4 km | Simulado |
| Objetivo de muestreo | 1 testigo de lutita de grano fino | Hipótesis apoyada en geología real |
| Diámetro y largo del testigo | ≈13 mm × ≈60 mm | Tamaño inspirado en Perseverance [S1] |
| Trabajo pendiente al iniciar la demo | 10 minutos estimados | Simulado |
| Duración de la demo | ≈3 min 30 s | Guion audiovisual |
| Segundo desvío | +65 m respecto a corredor inicial | Simulado |
| Distancia al rover tras salto temporal | ≈90 m | Simulado |
| Tripulación mostrada | 1 astronauta | Simplificación de producción |

**Telemetría atmosférica opcional del boceto inicial** — no mezclar con observaciones ni deducir la visibilidad del polvo de modo automático: temperatura del aire −25 °C, presión 720 Pa, viento 7 m/s, visibilidad de referencia 2.500 m, batería del traje 76 %, oxígeno restante estimado 3 h 10 min. **Son valores de prueba, no obligatorios ni medidos.** El escenario definitivo se controla por una **tendencia** de polvo/visibilidad y la confianza de la navegación, no por un umbral oficial inventado.

## 2.3. Qué significa exactamente «muestrear»

Cuando empieza la demo, el astronauta **ya ha completado** el reconocimiento del afloramiento, las fotografías de sus capas y la selección del punto. El flujo restante previsto es:

1. Preparación/abrasión controlada de la superficie alterada para estudiar material representativo del interior (instrumento conceptual).
2. Perforación con herramienta de corona para extraer un pequeño cilindro, conservando el contexto estratigráfico; registrar orientación y localización.
3. Extracción del testigo, introducción en un contenedor limpio, sellado, identificación y almacenamiento para análisis posterior.

**Estado al abortar:** se detiene la perforación; **no se obtiene ni sella el testigo principal**. El astronauta asegura el instrumental conforme al procedimiento ficticio seguro, registra posición, fotografías y avance logrado; el objetivo científico principal queda pendiente. No hacer que la muestra aparezca en inventario después de haberla abortado.

## 2.4. Causante del incidente meteorológico

Se simula un episodio de polvo que ya estaba siendo observado a escala regional y cuya **intensificación local resulta más rápida de lo esperado**. Esto evita la imagen irreal de una tormenta gigantesca naciendo en 20 segundos. Los datos de la tormenta real de Jezero del **5 al 11 de enero de 2022** y los registros de MEDA sirven como **referencia histórica**, no como reproducción exacta del día y lugar de la EVA ficticia. Se documentaron aumentos de opacidad, reducción temporal de visibilidad y vientos de hasta unos 20 m/s. [S8, S9]

**Señales observables del rover simulado:** cambios de radiación solar incidente, opacidad inferida, cámara exterior con menor contraste y descenso de la fiabilidad de identificación visual. Las escalas visuales se ajustan artísticamente; ninguna lectura debe etiquetarse «tiempo real de Marte».

## 2.5. Guion narrativo de referencia — 3:30

| Tiempo de pantalla | Acción / imagen | Voz y decisión principal | Estado |
|---|---|---|---|
| **00:00** | Astronauta frente al afloramiento, equipo de muestreo; HUD señala «10 MIN REMAINING». | SARA: «Objetivo ARES-01 localizado. Depósito sedimentario compatible con antiguos ambientes lacustres. Continúa la extracción de la muestra». | `SAMPLING` |
| **00:20** | Aumenta ligeramente el polvo, menor contraste del horizonte; se abre gráfica atmosférica. | SARA: «Atención. Deterioro atmosférico detectado. Las condiciones podrían comprometer el regreso. Recomiendo abortar el muestreo y volver al rover. ¿Deseas continuar?» | `WEATHER_ADVISORY` |
| **00:25–00:35** | El astronauta continúa tras una decisión explícita. | Astronauta: «Negativo. Quedan diez minutos de trabajo. Continuamos». SARA: «Entendido. Mantendré la monitorización. El margen de seguridad está disminuyendo». | `CONTINUE_WITH_WARNING` |
| **00:40** | Exactamente **20 s después del aviso**, indicadores rojos; pérdida más rápida de visibilidad/fiabilidad de navegación. | SARA: «Alerta crítica. El deterioro de visibilidad está superando los límites de seguridad de la misión. Aborta la operación inmediatamente. Regresa al rover». | `EVA_ABORT` |
| **00:44–01:00** | El astronauta comprueba si puede completar la muestra, detiene el taladro y asegura los medios. | Astronauta: «¿Tiempo suficiente para terminar la muestra?». SARA: «Negativo. La extracción requiere aproximadamente diez minutos. No puedo garantizar un margen seguro de retorno si continúas. Abandona el muestreo». Astronauta: «Entendido. Abortando». | `RETURN_PREP` |
| **01:05** | Empieza a bajar por el corredor; flecha y mapa al rover. | SARA: «Regreso iniciado. Rover a 350 metros. Sigue el corredor marcado. Prioridad: retorno seguro». | `RETURN_EVA` |
| **01:30** | Terreno con pendiente lateral y regolito suelto; alerta de zona inestable. | SARA: «Advertencia. El corredor previsto atraviesa una zona de baja estabilidad superficial. Riesgo de pérdida de equilibrio elevado por pendiente y material no consolidado». | `HAZARD_DETECTED` |
| **01:33–01:40** | Astronauta no reconoce límite de la zona; aparece alternativa verde. | Astronauta: «No puedo identificar el límite de la zona». SARA: «Detente. Analizando la cartografía topográfica. He identificado una ruta alternativa por terreno previamente reconocido, 65 metros más larga. Recomiendo desviarte hacia el siguiente punto de paso». Astronauta: «Aceptado. Actualiza la ruta». | `REROUTE` |
| **01:40–02:02** | **Subescena de caída** en un punto aislado de roca suelta mientras toma el desvío. Se golpea con una arista; se inspecciona el traje. | Ver el microguion de la sección 2.6; SARA distingue daño exterior de posible pérdida de presión. | `SUIT_DIAGNOSTIC` |
| **02:05** | Transición explícita: «+ varios minutos de marcha». Astronauta a ≈90 m del rover, casi invisible por polvo. | Astronauta: «SARA, confirma mi posición». SARA: «Verificando posición mediante navegación inercial y referencias del rover. Localización confirmada dentro del margen permitido. Continúa hacia el punto de encuentro». | `LOCALIZATION_CHECK` |
| **02:35** | Silueta del rover aparece; entrada segura por sistema conceptual, presurización. | SARA: «Rover alcanzado. Iniciando procedimiento de entrada. Presurización confirmada. EVA finalizada». | `ROVER_SHELTER` |
| **03:00** | Vista interior; mapa al hábitat a 2,4 km, condiciones desfavorables. | Astronauta: «SARA, planifica el regreso a la base». SARA: «Ruta de retorno cargada. Condiciones atmosféricas desfavorables. Recomiendo velocidad reducida y navegación sobre el itinerario previamente reconocido». | `BASE_RETURN` |
| **03:30** | Salto temporal a base; informe final. | SARA: «Base alcanzada. Tripulación a salvo. Misión científica interrumpida por deterioro meteorológico. Datos de reconocimiento conservados para una futura operación». | `MISSION_CLOSED` |

### 2.6. Microguion aprobado: caída y diagnóstico del traje

La caída **no la provoca una piedra lanzada por el viento**. La causa es una **pequeña roca suelta** que el astronauta pisa mientras rodea un afloramiento, con visibilidad deteriorada. La desviación de ruta reduce peligros cartografiados, pero no elimina todos los obstáculos pequeños.

| Tiempo relativo al incidente | Tiempo global sugerido | Acontecimiento |
|---|---|---|
| 00:00 | 01:40 | Regreso; SARA guía en baja visibilidad. |
| 00:08 | 01:48 | Pie sobre roca suelta; pérdida de equilibrio. |
| 00:11 | 01:51 | Contacto contra superficie rocosa; arista daña la **capa exterior** del traje. |
| 00:13 | 01:53 | Telemetría de integridad anómala; SARA inicia verificación de presión. |
| 00:17 | 01:57 | SARA: «Advertencia. Posible daño en la capa exterior del traje. Comprobando integridad presurizada». |
| 00:22 | 02:02 | SARA: «Presión interna estable. No se detectan pérdidas. Posible daño superficial. Recomiendo minimizar el movimiento de la zona afectada y continuar el retorno con precaución». |

**Regla crítica:** no declarar perforación ni pérdida de oxígeno si el único dato es un impacto. El tono inicial expresa incertidumbre; la conclusión «presión estable» solo se pronuncia tras consultar una ventana temporal suficiente de sensores sintéticos. Una fuga real sería otra rama de mayor gravedad, **no el desenlace canónico**.

## 2.7. Lógica del asistente ARES-01

**Estados:** `SAMPLING → WEATHER_ADVISORY → CONTINUE_WITH_WARNING → EVA_ABORT → RETURN_EVA → HAZARD_DETECTED → REROUTE → SUIT_DIAGNOSTIC → LOCALIZATION_CHECK → ROVER_SHELTER → BASE_RETURN → MISSION_CLOSED`.

**Decisiones**:

- **Aviso (00:20):** el deterioro previsto hace aconsejable regresar, pero no ha cruzado la condición de aborto. SARA **pregunta**; la persona elige continuar y el HUD mantiene riesgo ámbar.
- **Abortar (00:40):** una segunda lectura y la pérdida de confianza en el retorno exceden los límites **simulados**. SARA comunica una instrucción operacional de aborto; el astronauta la ejecuta y la muestra queda pendiente.
- **Terreno peligroso (01:30):** con mapa de pendiente/obstáculos y posición suficientemente confiable, proponer una ruta +65 m por terreno previamente reconocido; si la posición no es fiable, ordenar detenerse, **no inventar el desvío**.
- **Impacto en traje (01:53):** examinar integridad por presión y sensores de daño hipotéticos; distinguir `POSSIBLE_OUTER_DAMAGE` de `PRESSURE_LEAK_CONFIRMED`. Prioridad de retorno; si se confirmara fuga, activar otro procedimiento de emergencia no simulado en la rama principal.
- **Tramo final (02:05):** mostrar incertidumbre de localización. Con error excesivo se detiene la marcha y se pide relocalización o ayuda; no mostrar precisión ficticia.
- **Trayecto en rover:** navegación conservadora si hay visibilidad reducida; no afirmar conducción autónoma a alta velocidad sin sensores aptos.

## 2.8. HUD y efectos visuales ARES-01

**Normal:** POI geológico, estado del testigo, tiempo de trabajo estimado, energía del traje, distancia al rover y ruta. **Aviso:** tarjeta amarilla de polvo; gráfico de tendencia y recomendación con dos respuestas. **Aborto:** banner rojo `EVA ABORT — RETURN REQUIRED`; ocultar distracciones científicas. **Navegación:** ruta actual, corredor de incertidumbre, zona de riesgo y desvío (+65 m). **Golpe:** etiqueta `SUIT INTEGRITY CHECK`, presión estable o sospecha según lectura; nunca un agujero visible explosivo. **Refugio:** confirmación de presurización y final de EVA. **Cierre:** informe científico parcial y regreso a la base.

**Sonido y cámara:** comienza con calma y viento ambiental débil; la tensión proviene de la visibilidad y las alertas, no de una ventisca capaz de arrastrar al astronauta. Primer plano del HUD en los momentos de diagnóstico, cámara en tercera persona para enseñar el terreno y transición al interior del rover en el retorno.

## 2.9. Resultado, éxito y casos alternativos

| Objetivo | Resultado de la rama principal |
|---|---|
| Identificar afloramiento y seleccionar ubicación | **Completado** |
| Fotografiar/documentar estratos | **Completado** |
| Extraer testigo de roca completo | **Abortado / pendiente** |
| Reconocer peligro topográfico y recalcular ruta | **Completado** |
| Diagnosticar lesión superficial del traje | **Completado; sin fuga detectada** |
| Llegar a rover, restablecer entorno seguro | **Completado** |
| Regresar 2,4 km a base | **Completado, mediante salto temporal** |

**Ramas si se implementan:** elegir «volver» ya en primer aviso (menos riesgo); pérdida de posición (alto y solicitar relocalización); fuga de presión confirmada (procedimiento de emergencia específico, sin garantizar retorno); sin corredor seguro (detenerse, coordinar asistencia). No necesitan animarse todas para la presentación.

---

# 3. ARES-02 — «Nightfall Protocol»

## 3.1. Logline y justificación de la noche

**Logline:** una avería eléctrica inmoviliza de noche el rover que transporta equipo esencial para una perforación conjunta; SARA evalúa cuánto tiempo puede mantenerse seguro el astronauta, recupera movilidad degradada mediante un diagnóstico verificable y elige una ruta de menor consumo hasta Bravo.

**Objetivo logístico-científico:** llevar a la estación temporal **Bravo** un **módulo de alimentación de reserva** y otros instrumentos necesarios para una perforación geológica con participación de dos astronautas a las 06:00 de la mañana. El compañero **no se está muriendo**: depende de la entrega para realizar la actividad científica planificada.

**Por qué se conduce de noche:** la tarea previa del protagonista, en otro emplazamiento, se retrasó por una incidencia técnica en la transferencia/organización de muestras. Se autoriza excepcionalmente un tránsito nocturno por una ruta previamente reconocida, comprobando iluminación, sensores, energía, calefacción y márgenes de seguridad. Esto explica el viaje sin presentar la conducción nocturna como rutina ni como una imprudencia automática. La expedición de una sola persona es simplificación de la demo.

**Motivación dramática:** si se cancela la entrega, el compañero probablemente deberá posponer la perforación. **Nunca se permite sacrificar reservas de vida para llegar puntualmente.**

## 3.2. Parámetros de situación

| Parámetro | Valor canónico | Estado |
|---|---:|---|
| Área | Jezero, ruta cartografiada hacia estación Bravo | Concepto ficticio |
| Hora de salida / inicio narrativo | 20:40, hora local marciana de la demo | Simulado |
| Inicio del recorrido hasta Bravo | 12 km aprox. | Simulado |
| Tramo restante al aparecer el fallo | ≈7 km | Simulado; ya se recorrieron ≈5 km |
| Incidencia principal | Fallo de convertidor de potencia asociado al módulo B | Ingeniería conceptual |
| Temperatura exterior de referencia | −72 °C | Ejemplo sintético; no climatología para esa noche |
| Hora objetivo de la operación de Bravo | 06:00 | Ficticio |
| Energía utilizable en batería A tras fallo | 9,5 kWh | Ejemplo de presupuesto disponible, no capacidad real del rover |
| Consumo esencial en reposo normal | 1,5 kW | Ejemplo sintético |
| Duración a 1,5 kW con 9,5 kWh | 6 h 20 min | Resultado matemático del ejemplo |
| Distancia directa vs alternativa | 7,0 km vs 8,1 km | Simulado |

**Ajuste de coherencia temporal:** a las 21:05 faltan aproximadamente **8 h 55 min** para las 06:00, no ocho horas exactas. La versión preliminar del guion decía «ocho horas» como cifra redonda. En la versión definitiva: decir «casi nueve horas» o «tiempo restante hasta 06:00: 08:55»; el horizonte de consumibles es aproximado y **no equivale automáticamente a supervivencia garantizada o muerte**. Mantener 1,5 kW × 8 h = 12 kWh solo como ejemplo matemático del boceto; para 8 h 55 min el consumo sería ≈13,4 kWh.

## 3.3. Avería única con consecuencias encadenadas

1. **Fallo primario:** una etapa del convertidor de potencia del módulo B sufre sobrecorriente/cortocircuito interno.
2. **Protección automática:** el sistema eléctrico aísla el módulo B para proteger los demás buses.
3. **Consecuencia inmediata:** el controlador de tracción detecta el evento y pasa a estado de protección; el rover se detiene. El bus esencial sigue alimentado por A.
4. **Consecuencia energética:** la batería A conserva 9,5 kWh utilizables. Hay energía para calefacción/soporte vital durante unas horas, pero menos que lo necesario para permanecer con **consumo normal** hasta la mañana.
5. **Consecuencia térmica:** el módulo B aislado se enfría; SARA no debe intentar reconectarlo sin verificar temperaturas y estado eléctrico. El frío incrementa las exigencias de operación.
6. **Salida posible, no milagro:** si el aislamiento ha sido verificado y el controlador admite una configuración **diseñada previamente** de operación degradada, A puede alimentar la tracción con límites de par, corriente y velocidad. SARA no puentea ni desactiva sistemas de seguridad.

**Por qué esta historia tiene drama sin sensacionalismo:** inicialmente hay luz y presión en el habitáculo, pero no se puede mover el vehículo. El astronauta pregunta si puede esperar hasta la mañana; SARA revela el desfase entre la energía útil y el consumo normal. El compañero pregunta si llegará el equipo. El rover podría salir del problema, pero **solo si la ruta y el margen energético lo permiten**.

## 3.4. Modelo energético consolidado para la demo

El ejemplo de la pantalla debe ser internamente consistente. Se fijan los siguientes números **sintéticos** y un requisito de reserva final **provisional** de 2,0 kWh:

| Variable | Directa | Alternativa |
|---|---:|---:|
| Distancia restante | 7,0 km | 8,1 km |
| Energía de tracción estimada | 7,4 kWh | 4,5 kWh |
| Sistemas vitales/térmicos durante marcha | 2,2 kWh | 2,2 kWh |
| Energía total prevista | **9,6 kWh** | **6,7 kWh** |
| Energía disponible al partir | 9,5 kWh | 9,5 kWh |
| Energía restante prevista al llegar | **−0,1 kWh (imposible)** | **2,8 kWh** |
| Reserva mínima del modelo | 2,0 kWh | 2,0 kWh |
| Margen por encima de reserva | **No viable** | **0,8 kWh** |

**Interpretación:** la alternativa es **más larga y menos exigente** por sus pendientes y resistencia al avance; la directa, aunque corta, falla la restricción energética. Los 2,2 kWh de cargas esenciales se asumen iguales en el cálculo simplificado para ambas rutas; en una implementación más precisa dependerían de **duración**, temperatura y potencia térmica, y por tanto deben recalcularse. El algoritmo debe actualizar la proyección con la energía realmente consumida.

**Parada de seguridad:** si el diagnóstico falla o se pierde la reserva mínima, la misión termina en modo refugio. El rover protege presión, calefacción esencial y comunicaciones. Bravo recibe información logística durante el diagnóstico. El juego no tiene una acción de solicitud de asistencia.

## 3.5. Recorrido jugable

| Etapa | Acción del jugador | Respuesta del sistema |
|---|---|---|
| Salida | Enciende los faros, inicia la marcha y sigue la línea curva sobre el terreno. | La guía muestra el rumbo hacia Bravo. Al completar la curva, el convertidor B falla sin aviso previo y la protección corta la tracción. |
| Avería | Consulta la autonomía, informa a Bravo y comprueba el aislamiento y los límites de A. | A mantiene el bus esencial. Solo un diagnóstico favorable habilita la comparación de rutas. |
| Recuperación | Compara los presupuestos, autoriza el modo degradado y carga la ruta alternativa. | La ruta directa supera la energía disponible. La alternativa conserva la reserva mínima proyectada. |
| Trayecto | Conduce por los puntos marcados, comprueba la reserva al aumentar el consumo y reanuda la marcha si hay margen. | El modelo recalcula la proyección con la distancia recorrida. Un margen insuficiente activa la parada de seguridad. |
| Entrega | Estaciona, recoge el módulo, sale por la esclusa, camina hasta Bravo y confirma la entrega. | El SEV queda visible en el punto de estacionamiento. B permanece aislada. |

## 3.6. Diálogos centrales recomendados

**Diagnóstico:**

> **Astronauta:** «SARA, ¿qué está pasando?»<br>
> **SARA:** «Fallo eléctrico en el módulo B. Propulsión deshabilitada. El soporte vital permanece operativo».<br>
> **Astronauta:** «¿Podemos esperar aquí?»  
> **SARA:** «Con el consumo actual, no puedo garantizar energía suficiente hasta la mañana. Analizando modos de conservación y recuperación de movilidad».

**Posible solución, sin saltarse protecciones:**

> **Astronauta:** «Necesito que hagas funcionar este rover».  
> **SARA:** «Hay una posibilidad de recuperar la movilidad sin utilizar el módulo dañado. Debo verificar el aislamiento eléctrico y los límites de la batería A antes de habilitarla».

**Decisión de ruta:**

> **SARA:** «Movilidad degradada disponible. La ruta original excede el presupuesto energético. Existe una alternativa más larga sobre terreno de menor resistencia».<br>
> **Astronauta:** «Encuentra la opción más segura».  
> **SARA:** «Ruta alternativa de 8,1 kilómetros. Consumo previsto de 6,7 kWh. Reserva estimada de 2,8 kWh. Recomiendo continuar bajo supervisión continua; si las previsiones caen por debajo del mínimo, detendremos el trayecto en un punto seguro».

**Contacto de Bravo:**

> **Bravo:** «ARES-02, aquí Bravo. Hemos recibido vuestra alerta. ¿Puedes confirmar si vas a llegar? Necesitamos el módulo para comenzar la perforación al amanecer».  
> **Astronauta:** «Hemos perdido un módulo de batería. SARA está comprobando una configuración de emergencia. Confirmaré la llegada cuando tengamos un margen seguro».

## 3.7. Decisiones y modos de seguridad ARES-02

**Estados:** `NIGHT_TRANSIT → POWER_FAULT → ENERGY_ASSESSMENT → BRAVO_CONTACT → ISOLATION_TEST → DEGRADED_DRIVE_READY → ROUTE_OPTIMIZATION → DEGRADED_TRANSIT → ENERGY_RECHECK → MISSION_CLOSED`.

**Reglas:**

- Proteger primero presión, atmósfera interior, calefacción indispensable y comunicaciones de emergencia; reducir carga científica e iluminación secundaria según diseño.
- No volver a conectar B por fuerza si hay cortocircuito, temperatura fuera de rango o aislamiento no confirmado.
- No interpretar «9,5 kWh disponibles» como energía total de un rover NASA real; es solo la reserva utilizable de A **en esta escena**.
- La reconfiguración requiere comprobación de aislamiento, límites eléctricos, estado térmico y confirmación de astronauta; no deshabilitar protecciones.
- La misión a Bravo solo continúa si la energía estimada para el trayecto **más la reserva** cabe en la energía disponible, con incertidumbre aceptable.
- Si fallan los requisitos, recomendar `SAFE_HAVEN`: detenerse en zona segura, modo de refugio, conservar energía, **posponer perforación**.
- Evitar una EVA nocturna de reparación improvisada mientras sea posible permanecer en el habitáculo.

## 3.8. HUD y efectos visuales ARES-02

**Normal:** mapa nocturno, faros, distancia a Bravo, hora local, ETA, estado de sistemas. **Avería:** interrupción breve, luces secundarias se atenúan, diagrama A verde/B rojo, tracción bloqueada. **Diagnóstico:** árbol causal de avería y comprobaciones de aislamiento, medidores de energía y temperatura. **Decisión:** la tracción degradada se habilita tras validar el diagnóstico y la ruta. El modo refugio cierra un intento sin margen para proseguir. **Rutas:** dos trazados con distancia, pendiente/resistencia, energía total proyectada y reserva final. **En marcha:** potencia, temperatura, consumo real y estimación actualizada. **Cierre:** estado seguro, carga entregada y módulo B pendiente de inspección.

**Tono:** noche marciana realmente oscura, faros limitados y cabina funcional. El dramatismo se apoya en el silencio, las alarmas y el presupuesto eléctrico, no en que la temperatura interior descienda instantáneamente a −72 °C.

## 3.9. Resultado, éxito y casos alternativos

| Objetivo | Resultado de rama principal |
|---|---|
| Identificar el fallo eléctrico | **Completado** |
| Aislar el módulo B | **Completado por protección automática** |
| Mantener soporte vital y presión | **Completado** |
| Recuperar tracción degradada sin puentear protecciones | **Completado si verificaciones satisfactorias** |
| Optimizar la ruta con energía y topografía | **Completado** |
| Llegar a Bravo con reserva | **Completado en simulación** |
| Entregar módulo para perforación de mañana | **Completado, sujeto a seguridad** |
| Reparar físicamente batería B | **No; queda para mantenimiento** |

**Ramas alternativas:** A no supera diagnóstico → parada en modo refugio; gasto superior al estimado → detenerse en lugar seguro y reevaluar; comunicaciones intermitentes → emitir mensaje cuando exista enlace y no inventar comunicación en tiempo real; modo de refugio energético viable → puede ser más seguro esperar aunque se cancele la misión de Bravo.

---

# 4. Especificación del comportamiento de SARA

## 4.1. Contrato de interacción

SARA debe exponer de manera clara: **qué ha detectado**, **con qué datos**, **cuánta confianza tiene**, **qué consecuencia prevé**, **qué recomienda**, **por qué** y **qué exige confirmación humana**. Evitar «conozco el futuro» o «he reparado el hardware» cuando solo se ha cambiado un modo operacional.

| Prioridad | Tipo de mensaje | Comportamiento |
|---|---|---|
| P0 | Riesgo inmediato o pérdida de margen de seguridad | Voz breve, alarma clara, instrucción operativa, confirmación de recepción |
| P1 | Recomendación de regreso / ruta / ahorro energético | Presentar alternativas y justificarlas, pedir decisión |
| P2 | Diagnóstico e incertidumbre | Evidencia de sensores, intervalo de confianza, comprobaciones en curso |
| P3 | Ciencia / notas | Información secundaria; minimizar durante emergencias |

### 4.2. Datos mínimos del motor de simulación

**Globales:** `mission_id`, `demo_time_s`, `mission_local_time`, `scene`, `jarvis_state`, `risk_level`, `sources`, `is_simulation`.

**ARES-01:** `sample_progress`, `sample_secured` (siempre `false` en rama principal), `dust_trend`, `visibility_confidence`, `astronaut_position`, `position_uncertainty_m`, `rover_distance_m`, `terrain_risk`, `route_id`, `suit_outer_damage_possible`, `suit_pressure_trend`, `eva_abort_required`.

**ARES-02:** `battery_a_usable_kwh`, `battery_b_isolated`, `power_converter_fault`, `drive_state`, `cabin_pressure_ok`, `critical_heat_load_kw`, `module_temperature`, `energy_consumption_kw`, `route_direct_kwh`, `route_alternative_kwh`, `minimum_reserve_kwh`, `estimated_arrival_energy_kwh`, `safe_haven_viable`, `bravo_distance_km`.

**Convención:** todos los campos numéricos deben tener `unit`; todos los sensores tienen `quality` (`valid`, `degraded`, `unavailable`) y `provenance` (`historical_reference`, `simulated_sensor`, `derived`, `design_assumption`).

## 4.3. Pseudocódigo de decisión (no software de misión real)

```text
SI misión = ARES-01:
    evaluar tendencia_de_polvo, calidad_de_navegación, tiempo_retorno, margen_eva
    SI riesgo_incrementado Y margen_retorno_aceptable:
        RECOMENDAR volver; preguntar al astronauta; mantener monitorización
    SI límites_eva_superados O retorno_no_confiable:
        marcar EVA_ABORT_REQUIRED; instruir detener muestreo y comenzar retorno
    SI obstáculo_riesgoso Y posición_verificada:
        calcular desvío; explicar coste y peligro; solicitar confirmación
    SI posición_no_verificada:
        detener; relocalizar; NO mostrar una ruta exacta inventada
    SI impacto_traje:
        analizar presión y sensores; no diagnosticar perforación sin evidencia
    SI rover_alcanzado:
        verificar entrada/presurización; planificar regreso conservador

SI misión = ARES-02:
    AL detectar fallo eléctrico:
        proteger bus esencial; aislar B; diagnosticar causa
        comparar consumo_normal_hasta_amanecer y modo refugio
    SI aislamiento_B_verificado Y controlador_permite_degradado:
        validar límites de A; preparar movilidad degradada para autorización humana
    PARA cada ruta de retorno:
        estimar E_tracción + E_vida_y_térmica + incertidumbre
        descartar si excede disponible - reserva_mínima
    SI hay ruta segura y energía con margen:
        recomendar ruta; monitorizar consumo real continuamente
    SI NO:
        conservar soporte vital, entrar en modo refugio y aplazar la entrega
```

## 4.4. Presentación al jurado: qué demuestra cada una

**ARES-01:** «No elegimos simplemente una ruta: detectamos que las condiciones cambian, sabemos cuándo interrumpir la ciencia, identificamos peligros geográficos y comprobamos un posible daño de traje».

**ARES-02:** «No mostramos simplemente el porcentaje de batería: diagnosticamos la arquitectura eléctrica, protegemos funciones vitales, estimamos energía de tracción y calefacción, y seleccionamos la ruta con suficiente margen».

**Mensaje común:** «ARES transforma datos de misiones científicas en **decisiones argumentadas para exploración humana**. Cuando no tiene información suficiente, reconoce sus límites».

---

# 5. Guía de producción para agentes, animación y desarrollo

## 5.1. Secuencia de implementación sugerida

1. **Crear el estado de misión y un reloj determinista** por escenario. Los sucesos dependen del reloj de demo o de acciones del astronauta, y se pueden reiniciar para presentar al jurado.
2. **Construir una tabla de eventos** con `time`, `trigger`, `telemetry_patch`, `visuals`, `voice_line`, `available_choices`, `next_state`.
3. **Separar lógica y presentación:** el modelo de riesgo decide el estado; la voz de SARA no debe inventar métricas no suministradas.
4. **Vincular las capas del mapa** a riesgos concretos: pendiente, zonas no verificadas, rutas y energía. Si el polígono es inventado, etiquetarlo «simulado».
5. **Mantener el avance ligado a las acciones del jugador.** ARES-01 permite continuar tras el primer aviso. ARES-02 requiere operar el rover y entregar el módulo en Bravo.
6. **Añadir saltos temporales visibles** («+4 min»; «secuencia de retorno acelerada»), evitando velocidades irreales.
7. **Ensayar un fallo controlado de datos:** si un sensor no responde, SARA lo comunica y usa un procedimiento conservador.
8. **Cerrar cada demo con un informe** que separe objetivos logrados/no logrados, sensores utilizados, incertidumbres y razón de la decisión.

## 5.2. Ejemplo de evento estructurado para agente

```json
{
  "event_id": "A1-WEATHER-ABORT",
  "scenario_id": "ARES-01",
  "demo_second": 40,
  "trigger": "dust_trend_worsens_and_navigation_margin_below_simulated_limit",
  "simulated": true,
  "telemetry_patch": {
    "risk_level": "critical",
    "eva_abort_required": true,
    "visibility_confidence": "degraded"
  },
  "ui": {
    "banner": "EVA ABORT — RETURN REQUIRED",
    "theme": "critical",
    "focus": "return_to_rover"
  },
  "jarvis_es": "Alerta crítica. El deterioro de visibilidad está superando los límites de seguridad de la misión. Aborta la operación inmediatamente. Regresa al rover.",
  "human_action": "stop_sampling_and_acknowledge",
  "next_state": "RETURN_PREP"
}
```

## 5.3. Lista de decisiones pendientes (no inventarlas al programar)

- Elegir **coordenadas y extensión reales** de la región de Jezero y qué DEM se utilizará; no confundir terraza ficticia con Wildcat Ridge exacto.
- Definir el **criterio cuantitativo** de estado amarillo/rojo en ARES-01 y documentar que es una regla sintética de demo.
- Validar el esquema de localización y si hay baliza/contacto del rover; no asumir GPS marciano.
- Definir incertidumbres de topografía/visibilidad y evitar afirmar que un DEM grueso detecta rocas de centímetros.
- Precisar qué telemetría ficticia admite el traje para distinguir rasgadura exterior y fuga de presión.
- Elegir el modelo conceptual del vehículo y la correspondencia visual de sistemas A/B; **no atribuir a NASA** esos detalles.
- Precisar **capacidad térmica, pérdidas y modos de refugio**, para comprobar si el estado de espera es seguro en ARES-02.
- Introducir un margen explícito para **errores del modelo energético**, quizá mayor que los 0,8 kWh de margen residual del ejemplo.
- Decidir si la llegada a Bravo se representa con un modelo mínimo de estación o se resuelve mediante indicador HUD y transición.
- Preparar créditos, licencias de assets NASA y una pantalla de «Datos reales y supuestos simulados».

## 5.4. Pruebas de aceptación (QA)

| Prueba | Esperado |
|---|---|
| A1-01: aceptar continuar en 00:20 | SARA mantiene advertencia; nueva alerta de aborto en 00:40 |
| A1-02: abortar y retirarse | La muestra permanece `not_collected`; la bitácora se conserva |
| A1-03: detección de ladera | Se ofrece ruta alternativa +65 m con explicación de riesgo |
| A1-04: caída y traje | El mensaje inicial es incierto; no anuncia perforación con presión estable |
| A1-05: falta de posición fiable | SARA pide detenerse; no ofrece guía de precisión injustificada |
| A1-06: llegada al rover y base | Dos etapas distintas, con transición temporal visible |
| A2-01: fallo de B | B aislada; A y soporte vital permanecen operativos |
| A2-02: movilidad degradada | Solo se habilita después de confirmar aislamiento y límites |
| A2-03: cálculo energético | Directa: 9,6 > 9,5 kWh; alternativa: 6,7 kWh; restante 2,8 kWh |
| A2-04: ruta no viable | Se activa el modo refugio y se aplaza la entrega |
| A2-05: caída de margen en viaje | Recalcula, advierte y cambia plan si supera límites |
| A2-06: llegada a Bravo | Compañero recibe equipo; B sigue aislada, sin «reparación milagrosa» |

---

# 6. Referencias científicas verificadas y trazabilidad

Fuentes que sustentan el **contexto científico**; no prueban las capacidades hipotéticas del rover ni los eventos de los astronautas. En la interfaz, las mediciones sintéticas siempre se etiquetarán como tales.

- **[S1] NASA Science — Perseverance Rock Cores From 'Wildcat Ridge'.** Dimensiones ≈13 × 60 mm y contexto sedimentario del delta. https://science.nasa.gov/resource/perseverance-rock-cores-from-wildcat-ridge/
- **[S2] NASA Science — Dusty Differences Between Mars and Earth.** Efectos del polvo y menor fuerza del viento en atmósfera marciana. https://science.nasa.gov/earth/earth-observatory/dusty-differences-between-mars-and-earth-149926/
- **[S3] NASA — The Fact and Fiction of Martian Dust Storms.** Riesgos de polvo frente a representaciones cinematográficas exageradas. https://www.nasa.gov/solar-system/the-fact-and-fiction-of-martian-dust-storms/
- **[S4] NASA — Spacewalk Spacesuit Basics.** Funciones distintas de las capas externas y de presurización del traje. https://www.nasa.gov/centers-and-facilities/johnson/spacewalk-spacesuit-basics/
- **[S5] NASA Science — Perseverance Science Highlights.** Ambiente lacustre y potencial de preservar señales de antigua habitabilidad en Wildcat Ridge. https://science.nasa.gov/mission/mars-2020-perseverance/science-highlights/
- **[S6] NASA — Perseverance Science Instruments / MEDA.** Sensores de viento, temperatura, presión y polvo. https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/
- **[S7] NASA — Human Mars Mission Surface Power Impacts on Timeline and Traverse Capabilities.** Referencia de planificación energética y recorridos humanos. https://ntrs.nasa.gov/citations/20220003043
- **[S8] Estudio científico — Dust, Sand, and Winds Within an Active Martian Storm in Jezero Crater.** Tormenta 5–11 enero 2022 y observaciones de polvo/viento en Jezero. https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/
- **[S9] NASA Science — Grounded: First Flight Delay Due to Inclement Weather on Another World.** Cambio real de misión por meteorología incierta y reducción de ~18 % en luz absorbida por paneles de Ingenuity. https://science.nasa.gov/blog/grounded-first-flight-delay-due-to-inclement-weather-on-another-world/
- **[S10] NASA PDS — MEDA, archivos de datos calibrados.** Referencia para vincular variables atmosféricas históricas a la demo. https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html
- **[S11] NASA — Humans to Mars.** Habitabilidad, energía y soporte vital para exploración humana. https://www.nasa.gov/humans-in-space/humans-to-mars/

---

# 7. Resumen operativo para copiar a un agente

> **Contexto invariable:** estamos desarrollando una demostración del reto «Interplanetary Survival Guide: Martian Map» para NASA Space Apps Challenge 2026. Hay dos misiones ficticias en Jezero. El usuario dispone visualmente de un astronauta, un rover humano conceptual, un paisaje/mapa 3D y SARA. Queremos ciencia plausible, con datos NASA históricos y simulación explícitamente etiquetada. Nada de sensores, horarios, localizaciones ni valores que se presenten como reales sin fuente. Respetar el guion, las cifras y los estados de este dossier; consultar «decisiones pendientes» antes de inventar detalles.
>
> **ARES-01:** testigo de lutita sedimentaria de 13 × 60 mm en terraza de roca inaccesible al rover, 350 m a pie y 2,4 km de rover a base; quedan 10 min de trabajo. En t=00:20 SARA recomienda abortar y pregunta si continúa; astronauta decide continuar. A t=00:40, exactamente 20 s después, SARA da la orden de abortar por pérdida de margen de navegación; **la muestra NO se obtiene**. Al regresar se identifica pendiente lateral con regolito poco consolidado, desvío +65 m; ocurre caída por piedra suelta y roce exterior del traje; SARA verifica que la presión está estable (sin fuga detectada). A t=02:05, tras salto temporal, está a ≈90 m del rover; llega, se presuriza y vuelve 2,4 km a base. Informe final parcial.
>
> **ARES-02:** conducción nocturna excepcional y autorizada para entregar equipo al compañero Bravo antes de la perforación de las 06:00. Salida 20:40 a ~12 km; a las 21:05 quedan ~7 km y falla convertidor del módulo B; protección lo aísla, tracción bloqueada, bus esencial en batería A. A tiene 9,5 kWh útiles; consumo normal en parada 1,5 kW = 6 h 20 min, menos de ~8 h 55 min hasta las 06:00. SARA evalúa la autonomía y el modo refugio; si las verificaciones lo permiten, activa modo de tracción degradada con A. Ruta directa 7,0 km: 7,4 kWh tracción + 2,2 esenciales = 9,6 kWh → no viable. Ruta alternativa 8,1 km: 4,5 + 2,2 = 6,7 kWh → resto 2,8 kWh; reserva mínima provisional 2,0 kWh → margen 0,8 kWh. Se elige solo con seguridad y supervisión continua, llegando a Bravo; B permanece aislada. **No hay reparación instantánea ni prioridad científica por encima de supervivencia.**

**Fin del documento · Versión 1.0, 14 noviembre 2026**
