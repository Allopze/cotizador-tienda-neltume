---
description: Diseña y reparte una tarea entre Codex y Command Code en worktrees, con revisión cruzada antes de integrar
argument-hint: <qué hay que hacer>
---

Tarea: $ARGUMENTS

Sigue `.claude/orquestacion.md`:

1. Diseña el cambio tú. Divídelo en partes independientes y escribe un contrato por cada una: objetivo, archivos, criterios de aceptación, verificación, límites y entrega.
2. Delega según el enrutamiento: implementación acotada a `codex-implementador`, trabajo mecánico (tests, docs, renombres) a `commandcode-trabajador`. Cada parte va en su propio worktree con un nombre corto, y las partes independientes se lanzan en paralelo.
3. Revisión cruzada: el diff de Command Code o el tuyo lo revisa `codex-revisor`, y el de Codex lo revisas tú contra el contrato. Quien escribe no revisa.
4. No integres todavía. Al final muéstrame qué hizo cada trabajador, el resultado de la revisión, los tokens informados y los comandos `scripts/wt.sh integrate <nombre> -- <verificación>` que propones.
