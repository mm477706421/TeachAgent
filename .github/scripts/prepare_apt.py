"""Prepare Ubuntu package downloads on ephemeral GitHub Actions runners."""
from pathlib import Path
import re

# Some EC2 runner mirrors deliver packages extremely slowly. Keep Ubuntu's
# signed repositories but use its main HTTPS archive on those runners.
apt = Path("/etc/apt")
paths = [apt / "sources.list", *apt.glob("sources.list.d/*.list"), *apt.glob("sources.list.d/*.sources")]
for path in paths:
    if not path.is_file():
        continue
    content = path.read_text()
    updated = re.sub(
        r"https?://[a-z0-9.-]+\.ec2\.archive\.ubuntu\.com/ubuntu/?",
        "https://archive.ubuntu.com/ubuntu/",
        content,
    )
    if updated != content:
        path.write_text(updated)
        print(f"Updated Ubuntu archive in {path.name}")

(apt / "apt.conf.d/80teachagent-ci").write_text(
    'Acquire::Retries "3";\n'
    'Acquire::http::Timeout "30";\n'
    'Acquire::https::Timeout "30";\n'
)
