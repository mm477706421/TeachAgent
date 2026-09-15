import argparse
import os
import re
import secrets
import time
import uuid
from .db import connect, init_db, password_hash


def main():
    parser = argparse.ArgumentParser(
        description="TeachAgent local account administration"
    )
    parser.add_argument("action", choices=["create-admin", "reset-password"])
    parser.add_argument("--username", default="admin")
    parser.add_argument("--name", default="教研管理员")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", args.username):
        parser.error("Username must be 3–64 characters: letters, digits, _.-")
    init_db()
    password = os.environ.get("TEACHAGENT_ADMIN_PASSWORD")
    generated = not password
    if not password:
        password = secrets.token_urlsafe(15)
    if len(password) < 10:
        parser.error("Password must be at least 10 characters")
    with connect() as db:
        existing = db.execute(
            "SELECT id FROM users WHERE username=?", (args.username,)
        ).fetchone()
        if args.action == "create-admin":
            if existing:
                parser.error(
                    "Account exists. Use reset-password explicitly to reset it."
                )
            db.execute(
                "INSERT INTO users VALUES(?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex,
                    args.username,
                    args.name,
                    password_hash(password),
                    "admin",
                    time.time(),
                ),
            )
        else:
            if not existing:
                parser.error("Account not found")
            db.execute(
                "UPDATE users SET password=? WHERE id=?",
                (password_hash(password), existing["id"]),
            )
            db.execute("DELETE FROM sessions WHERE user_id=?", (existing["id"],))
    print(f"Account ready: {args.username}")
    if generated:
        print(f"Generated password (save locally): {password}")


if __name__ == "__main__":
    main()
