#!/usr/bin/env bash
# Executed by GitHub Actions over authenticated, host-pinned SSH as ubuntu.
set -Eeuo pipefail
umask 022
revision="${1:?Commit SHA required}"
archive_hash="${2:?Archive SHA256 required}"
deployment_id="${3:?Run and attempt required}"
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$archive_hash" =~ ^[a-f0-9]{64}$ && "$deployment_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
root=/opt/teachagent
database=/var/lib/teachagent/teachagent.sqlite3
maintenance="$root/deploy-maintenance"
archive="/home/ubuntu/teachagent-incoming/$revision-$deployment_id.tar.gz"
release="$root/releases/$revision-$deployment_id"
backup="$root/backups/$revision-$deployment_id"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment holds the server lock'; exit 1; }
test ! -e "$maintenance" || { echo 'Maintenance is already active; investigate before retrying'; exit 1; }
previous="$(readlink -f "$root/current")"
test -x "$previous/.venv/bin/python"
test ! -e "$release"
printf '%s  %s\n' "$archive_hash" "$archive" | sha256sum -c -
mkdir -p "$release"
tar -xzf "$archive" -C "$release" --no-same-owner
test -f "$release/frontend/dist/index.html"
test -f "$release/backend/main.py"
printf '%s\n' "$revision" > "$release/DEPLOYED_REVISION"
dependency_hash="$(sha256sum "$release/requirements.txt" | cut -d ' ' -f1)"
environment="$root/environments/$dependency_hash"
if [ ! -f "$environment/.ready" ]; then
  staging_env="$environment-$deployment_id"
  echo 'Preparing an isolated dependency environment'
  /usr/bin/python3 -m venv "$staging_env"
  "$staging_env/bin/python" -m pip install -r "$release/requirements.txt" > "$release/dependency-install.log" 2>&1
  "$staging_env/bin/python" -m pip check
  touch "$staging_env/.ready"
  # Keep the venv at its original path: pip scripts contain absolute shebangs.
  ln -s "$staging_env" "$environment"
fi
ln -s "$environment" "$release/.venv"
ln -s "$(readlink -f "$previous/models")" "$release/models"
"$release/.venv/bin/python" -m pip check
fixture="$(mktemp -d)"
cd "$release"
TEACHAGENT_DATA="$fixture" "$release/.venv/bin/python" - <<'PY'
from backend.db import init_db
from backend.main import app
init_db()
assert app.version
print('Candidate imports and fresh database initialization passed')
PY

switched=0
stopped=0
success=0
healthy() {
  local port="$1" expected="${2:-}"
  "$release/.venv/bin/python" - "$port" "$expected" <<'PY'
import json,sys,urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:'+sys.argv[1]+'/api/health', timeout=3) as r:
        value=json.load(r)
    assert value['status']=='ok'
    if sys.argv[2]: assert value['revision']==sys.argv[2]
except Exception:
    raise SystemExit(1)
PY
}
finish() {
  result=$?
  trap - EXIT INT TERM
  if [ "$success" = 1 ]; then return; fi
  if [ "$result" = 0 ]; then result=1; fi
  echo 'Deployment did not complete; recovering the previous release'
  if [ "$switched" = 1 ]; then
    sudo -n systemctl stop teachagent.service || true
    sudo -n -u teachagent "$previous/.venv/bin/python" "$release/deploy/database_snapshot.py" restore "$database" "$backup" || { echo 'Database rollback failed; maintenance retained'; exit 1; }
    ln -sfn "$previous" "$root/rollback-current"
    mv -Tf "$root/rollback-current" "$root/current"
  fi
  if [ "$stopped" = 1 ]; then
    sudo -n systemctl restart teachagent.service || { echo 'Service rollback failed; maintenance retained'; exit 1; }
  fi
  recovered=0
  for attempt in $(seq 1 30); do
    if healthy 18080; then recovered=1; break; fi
    sleep 1
  done
  if [ "$recovered" = 1 ]; then
    rm -f "$maintenance"
    echo 'Previous service is healthy; maintenance removed'
  else
    echo 'Previous service is unhealthy; maintenance retained for administrator recovery'
  fi
  exit "${result:-1}"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Nginx rejects new requests while previously admitted uploads and streams drain.
touch "$maintenance"
echo 'Maintenance enabled; waiting for existing requests and classroom jobs'
drained=0
for attempt in $(seq 1 120); do
  if [ -z "$(ss -Htn state established '( sport = :8080 )')" ] && \
     sudo -n -u teachagent "$previous/.venv/bin/python" - "$database" <<'PY'
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
    busy=db.execute("SELECT COUNT(*) FROM lessons WHERE status IN ('uploading','queued','processing')").fetchone()[0]
    busy+=db.execute("SELECT COUNT(*) FROM chat_turns WHERE status IN ('running','stopping')").fetchone()[0]
raise SystemExit(1 if busy else 0)
PY
  then drained=1; break; fi
  if (( attempt % 6 == 0 )); then echo 'Still draining; live work will not be interrupted'; fi
  sleep 5
done
[ "$drained" = 1 ] || { echo 'Drain timeout; deployment aborted without stopping live work'; exit 1; }
sudo -n install -d -o teachagent -g teachagent -m 0700 "$backup"
sudo -n cp -p /etc/teachagent.env "$backup/before.env"
stopped=1
sudo -n systemctl stop teachagent.service
sudo -n -u teachagent "$previous/.venv/bin/python" "$release/deploy/database_snapshot.py" backup "$database" "$backup"
ln -s "$release" "$root/next-current"
switched=1
mv -Tf "$root/next-current" "$root/current"
sudo -n systemctl start teachagent.service
ready=0
for attempt in $(seq 1 45); do
  if healthy 18080 "$revision"; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo 'Candidate health or revision check failed'; exit 1; }
sudo -n -u teachagent "$release/.venv/bin/python" "$release/deploy/database_snapshot.py" verify "$database" "$backup"
healthy 8080 "$revision"
rm -f "$maintenance"
# New writes can now occur. Do not restore the old database after reopening traffic.
success=1
sudo -n systemctl is-active teachagent.service nginx
echo "DEPLOYED_REVISION=$revision"
echo 'Deployment verified at http://43.165.169.59:8080/'
