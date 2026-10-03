#!/usr/bin/env bash
# Worktrees para trabajadores (Codex, Command Code…). Viven FUERA del repo:
#   <padre>/<repo>.wt/<nombre>   rama: agente/<nombre>
# Uso:
#   scripts/wt.sh new <nombre> [base]          crea (o reutiliza) y corre .claude/wt-setup.sh; última línea = ruta
#   scripts/wt.sh snapshot <nombre>            worktree con tus cambios sin commitear, para revisarlos aislados
#   scripts/wt.sh setup <nombre>               vuelve a correr .claude/wt-setup.sh en el worktree
#   scripts/wt.sh path <nombre>                imprime la ruta
#   scripts/wt.sh list                         lista worktrees de agentes
#   scripts/wt.sh diff <nombre> [--full]       cambios respecto de la base: commits + sin commitear
#   scripts/wt.sh commit <nombre> <msg>        commitea lo del trabajador en su rama (lo hace el orquestador)
#   scripts/wt.sh integrate <nombre> [-- cmd]  merge --no-ff en la rama actual, verificación opcional y limpieza
#   scripts/wt.sh rm <nombre> [--force]        elimina worktree y rama (rechaza si hay cambios sin --force)
#   scripts/wt.sh gc [--apply]                 poda y reporta worktrees integrados o huérfanos; --apply elimina los integrados
set -euo pipefail

die() {
  echo "wt: $*" >&2
  exit 1
}
note() { echo "wt: $*" >&2; }

# Checkout principal: primera entrada de `git worktree list` (funciona también desde un worktree o un submódulo).
main_root() {
  local line
  line=$(git worktree list --porcelain 2>/dev/null | head -n1) || true
  [[ $line == "worktree "* ]] || die "no estás dentro de un repositorio git"
  echo "${line#worktree }"
}

ROOT=$(main_root)
BASE_DIR="$(dirname "$ROOT")/$(basename "$ROOT").wt"
SETUP="$ROOT/.claude/wt-setup.sh"

check_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9._-]{0,47}$ ]] || die "nombre inválido '${1:-}' (minúsculas, dígitos, . _ -; máx 48)"
}

wt_path() { echo "$BASE_DIR/$1"; }

is_registered() { git -C "$ROOT" worktree list --porcelain | grep -Fxq "worktree $1"; }

require_wt() {
  check_name "$1"
  [[ -d "$(wt_path "$1")" ]] || die "no existe el worktree '$1' (crea con: scripts/wt.sh new $1)"
}

# Desde qué rama (o commit) salió la tarea, y en qué commit arrancó. Se guardan en la config de la rama,
# que git borra junto con ella.
base_ref() { git -C "$ROOT" config --get "branch.agente/$1.wtbase" || git -C "$ROOT" rev-parse HEAD; }
start_commit() { git -C "$ROOT" config --get "branch.agente/$1.wtstart" || true; }

record_base() {
  git -C "$ROOT" config "branch.agente/$1.wtbase" "$2"
  git -C "$ROOT" config "branch.agente/$1.wtstart" "$(git -C "$ROOT" rev-parse "$3")"
}

merge_base() {
  local dir
  dir=$(wt_path "$1")
  git -C "$dir" merge-base "$(base_ref "$1")" HEAD 2>/dev/null || git -C "$dir" rev-parse HEAD
}

run_setup() {
  local name=$1 dir
  dir=$(wt_path "$name")
  [[ -f "$SETUP" ]] || return 0
  [[ -x "$SETUP" ]] || {
    note ".claude/wt-setup.sh existe pero no es ejecutable (chmod +x); se omite"
    return 0
  }
  note "preparando el worktree con .claude/wt-setup.sh"
  (cd "$dir" && WT_MAIN="$ROOT" WT_PATH="$dir" WT_NAME="$name" "$SETUP") >&2 ||
    die "falló .claude/wt-setup.sh (el worktree quedó creado; corrige y reintenta con: scripts/wt.sh setup $name)"
}

