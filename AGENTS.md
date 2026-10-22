# AGENTS.md

Instrucciones para cualquier agente que trabaje en este repositorio.

---

## 1. Qué es este proyecto

**SIN&AT** — Sistema de Inteligencia de Negocios y Alerta Temprana para el restaurante Vila Baleia (Porto Moniz, Madeira, Portugal).

Es el prototipo de un Trabajo de Grado de Ingeniería de Sistemas. Su propósito no es solo mostrar datos: es **advertir las condiciones de riesgo antes de que se conviertan en pérdidas**.

Si una funcionalidad no contribuye a anticipar un riesgo o a sustentar una decisión con evidencia, probablemente no pertenece a este sistema.

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vite + React + TypeScript |
| Estilos | Tailwind CSS + shadcn/ui |
| Backend | Supabase (PostgreSQL + Auth + RLS + Realtime) |
| Lógica del motor | Funciones SQL (PL/pgSQL) + pg_cron |
| Gráficos | Recharts |

No agregues dependencias fuera de esta lista sin preguntar.

## 3. Arquitectura

Cinco componentes, en este orden de flujo:

```
Captura de datos  →  Repositorio  →  Motor de reglas  →  Alertas  →  Notificación
                          ↓
                     Tableros
```

- **Captura** — formularios de recepción, consumo, merma y comandas
- **Repositorio** — las tablas y vistas de PostgreSQL
- **Motor de reglas** — funciones SQL que deducen hechos y generan alertas
- **Alertas** — bandeja in-app con historial
- **Tableros** — seis indicadores

## 4. Modelo de datos

Diez tablas: `perfil`, `proveedor`, `insumo`, `lote`, `movimiento`, `entrega`, `comanda`, `regla`, `hecho`, `alerta`.

Cinco vistas: `v_consumo_promedio`, `v_cobertura`, `v_pedido_sugerido`, `v_kpi_suministro`, `v_kpi_servicio`.

**No crees tablas nuevas sin preguntar.** Si necesitas guardar algo que no cabe, propón primero dónde encajarlo.

## 5. Fórmulas — implementar exactamente así

Estas expresiones están documentadas en el Trabajo de Grado. **No las cambies ni las aproximes.**

```
CPD(i)   = consumo total del insumo en el período / número de días del período
           → consumo promedio diario

DC(i)    = existencia actual / CPD(i)
           → días de cobertura

DRC(l)   = fecha_caducidad(lote) − fecha actual
           → días restantes a caducidad

NP(i)    = CPD(i) × (R + lead_time_dias(proveedor))
           → nivel objetivo de pedido;  R = 7 (revisión semanal)

Q(i)     = max(0, NP(i) − existencia actual)
           → cantidad a pedir

QR(l)    = max(0, cantidad_actual(lote) − CPD(i) × DRC(l))
           → cantidad en riesgo de merma

TCP(p)   = (entregas conformes y a tiempo / entregas totales) × 100
           → cumplimiento del proveedor

Uf       = percentil 85 de los tiempos históricos de esa franja horaria
           → umbral dinámico de servicio

Sev      = (valor observado − umbral) / umbral
           → BAJA si <= 0,25   MEDIA si <= 0,60   ALTA si > 0,60
```

**Condición de riesgo de faltante:**
```
DC(i) < dias_hasta_proximo_pedido + lead_time_dias(proveedor)
```

**Supresión de avisos repetidos:**
```
emitir la alerta solo si:  ahora − última_alerta_del_mismo_tipo >= ventana_supresion_min
```

### Dos aclaraciones que importan

**El aprovisionamiento es de revisión periódica, no continua.** El restaurante pide los lunes. Por eso no existe "punto de reposición": existe un nivel objetivo y una cantidad a pedir. No implementes ROP clásico.

**QR es el indicador más valioso del sistema.** Predice cuánto de un lote se va a dañar *antes* de que se dañe. Si tengo 10 kg, consumo 1 kg/día y caduca en 4 días, QR = 6 kg. Esa cifra se conoce hoy, no en cuatro días.

## 6. El motor de reglas

### Las seis reglas

