import contextlib
import hashlib
import hmac
import secrets
import sqlite3
import time
from . import config


@contextlib.contextmanager
def connect():
    config.DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(config.DATA / "teachagent.sqlite3", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','teacher')),
          created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          title TEXT NOT NULL, subject TEXT NOT NULL, class_name TEXT NOT NULL,
          filename TEXT, status TEXT NOT NULL, progress INTEGER DEFAULT 0,
          stage TEXT DEFAULT '', error TEXT, duration REAL DEFAULT 0,
          example INTEGER DEFAULT 0, created REAL NOT NULL, analysis TEXT);
        CREATE INDEX IF NOT EXISTS lessons_owner ON lessons(user_id, created);
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, engine TEXT, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (
          identity TEXT PRIMARY KEY, count INTEGER NOT NULL, since REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS model_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          settings TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', updated REAL NOT NULL);
        """)


def password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 600000
    ).hex()
    return f"{salt}${digest}"


def password_valid(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 600000
    ).hex()
    return hmac.compare_digest(candidate, digest)


def audit(actor, action, target):
    with connect() as db:
        db.execute(
            "INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)",
            (actor, action, target, time.time()),
        )
