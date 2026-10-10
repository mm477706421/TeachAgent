"""Upload a tested artifact and deploy through fingerprint-pinned SSH."""

import base64
import hashlib
import io
import os
import re
import sys
import time
from pathlib import Path

import paramiko


class PinnedHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        fingerprint = "SHA256:" + base64.b64encode(
            hashlib.sha256(key.asbytes()).digest()
        ).decode().rstrip("=")
        if fingerprint != os.environ["DEPLOY_HOST_FINGERPRINT"]:
            raise paramiko.SSHException("Server host fingerprint mismatch")


def deploy():
    revision = os.environ["GITHUB_SHA"]
    deployment_id = os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or not re.fullmatch(
        r"\d+-\d+", deployment_id
    ):
        raise ValueError("Invalid deployment identity")
    archive = Path("server-artifact/teachagent-server.tar.gz")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHost())
    key = paramiko.Ed25519Key.from_private_key(
        io.StringIO(os.environ["DEPLOY_PRIVATE_KEY"])
    )
    try:
        client.connect(
            os.environ["DEPLOY_HOST"],
            username=os.environ["DEPLOY_USER"],
            pkey=key,
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
            look_for_keys=False,
            allow_agent=False,
        )
        client.get_transport().set_keepalive(20)
        with client.open_sftp() as sftp:
            folder = "/home/ubuntu/teachagent-incoming"
            try:
                sftp.stat(folder)
            except FileNotFoundError:
                sftp.mkdir(folder, mode=0o700)
            remote = f"{folder}/{revision}-{deployment_id}.tar.gz"
            sftp.put(str(archive), remote)
            sftp.chmod(remote, 0o600)
        command = f"bash -s -- {revision} {digest} {deployment_id}"
        channel = client.get_transport().open_session()
        channel.set_combine_stderr(True)
        channel.exec_command(command)
        channel.sendall(
            Path("deploy/production.sh").read_bytes().replace(b"\r\n", b"\n")
        )
        channel.shutdown_write()
        deadline = time.monotonic() + 1500
        while not channel.exit_status_ready() or channel.recv_ready():
            if channel.recv_ready():
                sys.stdout.buffer.write(channel.recv(65536))
                sys.stdout.buffer.flush()
            else:
                if time.monotonic() > deadline:
                    raise TimeoutError(
                        "Remote deployment timed out; inspect server deployment state before retrying"
                    )
                time.sleep(0.2)
        result = channel.recv_exit_status()
        if result:
            raise RuntimeError(f"Remote deployment failed with exit status {result}")
    finally:
        client.close()


if __name__ == "__main__":
    deploy()
