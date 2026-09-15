import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
DATA = Path(os.environ.get("TEACHAGENT_DATA", str(ROOT / ".data"))).resolve()
MODEL = Path(
    os.environ.get("ASR_MODEL_PATH", str(ROOT / "models" / "whisper-small"))
).resolve()
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "2048")) * 1024 * 1024
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH", "ffprobe")
ASR_DEVICE = os.environ.get("ASR_DEVICE", "cpu")
ASR_COMPUTE = os.environ.get("ASR_COMPUTE", "int8")


def model_ready():
    # faster-whisper otherwise falls back to a network tokenizer lookup.
    return all(
        (MODEL / name).is_file()
        for name in ("model.bin", "config.json", "tokenizer.json")
    ) and any(
        (MODEL / name).is_file() for name in ("vocabulary.txt", "vocabulary.json")
    )


# Model loading may never download weights at runtime.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
