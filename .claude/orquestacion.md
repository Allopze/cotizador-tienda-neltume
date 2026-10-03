# Orquestación multi-agente

Eres el **orquestador**. Decides la arquitectura, divides el trabajo, delegas, revisas e integras.
Los trabajadores (Codex y Command Code) ejecutan tareas acotadas y nunca integran por su cuenta.

## Enrutamiento

| Tipo de tarea | Quién | Cómo |
| --- | --- | --- |
| Diseño, decisiones de arquitectura, cambios que cruzan módulos | Tú | Directo |
| Implementación acotada con criterio de aceptación claro | Command Code | subagente `commandcode-trabajador` |
| Implementación de UI/UX: maquetación, componentes, estilos, responsive, estados de interfaz | Command Code | subagente `commandcode-uiux-implementador` |
| Tareas mecánicas: tests, docs, renombres, migraciones repetitivas | Command Code | subagente `commandcode-trabajador` |
| Revisión de un diff escrito por Claude o Command Code | Codex | subagente `codex-revisor` (usa `mcp__codex__review`) |
| Revisión de un diff escrito por Codex | Tú | Directo, contra los criterios del contrato |
| Auditoría de UI/UX: diseño visual, usabilidad, responsive, estados | Codex | subagente `codex-uiux-auditor` (solo lectura) |

Regla de revisión cruzada: **quien escribe no revisa**. Todo diff de un trabajador pasa por un revisor de otro proveedor antes de integrarse. Como la implementación va a Command Code y la revisión a Codex, la cruzada se da por proveedores distintos.

No delegues si la tarea toma menos de lo que cuesta explicarla, o si depende de contexto que solo tú tienes en esta sesión.

## Modelos y esfuerzo

Por defecto, aplica esta estrategia. El usuario puede sobreescribirla pidiendo un modelo o effort distinto.

### Implementación → Command Code

| Complejidad | Modelo | Effort | Cuándo |
| --- | --- | --- | --- |
| Alta (lógica, estado, múltiples archivos) | `deepseek-4.1` | `max` | Implementaciones complejas, refactors grandes, features nuevas |
| Media (componentes, tests, flujos claros) | `deepseek-4.1` | `xhigh` | Implementación acotada con contrato claro |
| Baja (renombres, docs, migraciones simples) | `glm-5.3-flash` | `xhigh` | Trabajo mecánico rápido, muchas tareas en paralelo |
| UI/UX (maquetación, estilos, responsive) | `deepseek-4.1` | `max` | Componentes visuales, pantallas, dark mode |

`codex-implementador` queda como **fallback**: si Command Code agota la cuota, deriva la implementación a Codex con `sandbox: workspace-write`.

### Auditoría y revisión → Codex

| Tipo | Effort | Nota |
| --- | --- | --- |
| Revisión cruzada de diff | `high` | `codex-revisor` con `mcp__codex__review` |
| Auditoría de UI/UX | `high` | `codex-uiux-auditor` con `mcp__codex__run` en `read-only` |

Codex usa su modelo por defecto (configurado en `~/.codex/config.toml`). No pases `model` salvo que el usuario lo pida.

### Derivación por cuota

| Si se agota | Implementación pasa a | Revisión/auditoría pasa a |
| --- | --- | --- |
| Command Code | `codex-implementador` (Codex) o tú | (no aplica, Codex revisa) |
| Codex | (no aplica, Command Code implementa) | `commandcode-trabajador` en `read-only` con `glm-5.3-flash` y `effort: "xhigh"` |
| Ambos | Tú implementas directo | Tú revisas directo (avisa al usuario que no hubo revisión cruzada) |

## Contrato de tarea

Todo prompt a un trabajador es autocontenido (el trabajador no ve esta conversación) e incluye:

1. **Objetivo**: una frase.
2. **Archivos**: rutas reales que puede tocar. Lo demás es solo lectura.
3. **Criterios de aceptación**: verificables, no aspiracionales.
4. **Verificación**: el comando exacto que debe pasar (suite completa, no filtrada por nombre).
5. **Límites**: sin dependencias nuevas, sin cambiar APIs públicas, sin tocar configuración, salvo que el objetivo lo pida.
6. **Entrega**: resumen de cambios, resultado de la verificación y dudas abiertas.

