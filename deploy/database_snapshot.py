"""Back up, verify and restore the stopped service's SQLite database."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

TABLES = (
    "users",
    "lessons",
    "messages",
    "chat_turns",
    "model_settings",
    "model_profiles",
    "library_videos",
)


def digest(rows):
    return hashlib.sha256(json.dumps(rows, ensure_ascii=True).encode()).hexdigest()


def snapshot(mode, database, folder):
    database, folder = Path(database), Path(folder)
    if not database.is_file():
        raise RuntimeError("Production database is missing; deployment stopped")
    if mode == "backup":
        folder.mkdir(parents=True, exist_ok=True)
        if (folder / "before.sqlite3").exists():
            raise RuntimeError("Backup already exists; refusing to replace it")
        with sqlite3.connect(database) as source:
            with sqlite3.connect(folder / "before.sqlite3") as target:
                source.backup(target)
            state = {}
            for table in TABLES:
                columns = [
                    row[1] for row in source.execute(f'PRAGMA table_info("{table}")')
                ]
                if columns:
                    rows = source.execute(
                        f'SELECT * FROM "{table}" ORDER BY 1'
                    ).fetchall()
                    state[table] = {
                        "columns": columns,
                        "count": len(rows),
                        "digest": digest(rows),
                    }
        (folder / "before.json").write_text(json.dumps(state), encoding="utf-8")
    elif mode == "verify":
        state = json.loads((folder / "before.json").read_text(encoding="utf-8"))
        with sqlite3.connect(database) as db:
            assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            for table, expected in state.items():
                columns = ",".join(
                    '"' + name.replace('"', '""') + '"' for name in expected["columns"]
                )
                rows = db.execute(
                    f'SELECT {columns} FROM "{table}" ORDER BY 1'
                ).fetchall()
                if digest(rows) != expected["digest"]:
                    raise RuntimeError(f"Existing data changed unexpectedly in {table}")
    elif mode == "restore":
        backup = folder / "before.sqlite3"
        if not backup.is_file():
            raise RuntimeError("Rollback snapshot is missing")
        with (
            sqlite3.connect(f"{backup.as_uri()}?mode=ro", uri=True) as source,
            sqlite3.connect(database) as target,
        ):
            source.backup(target)
    else:
        raise ValueError("Unknown snapshot operation")
    print(f"Database {mode}: successful")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["backup", "verify", "restore"])
    parser.add_argument("database")
    parser.add_argument("folder")
    args = parser.parse_args()
    snapshot(args.mode, args.database, args.folder)
