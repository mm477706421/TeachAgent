"""Bounded-memory offline ASR with atomic per-minute checkpoints."""

import hashlib
import json
import wave
from pathlib import Path

import numpy as np

CHUNK_SECONDS = 60


def fingerprint(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def transcribe_chunks(model, audio, model_signature, progress):
    audio = Path(audio)
    checkpoint = audio.with_name("asr-checkpoint.json")
    identity = {
        "version": 1,
        "audio": fingerprint(audio),
        "model": model_signature,
        "chunk_seconds": CHUNK_SECONDS,
    }
    completed = 0
    segments = []
    with wave.open(str(audio), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (
            1,
            2,
            16000,
        ):
            raise ValueError("本地转写需要 16 kHz 单声道 PCM16 音轨，请重新提取音频。")
        total = source.getnframes()
        chunk_frames = CHUNK_SECONDS * 16000
        count = (total + chunk_frames - 1) // chunk_frames
        if checkpoint.is_file():
            try:
                saved = json.loads(checkpoint.read_text(encoding="utf-8"))
                if (
                    saved.get("identity") == identity
                    and 0 <= saved["completed"] <= count
                ):
                    completed = saved["completed"]
                    segments = saved["segments"]
            except (OSError, ValueError, TypeError, KeyError):
                pass
        progress(completed, count)
        for index in range(completed, count):
            start_frame = index * chunk_frames
            source.setpos(start_frame)
            pcm = source.readframes(chunk_frames)
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
            offset = start_frame / 16000
            end = min(total, start_frame + len(samples)) / 16000
            stream, _ = model.transcribe(
                samples, language="zh", beam_size=5, vad_filter=True
            )
            for item in stream:
                begin = max(offset, min(end, offset + item.start))
                finish = max(begin, min(end, offset + item.end))
                segments.append(
                    {
                        "start": round(begin, 2),
                        "end": round(finish, 2),
                        "text": item.text,
                        "timing": "asr",
                    }
                )
            # Commit only a fully consumed chunk, including silence. An interrupted
            # chunk is replayed without duplicating previously committed segments.
            temporary = checkpoint.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(
                    {
                        "identity": identity,
                        "completed": index + 1,
                        "segments": segments,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            temporary.replace(checkpoint)
            del stream, samples, pcm
            progress(index + 1, count)
    return segments