| Código | Tipo | Condición | Acción |
|---|---|---|---|
| R1 | Nivel 1 | `DRC(lote) <= dias_alerta_caducidad(insumo)` y stock > 0 | Afirma hecho `riesgo_caducidad` |
| R2 | Nivel 1 | `DC(i) < dprox + lead_time` | Afirma hecho `riesgo_faltante` |
| R3 | Nivel 1 | `TCP(p) < 80` | Afirma hecho `proveedor_no_confiable` |
| R5 | Nivel 1 | `DC(i) > 2 × vida_util_dias(i)` | Afirma hecho `sobrestock` |
| **R4** | **Nivel 2** | `riesgo_faltante(i)` **Y** `proveedor_no_confiable(prov(i))` | Alerta ALTA + aumentar cantidad |
| **R6** | **Nivel 2** | `riesgo_caducidad(l)` **Y** `sobrestock(i)` | Alerta SOBRECOMPRA + reducir pedido |

### El ciclo de inferencia

Encadenamiento hacia adelante. **No lo simplifiques a una sola pasada.**

```
1. Cargar hechos vigentes en memoria de trabajo
2. Equiparación: hallar reglas cuya condición se cumple
3. Resolución de conflictos: ordenar por prioridad, luego por severidad
4. Ejecución: afirmar el hecho o generar la alerta
5. Volver al paso 2 mientras se hayan afirmado hechos nuevos
```

El ciclo termina solo cuando una iteración no produce ningún hecho nuevo. Como el conjunto de hechos derivables es finito, siempre termina.

### Por qué esto importa

R4 y R6 **no leen la base de datos directamente**: leen hechos que R1, R2, R3 y R5 dedujeron antes. Esa es la diferencia entre un motor de inferencia y un `if` grande. Si al implementarlo te resulta más fácil que R6 consulte las tablas directamente, **no lo hagas**: romperías lo que distingue a este sistema.

R6 es el caso emblemático. Ninguna de sus dos premisas explica una pérdida por sí sola. Juntas deducen algo que ninguna contenía: que la merma se debe a sobrecompra sistemática. El sistema no solo avisa que algo pasará, deduce **por qué** pasa.

## 7. Reglas de la casa

### Siempre

- Español en la interfaz, en los comentarios y en los nombres de tablas y campos
- Row Level Security activo en todas las tablas, sin excepción
- Los umbrales viven en la tabla `regla`, nunca escritos en el código
- Toda alerta registra qué acción tomó el usuario al atenderla
- Migraciones SQL versionadas en `supabase/migrations/`

### Nunca

- Tablas nuevas sin preguntar
- Librerías nuevas sin preguntar
- Funcionalidades fuera del alcance del beta sin preguntar
- Valores de umbral escritos dentro del código
- Lógica de negocio duplicada entre el frontend y la base de datos: **vive en la base de datos**
- Borrar registros históricos: se marcan como inactivos

### Dos requerimientos no funcionales que condicionan el diseño

**Usabilidad (RNF-01).** Todo el personal entrevistado condicionó su aceptación a que el sistema no añada carga administrativa. Es una condición de aceptación, no una preferencia. Si un registro exige más de tres campos o más de treinta segundos, está mal diseñado.

**Conectividad intermitente (RNF-06).** El restaurante está en una isla. La aplicación no puede romperse ante una desconexión: muestra el último dato conocido y reintenta.

## 8. Flujo de trabajo

El proyecto se gestiona con **Kanban**, con un límite de **una sola tarea en desarrollo a la vez**. Termina lo que está en curso antes de empezar otra cosa.

Se construye por entregas, en este orden:

```
I    Núcleo: base de datos, acceso, catálogos, registro de suministro
II   Alerta por caducidad de extremo a extremo  ← primera demo real
III  Alerta por faltante + cumplimiento de proveedores
IV   Comandas y tiempos de servicio
V    Tableros
VI   Pedido sugerido e integración
```

**Detente al final de cada entrega y espera revisión.** No encadenes dos entregas sin confirmación.

## 9. Verificación

Antes de dar por terminada cualquier entrega:

1. Las migraciones corren limpias desde cero
2. El seed genera datos que **disparan al menos una alerta de cada tipo**
3. Cada fórmula implementada coincide con su definición de la sección 5 — verifícalo con un caso calculado a mano
4. R4 y R6 solo se disparan cuando sus hechos previos están afirmados
5. RLS probado: un usuario con rol `operativo` no puede leer ni modificar lo que corresponde al `gerente`
6. La interfaz no se rompe si Supabase no responde

## 10. Si tienes dudas

Pregunta antes de construir. Es preferible una pregunta de más que una funcionalidad fuera de alcance que luego haya que desmontar — con el riesgo de arrastrar la base de datos en el camino.
