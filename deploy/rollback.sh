#!/usr/bin/env bash
set -euo pipefail
# Usage: rollback.sh /opt/teachagent/releases/PREVIOUS_REVISION
# --fixture tests the same switch against an isolated copy, without systemd.
target="$(realpath "${1:?Previous release directory is required}")"
install_root="$(realpath "${TEACHAGENT_INSTALL_ROOT:-/opt/teachagent}")"
data_dir="${TEACHAGENT_DATA:-/var/lib/teachagent}"
python_bin="${TEACHAGENT_PYTHON:-/opt/teachagent/venv/bin/python}"
case "$target" in "$install_root"/releases/*) ;; *) echo 'Invalid rollback target' >&2; exit 2;; esac
test -f "$target/backend/main.py"
fixture=false
if [ "${2:-}" = '--fixture' ]; then fixture=true; fi
if ! $fixture; then sudo -n systemctl stop teachagent.service; fi
# Older clients send all settings fields back. Remove only the new active-field
# metadata; preserve endpoints, keys, accounts, lessons and saved profiles.
"$python_bin" - "$data_dir" "$install_root" "$target" <<'PY'
import json, os, pathlib, sqlite3, sys
data, root, target = map(pathlib.Path, sys.argv[1:])
dbfile = data / 'teachagent.sqlite3'
if dbfile.exists():
    with sqlite3.connect(dbfile) as db:
        for uid, settings in db.execute('SELECT user_id,settings FROM model_settings').fetchall():
            value = json.loads(settings)
            if 'preset_id' in value:
                value.pop('preset_id')
                db.execute('UPDATE model_settings SET settings=? WHERE user_id=?', (json.dumps(value), uid))
temporary = root / 'rollback-current'
if temporary.is_symlink(): temporary.unlink()
temporary.symlink_to(target, target_is_directory=True)
os.replace(temporary, root / 'current')
PY
if ! $fixture; then
  sudo -n systemctl start teachagent.service
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then echo 'ROLLBACK healthy'; exit 0; fi
    sleep 1
  done
  exit 1
fi
echo 'ROLLBACK fixture switched'
