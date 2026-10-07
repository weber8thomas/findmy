#!/usr/bin/env bash
# Deploy Oukilé to /mnt/pve/services/oukile (mp0 of CT 100). Idempotent.
#   deploy.sh              ship the committed source (HEAD) to src/ and rebuild
#   deploy.sh --ref REF    ship another commit, branch or tag
# Only committed code is shipped (git archive): local edits never reach the server.
# The compose file, oukile.env and the backup script live in the services
# repository (oukile/), not here. data/ (SQLite, secret key, Apple sessions) is never touched.
# CT 100 is unprivileged: container uid 1000 is host uid 101000.
set -euo pipefail
CT=${CT:-100}
SRC=/mnt/pve/services/oukile
DEST=/mnt/services/oukile
REF=HEAD
if [ "${1:-}" = "--ref" ]; then REF=${2:?usage: deploy.sh --ref REF}; fi
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
REV="$(git -C "$REPO" rev-parse --short "$REF")"

ssh proxmox "test -f $SRC/docker-compose.yml && test -f $SRC/oukile.env" \
  || { echo "missing $SRC/docker-compose.yml or oukile.env on the host" >&2; exit 1; }
ssh proxmox "mkdir -p $SRC/data && chown 101000:101000 $SRC/data && chmod 700 $SRC/data"

# Unpacked next to the old tree, then swapped: a failed transfer leaves src/ intact.
git -C "$REPO" archive --format=tar "$REF" \
  | ssh proxmox "rm -rf $SRC/src.new && mkdir $SRC/src.new && tar -xf - -C $SRC/src.new --no-same-owner \
      && echo $REV > $SRC/src.new/REVISION && rm -rf $SRC/src && mv $SRC/src.new $SRC/src"
echo "source $REV shipped"

# Old images are pruned: the CT root disk is small.
ssh proxmox "pct exec $CT -- sh -c 'cd $DEST && docker compose up -d --build 2>&1 | tail -6 \
  && docker image prune -f >/dev/null && docker compose ps --format \"{{.Name}} {{.Status}}\"'"
