import json
import logging
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from . import config
from .analysis import analyze
from .db import connect

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="local-asr")
pending = set()
lock = threading.Lock()
_model = None


def lesson_dir(user_id, lesson_id):
    return config.DATA / "users" / user_id / lesson_id


def update(lesson_id, **fields):
    with connect() as db:
        db.execute(
            "UPDATE lessons SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=?",
            [*fields.values(), lesson_id],
        )


def run_command(args, timeout=900):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if result.returncode:
        raise ValueError(
            "媒体处理失败，请检查视频是否损坏、是否有音轨，以及 FFmpeg 是否完整安装。"
        )
    return result.stdout


def probe_media(video):
    try:
        return json.loads(
            run_command(
                [
                    config.FFPROBE,
                    "-v",
                    "error",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                    str(video),
                ],
                60,
            )
        )
    except FileNotFoundError:
        # PyAV ships with faster-whisper and reads the same local media without a subprocess.
        import av

        try:
            with av.open(str(video)) as container:
                duration = (container.duration or 0) / av.time_base
                if duration <= 0:
                    duration = max(
                        (
                            float(s.duration * s.time_base)
                            for s in container.streams
                            if s.duration is not None and s.time_base is not None
                        ),
                        default=0,
                    )
                if duration <= 0:
                    raise ValueError("无法读取媒体时长，请先将视频转为常见 MP4 格式。")
                return {
                    "format": {"duration": duration},
                    "streams": [{"codec_type": s.type} for s in container.streams],
                }
        except av.error.FFmpegError as exc:
            raise ValueError(
                "媒体处理失败，请检查视频是否损坏或格式是否受支持。"
            ) from exc


def process(lesson_id):
    global _model
    try:
        with connect() as db:
            lesson = db.execute(
                "SELECT * FROM lessons WHERE id=?", (lesson_id,)
            ).fetchone()
        if not lesson:
            return
        folder = lesson_dir(lesson["user_id"], lesson_id)
        video = folder / "source.video"
        update(
            lesson_id,
            status="processing",
            progress=10,
            stage="正在检查视频与抽帧",
            error=None,
        )
        probe = probe_media(video)
        if not any(s["codec_type"] == "audio" for s in probe["streams"]):
            raise ValueError("视频没有音轨，无法语音转写。可改用本地转写文本导入。")
        duration = float(probe["format"]["duration"])
        if duration > 6 * 3600:
            raise ValueError("单节视频最长支持 6 小时，请先按课时切分。")
        frames = folder / "frames"
        frames.mkdir(exist_ok=True)
        run_command(
            [
                config.FFMPEG,
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(video),
                "-vf",
                f"fps=1/{max(30, duration / 60)},scale=640:-2",
                "-frames:v",
                "60",
                str(frames / "%03d.jpg"),
            ]
        )
        update(lesson_id, progress=25, stage="正在提取本地音轨", duration=duration)
        audio = folder / "audio.wav"
        run_command(
            [
                config.FFMPEG,
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(video),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                str(audio),
            ]
        )
        if not config.model_ready():
            raise ValueError(
                "未找到本地 Whisper 模型。请将完整 faster-whisper 模型放入 ASR_MODEL_PATH 后重试；系统不会在线下载。"
            )
        update(lesson_id, progress=35, stage="Whisper 正在本地转写")
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(
                str(config.MODEL),
                device=config.ASR_DEVICE,
                compute_type=config.ASR_COMPUTE,
                local_files_only=True,
            )
        stream, _ = _model.transcribe(
            str(audio), language="zh", beam_size=5, vad_filter=True
        )
        segments = []
        for s in stream:
            segments.append(
                {
                    "start": round(s.start, 2),
                    "end": round(s.end, 2),
                    "text": s.text,
                    "timing": "asr",
                }
            )
            update(lesson_id, progress=min(85, 35 + int(s.end / max(duration, 1) * 50)))
        update(lesson_id, progress=90, stage="正在蒸馏话语与生成教学画像")
        result = analyze(segments, duration)
        (folder / "analysis.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        update(
            lesson_id,
            status="completed",
            progress=100,
            stage="分析完成",
            analysis=json.dumps(result, ensure_ascii=False),
        )
    except FileNotFoundError:
        update(
            lesson_id,
            status="failed",
            error="未找到 FFmpeg / ffprobe，请安装并配置可执行文件路径后重试。",
            stage="环境需要配置",
        )
    except Exception as exc:
        logger.exception("Local pipeline failed for %s", lesson_id)
        detail = (
            str(exc)
            if isinstance(exc, ValueError)
            else "本地处理失败，请查看服务器日志并检查模型、资源及媒体格式后重试。"
        )
        update(lesson_id, status="failed", error=detail, stage="处理未完成")
    finally:
        with lock:
            pending.discard(lesson_id)


def submit(lesson_id):
    with lock:
        if lesson_id in pending:
            return
        pending.add(lesson_id)
    executor.submit(process, lesson_id)
