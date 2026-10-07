#!/usr/bin/env bash
# Deploy Oukilé to the service folder of an unprivileged Proxmox CT running Docker. Idempotent.
#   deploy.sh              ship the committed source (HEAD) to src/ and rebuild
#   deploy.sh --ref REF    ship another commit, branch or tag
# Only committed code is shipped (git archive): local edits never reach the server.
# Where to is read from deploy.env next to this script, kept out of git (see deploy.env.example).
# The compose file and oukile.env live in that folder on the host, not here. data/ (SQLite,
# secret key, Apple sessions) is never touched.
# The CT is unprivileged: container uid 1000 is host uid 101000.
set -euo pipefail
HERE="$(dirname "${BASH_SOURCE[0]}")"
[ -f "$HERE/deploy.env" ] || { echo "missing $HERE/deploy.env (copy deploy.env.example)" >&2; exit 1; }
# shellcheck source=deploy.env.example
. "$HERE/deploy.env"
: "${HOST:?HOST missing from deploy.env}" "${CT:?CT missing from deploy.env}"
: "${SRC:?SRC missing from deploy.env}" "${DEST:?DEST missing from deploy.env}"
REF=HEAD
if [ "${1:-}" = "--ref" ]; then REF=${2:?usage: deploy.sh --ref REF}; fi
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
REV="$(git -C "$REPO" rev-parse --short "$REF")"

ssh "$HOST" "test -f $SRC/docker-compose.yml && test -f $SRC/oukile.env" \
  || { echo "missing $SRC/docker-compose.yml or oukile.env on the host" >&2; exit 1; }
ssh "$HOST" "mkdir -p $SRC/data && chown 101000:101000 $SRC/data && chmod 700 $SRC/data"

# Unpacked next to the old tree, then swapped: a failed transfer leaves src/ intact.
git -C "$REPO" archive --format=tar "$REF" \
  | ssh "$HOST" "rm -rf $SRC/src.new && mkdir $SRC/src.new && tar -xf - -C $SRC/src.new --no-same-owner \
      && echo $REV > $SRC/src.new/REVISION && rm -rf $SRC/src && mv $SRC/src.new $SRC/src"
echo "source $REV shipped"

# Old images are pruned: the CT root disk is small.
ssh "$HOST" "pct exec $CT -- sh -c 'cd $DEST && docker compose up -d --build 2>&1 | tail -6 \
  && docker image prune -f >/dev/null && docker compose ps --format \"{{.Name}} {{.Status}}\"'"