cmd_new() {
  local name=${1:-} base=${2:-} dir branch
  check_name "$name"
  dir=$(wt_path "$name")
  branch="agente/$name"
  if [[ -d "$dir" ]]; then
    is_registered "$dir" || die "$dir existe pero no es un worktree registrado (bórralo, o corre scripts/wt.sh gc)"
    [[ -z "$base" ]] || note "la base '$base' se ignora: el worktree ya existe"
    note "reutilizando worktree existente ($branch)"
  else
    mkdir -p "$BASE_DIR"
    if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
      [[ -z "$base" ]] || note "la rama $branch ya existe; la base '$base' se ignora"
      git -C "$ROOT" worktree add "$dir" "$branch" >&2
    else
      local ref=${base:-HEAD} record
      record=${base:-$(git -C "$ROOT" symbolic-ref --short -q HEAD || git -C "$ROOT" rev-parse HEAD)}
      git -C "$ROOT" worktree add -b "$branch" "$dir" "$ref" >&2
      record_base "$name" "$record" "$ref"
    fi
    run_setup "$name"
  fi
  echo "$dir"
}

# Copia al worktree los archivos nuevos sin seguimiento y no ignorados. Los symlinks se recrean (no se
# sigue su destino) y los repos anidados se omiten.
copy_untracked() {
  local dir=$1 f
  git -C "$ROOT" ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
    if [[ -L "$ROOT/$f" ]]; then
      mkdir -p "$dir/$(dirname "$f")" || return 1
      ln -s "$(readlink "$ROOT/$f")" "$dir/$f" || return 1
    elif [[ -d "$ROOT/$f" ]]; then
      note "se omite $f (directorio o repo anidado)"
    else
      mkdir -p "$dir/$(dirname "$f")" || return 1
      cp -p "$ROOT/$f" "$dir/$f" || return 1
    fi
  done
}

cmd_snapshot() {
  local name=${1:-} dir
  check_name "$name"
  dir=$(wt_path "$name")
  [[ ! -e "$dir" ]] || die "ya existe '$name': usa otro nombre o elimínalo con scripts/wt.sh rm $name --force"
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/agente/$name"; then die "ya existe la rama agente/$name"; fi
  mkdir -p "$BASE_DIR"
  git -C "$ROOT" worktree add -b "agente/$name" "$dir" HEAD >&2
  record_base "$name" "$(git -C "$ROOT" rev-parse HEAD)" HEAD
  # Archivos con seguimiento (staged y no staged, incluidos binarios) y archivos nuevos no ignorados.
  # Si algo falla, se deshace el worktree para que se pueda reintentar con el mismo nombre.
  if ! { { git -C "$ROOT" diff --quiet HEAD || git -C "$ROOT" diff HEAD --binary | git -C "$dir" apply --binary --whitespace=nowarn; } &&
    copy_untracked "$dir"; }; then
    git -C "$ROOT" worktree remove --force "$dir" >/dev/null 2>&1 || true
    git -C "$ROOT" branch -D "agente/$name" >/dev/null 2>&1 || true
    die "no se pudo copiar tus cambios al snapshot; se deshizo '$name'"
  fi
  echo "$dir"
}

cmd_list() {
  git -C "$ROOT" worktree list | grep -F "$BASE_DIR/" || echo "(sin worktrees de agentes)"
}

cmd_diff() {
  local name=${1:-} dir mb
  require_wt "$name"
  dir=$(wt_path "$name")
  mb=$(merge_base "$name")
  echo "## $name  ($(git -C "$dir" branch --show-current), base: $(base_ref "$name") @ $(git -C "$dir" rev-parse --short "$mb"))"
  echo "### commits sobre la base"
  git -C "$dir" log --oneline "$mb..HEAD"
  echo "### cambios sin commitear"
  git -C "$dir" status --short
  if [[ "${2:-}" == "--full" ]]; then
    git -C "$dir" --no-pager diff "$mb"
    git -C "$dir" ls-files --others --exclude-standard -z |
      while IFS= read -r -d '' f; do git -C "$dir" --no-pager diff --no-index -- /dev/null "$f" || true; done
  else
    echo "### resumen respecto de la base"
    git -C "$dir" --no-pager diff --stat "$mb"
  fi
}

