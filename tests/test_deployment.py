import sqlite3

import pytest

from deploy.database_snapshot import snapshot


def test_snapshot_accepts_additive_migration_and_restores_failed_change(tmp_path):
    database = tmp_path / "school.sqlite3"
    backup = tmp_path / "backup"
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE users(id TEXT PRIMARY KEY, password TEXT)")
        db.execute("INSERT INTO users VALUES('teacher','existing-password-hash')")
        db.execute("CREATE TABLE lessons(id TEXT PRIMARY KEY, title TEXT)")
        db.execute("INSERT INTO lessons VALUES('lesson','Existing classroom')")
    snapshot("backup", database, backup)
    with sqlite3.connect(database) as db:
        db.execute("ALTER TABLE lessons ADD COLUMN new_feature TEXT")
        db.execute("CREATE TABLE future_feature(id TEXT)")
    snapshot("verify", database, backup)
    with sqlite3.connect(database) as db:
        db.execute("DELETE FROM lessons")
    with pytest.raises(RuntimeError, match="lessons"):
        snapshot("verify", database, backup)
    snapshot("restore", database, backup)
    snapshot("verify", database, backup)
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM users").fetchall() == [
            ("teacher", "existing-password-hash")
        ]
        assert db.execute("SELECT * FROM lessons").fetchall() == [
            ("lesson", "Existing classroom")
        ]
        assert (
            db.execute(
                "SELECT name FROM sqlite_master WHERE name='future_feature'"
            ).fetchall()
            == []
        )
    with pytest.raises(RuntimeError, match="already exists"):
        snapshot("backup", database, backup)


def test_missing_database_never_creates_empty_production_file(tmp_path):
    database = tmp_path / "missing.sqlite3"
    with pytest.raises(RuntimeError, match="missing"):
        snapshot("backup", database, tmp_path / "backup")
    assert not database.exists()