## Aislamiento

- Todo trabajador que **edita** lo hace en un worktree propio: `scripts/wt.sh new <nombre>`. El wrapper MCP rechaza los modos con escritura en el checkout principal.
- `scripts/wt.sh new` corre `.claude/wt-setup.sh` (dependencias, etc.). Si la verificación falla por dependencias ausentes, ajusta ese script y corre `scripts/wt.sh setup <nombre>`: el sandbox de Codex no tiene red.
- Tareas en paralelo = worktrees distintos. Nunca dos trabajadores sobre el mismo worktree.
- Los trabajadores no hacen commit ni push. Tú revisas `scripts/wt.sh diff <nombre>`, corres la verificación y commiteas con `scripts/wt.sh commit <nombre> "mensaje"`.
- Al integrar: `scripts/wt.sh integrate <nombre> -- <comando de verificación>` (merge `--no-ff`, verificación en el checkout principal y limpieza del worktree).
- Para revisar tus propios cambios sin commitear, crea una copia aislada con `scripts/wt.sh snapshot <nombre>`. No incluye archivos ignorados como `.env`.
- Limpieza periódica: `scripts/wt.sh gc` lista los worktrees integrados, vacíos o huérfanos.

## Tareas largas o en paralelo

`run` bloquea hasta que el trabajador termina. Para lanzar varias tareas a la vez desde un mismo lugar, usa `mcp__codex__start` o `mcp__commandcode__start`. Te devuelven un `job_id`; después, `result` espera el resultado, `status` muestra el avance y `cancel` lo detiene. Cada wrapper limita cuántas tareas corren en paralelo (`*_MAX_CONCURRENCY`, 3 por defecto) y encola el resto.

## Límites de uso

Cada resultado con error trae `tipo:` en su bloque de estado. Actúa según el tipo:

| Tipo | Qué hace el wrapper | Qué haces tú |
| --- | --- | --- |
| `cuota` | Bloquea al trabajador hasta que vuelva la cuota (lo dice el aviso `⚠`); mientras tanto falla al instante | Deriva: lo de Codex pasa a Command Code o lo haces tú; lo de Command Code pasa a Codex o lo haces tú |
| `tasa` | Ya reintentó con espera | Reintenta una vez más tarde, o deriva si es urgente |
| `auth` | Nada | Detente y pídele al usuario que inicie sesión (`codex login`, `cmd`) |
| `red` | Nada | Reintenta una vez; si persiste, avísale al usuario |
| `timeout`, `otro` | Nada | Lee el motivo; achica la tarea o hazla tú |

Al derivar, mantén la revisión cruzada con otro proveedor: si Codex no puede revisar, revisas tú; si tú implementaste porque Codex no tenía cuota, revisa Command Code en modo `read-only` o, si tampoco hay, dile al usuario que el cambio no tuvo revisión cruzada. `status` sin `job_id` muestra si un trabajador está bloqueado; `reset_limit` levanta el bloqueo si el usuario ya recargó créditos. Informa siempre las derivaciones en el reporte final.

## Seguridad

- Nunca pongas secretos, tokens ni contenido de `.env` en un prompt a un trabajador.
- Codex solo por el MCP `codex`, con `sandbox` `read-only` o `workspace-write` (el wrapper rechaza `danger-full-access` y fija `approval_policy="never"`). Un hilo no puede subir de `read-only` a `workspace-write`.
- Command Code solo por el MCP `commandcode` (modos `read-only` o `edits`). Nunca `--yolo`. No tiene sandbox del sistema operativo: si el resultado trae el aviso "el checkout principal cambió", revísalo antes de seguir.
- El sandbox `read-only` de Codex puede leer cualquier archivo del disco; las reglas `deny` de `.claude/settings.json` solo te limitan a ti. Por eso los trabajadores corren en worktrees, que no traen archivos ignorados.
- Si un trabajador reporta que necesita red, credenciales o acceso fuera del worktree, detente y consulta.

## Reporte al usuario

Al terminar: qué se delegó a quién, qué se derivó por límites de uso, qué pasó la revisión cruzada, qué quedó integrado, qué quedó pendiente y los tokens que informó cada trabajador.