# ¿La ruta (relativa a la raíz del worktree) sale de él? Se normaliza como texto, sin mirar el disco:
# un destino que aún no existe o que sube con ".." también cuenta.
escapes_root() (
  set -f
  IFS=/
  depth=0
  for part in $1; do
    case $part in
      '' | .) ;;
      ..)
        depth=$((depth - 1))
        if ((depth < 0)); then exit 0; fi
        ;;
      *) depth=$((depth + 1)) ;;
    esac
  done
  exit 1
)

# Symlinks del índice (nuevos, modificados o renombrados) con destino absoluto o fuera del worktree.
outside_symlinks() {
  local dir=$1 mode sha path target rel
  git -C "$dir" ls-files -s -z | while IFS= read -r -d '' entry; do
    mode=${entry%% *}
    [[ $mode == 120000 ]] || continue
    sha=${entry#* }
    sha=${sha%% *}
    path=${entry#*$'\t'}
    target=$(git -C "$dir" cat-file -p "$sha")
    if [[ $path == */* ]]; then rel="${path%/*}/$target"; else rel=$target; fi
    if [[ $target == /* ]] || escapes_root "$rel"; then
      printf '\n  %s -> %s' "$path" "$target"
    fi
  done
}

cmd_commit() {
  local name=${1:-} msg=${2:-} dir bad
  require_wt "$name"
  [[ -n "$msg" ]] || die "falta el mensaje: scripts/wt.sh commit $name \"mensaje\""
  dir=$(wt_path "$name")
  [[ -n "$(git -C "$dir" status --porcelain)" ]] || die "no hay cambios que commitear en '$name'"
  git -C "$dir" add -A
  bad=$(outside_symlinks "$dir")
  if [[ -n "$bad" ]]; then
    git -C "$dir" reset -q
    die "no se commitea: hay symlinks que apuntan fuera del worktree (agrégalos a .git/info/exclude):$bad"
  fi
  # Configuración de agentes (permisos, hooks, MCP): un trabajador no debería poder cambiarla y que llegue
  # al checkout principal con el merge. WT_PERMITIR_CONFIG=1 lo permite tras revisarla.
  bad=$(git -C "$dir" diff --cached --name-only -- .claude .commandcode .codex)
  if [[ -n "$bad" && ${WT_PERMITIR_CONFIG:-} != 1 ]]; then
    git -C "$dir" reset -q
    die "no se commitea: hay cambios en configuración de agentes (revísalos y repite con WT_PERMITIR_CONFIG=1):
$bad"
  fi
  git -C "$dir" commit -m "$msg"
  echo "commit en agente/$name. Integra con: scripts/wt.sh integrate $name -- <comando de verificación>"
}

cmd_integrate() {
  local name=${1:-} dir branch current base
  require_wt "$name"
  shift
  if [[ ${1:-} == "--" ]]; then
    shift
  elif [[ $# -gt 0 ]]; then
    die "uso: scripts/wt.sh integrate $name [-- <comando de verificación>]"
  fi
  dir=$(wt_path "$name")
  branch="agente/$name"
  [[ -z "$(git -C "$dir" status --porcelain)" ]] || die "'$name' tiene cambios sin commitear: primero scripts/wt.sh commit $name \"mensaje\""
  if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
    die "el checkout principal tiene cambios sin commitear: commitéalos o guárdalos (git stash) antes de integrar"
  fi
  current=$(git -C "$ROOT" symbolic-ref --short -q HEAD) || die "el checkout principal está en detached HEAD"
  base=$(git -C "$ROOT" config --get "branch.$branch.wtbase" || true)
  if [[ -n $base && $base != "$current" ]] && git -C "$ROOT" show-ref --verify --quiet "refs/heads/$base"; then
    note "ojo: la tarea salió de '$base' y la integras en '$current'"
  fi
  if git -C "$ROOT" merge-base --is-ancestor "$branch" HEAD; then
    note "$branch ya está integrada en $current"
  else
    git -C "$ROOT" merge --no-ff -m "Integra $branch" "$branch" >&2 ||
      die "conflictos al integrar: resuélvelos y commitea, o aborta con git merge --abort"
  fi
  if [[ $# -gt 0 ]]; then
    note "verificando en el checkout principal: $*"
    (cd "$ROOT" && "$@") ||
      die "la verificación falló tras integrar. El merge quedó hecho: corrígelo, o deshazlo con git reset --hard ORIG_HEAD. El worktree se conserva."
  fi
  cmd_rm "$name"
}

cmd_rm() {
  local name=${1:-} force=${2:-} dir branch
  require_wt "$name"
  dir=$(wt_path "$name")
  branch="agente/$name"
  if [[ "$force" != "--force" ]]; then
    [[ -z "$(git -C "$dir" status --porcelain)" ]] || die "'$name' tiene cambios sin commitear; usa --force para descartarlos"
    git -C "$ROOT" worktree remove "$dir"
    git -C "$ROOT" branch -d "$branch" >/dev/null 2>&1 ||
      echo "rama $branch conservada: tiene commits sin integrar (bórrala con git branch -D si no los quieres)" >&2
  else
    git -C "$ROOT" worktree remove --force "$dir"
    git -C "$ROOT" branch -D "$branch" >/dev/null 2>&1 || true
  fi
  rmdir "$BASE_DIR" 2>/dev/null || true
  echo "eliminado: $name"
}

cmd_gc() {
  local apply=${1:-} dir name start tip any=0
  git -C "$ROOT" worktree prune
  for dir in "$BASE_DIR"/*/; do
    [[ -d $dir ]] || continue
    dir=${dir%/}
    name=$(basename "$dir")
    any=1
    if ! is_registered "$dir"; then
      echo "huérfano: $dir (no es un worktree registrado; bórralo a mano)"
      continue
    fi
    if [[ -n "$(git -C "$dir" status --porcelain)" ]]; then
      echo "activo: $name (cambios sin commitear)"
      continue
    fi
    start=$(start_commit "$name")
    tip=$(git -C "$dir" rev-parse HEAD)
    if [[ -z $start ]]; then
      echo "sin datos: $name (creado con una versión anterior de wt.sh; revísalo a mano)"
    elif [[ $tip == "$start" ]]; then
      echo "vacío: $name (sin commits; bórralo con scripts/wt.sh rm $name si ya no se usa)"
    elif git -C "$ROOT" merge-base --is-ancestor "$tip" "$(base_ref "$name")" 2>/dev/null; then
      if [[ $apply == "--apply" ]]; then cmd_rm "$name"; else echo "integrado: $name (gc --apply lo elimina)"; fi
    else
      echo "activo: $name (commits sin integrar)"
    fi
  done
  ((any)) || echo "(sin worktrees de agentes)"
}

case "${1:-}" in
  new) shift && cmd_new "$@" ;;
  snapshot) shift && cmd_snapshot "$@" ;;
  setup) require_wt "${2:-}" && run_setup "$2" ;;
  path) require_wt "${2:-}" && wt_path "$2" ;;
  list) cmd_list ;;
  diff) shift && cmd_diff "$@" ;;
  commit) shift && cmd_commit "$@" ;;
  integrate) shift && cmd_integrate "$@" ;;
  rm) shift && cmd_rm "$@" ;;
  gc) shift && cmd_gc "$@" ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
