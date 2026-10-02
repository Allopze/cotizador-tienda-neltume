---
description: Integra el worktree de una tarea (commit si falta, merge --no-ff, verificación y limpieza)
argument-hint: <nombre> [comando de verificación]
---

Integra: $ARGUMENTS

1. Corre `scripts/wt.sh diff <nombre>` y confirma que ese cambio pasó la revisión cruzada en esta conversación. Si no la pasó, pregúntame antes de seguir.
2. Si hay cambios sin commitear, commitéalos con `scripts/wt.sh commit <nombre> "<mensaje descriptivo>"`.
3. Ejecuta `scripts/wt.sh integrate <nombre> -- <verificación>`. Si no te di la verificación, usa la del contrato de esa tarea, y si no hay contrato, pregúntame.
4. Reporta el resultado. Si la verificación falla después del merge, no deshagas nada sin preguntarme.
