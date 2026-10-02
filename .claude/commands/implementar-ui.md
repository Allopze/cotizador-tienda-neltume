---
description: Delega implementación de UI/UX a Command Code en un worktree aislado
argument-hint: <qué implementar en la interfaz>
---

Tarea de UI/UX: $ARGUMENTS

Sigue `.claude/orquestacion.md`:

1. Diseña el cambio de interfaz tú. Escribe un contrato con: objetivo, archivos a tocar, criterios de aceptación (incluye estados de UI, responsive y tokens), verificación y límites.
2. Delega a `commandcode-uiux-implementador` con un nombre corto de tarea. Si la tarea tiene partes independientes (por ejemplo, componente + pantalla), divídelas en worktrees separados.
3. Cuando el implementador entregue, lanza `codex-uiux-auditor` sobre el worktree resultante para una auditoría cruzada del diseño visual y la usabilidad (Codex revisa lo que Command Code implementó).
4. No integres todavía. Al final muéstrame: qué se implementó, el checklist de UI del implementador, los hallazgos de la auditoría, los tokens consumidos y el comando `scripts/wt.sh integrate <nombre> -- <verificación>` que proponés.
