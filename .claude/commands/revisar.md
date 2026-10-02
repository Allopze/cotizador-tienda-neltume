---
description: Revisión cruzada con Codex, en solo lectura, de cambios sin commitear, de un worktree de agente o de una rama
argument-hint: "[worktree | rama] (vacío = cambios sin commitear)"
---

Usa el subagente `codex-revisor` para revisar: $ARGUMENTS

- Vacío: los cambios sin commitear del checkout actual, en una copia aislada con `scripts/wt.sh snapshot`.
- Un nombre que aparece en `scripts/wt.sh list`: ese worktree.
- Otro valor: trátalo como una rama.

Pásale el objetivo del cambio si lo conoces por esta conversación. Devuélveme los hallazgos confirmados y el veredicto.
