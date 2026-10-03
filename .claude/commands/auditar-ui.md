---
description: Auditoría de diseño visual y usabilidad con Codex en solo lectura
argument-hint: <rutas, componentes o pantallas a auditar>
---

Tarea de auditoría UI/UX: $ARGUMENTS

Usa el subagente `codex-uiux-auditor` para revisar los archivos indicados.

1. Si el argumento son rutas o nombres de componentes, pásalos directamente al auditor.
2. Si el argumento es un nombre de worktree (aparece en `scripts/wt.sh list`), audita los archivos cambiados en ese worktree: obtén la lista con `scripts/wt.sh diff <nombre>`.
3. Si no hay argumento, audita los archivos de interfaz cambiados sin commitear (`git diff --name-only HEAD`).

Pásale el contexto del cambio si lo conoces por esta conversación. Devuélveme el resumen ejecutivo, los hallazgos confirmados y el veredicto.
