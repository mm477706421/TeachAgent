import json
import wave
from types import SimpleNamespace

import numpy as np
import pytest

from backend.local_asr import transcribe_chunks


def audio_file(tmp_path, seconds=125):
    path = tmp_path / "audio.wav"
    with wave.open(str(path), "wb") as f:
        f.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        for _ in range(seconds):
            f.writeframes(np.zeros(16000, dtype="<i2").tobytes())
    return path


class Model:
    def __init__(self, fail=None):
        self.lengths = []
        self.fail = fail

    def transcribe(self, samples, **kwargs):
        assert samples.dtype == np.float32
        assert len(samples) <= 60 * 16000
        self.lengths.append(len(samples))

        def segments():
            yield SimpleNamespace(start=1, end=2, text="测试语音")
            if self.fail == len(self.lengths):
                raise RuntimeError("simulated interruption within chunk")

        return segments(), None


def test_bounded_chunks_global_timestamps_and_resume(tmp_path):
    audio = audio_file(tmp_path)
    broken = Model(fail=2)
    with pytest.raises(RuntimeError):
        transcribe_chunks(broken, audio, {"model": "small"}, lambda *_: None)
    saved = json.loads((tmp_path / "asr-checkpoint.json").read_text(encoding="utf8"))
    assert saved["completed"] == 1
    assert len(saved["segments"]) == 1
    model = Model()
    progress = []
    result = transcribe_chunks(
        model, audio, {"model": "small"}, lambda *args: progress.append(args)
    )
    assert model.lengths == [60 * 16000, 5 * 16000]
    assert [s["start"] for s in result] == [1, 61, 121]
    assert progress == [(1, 3), (2, 3), (3, 3)]
    assert (
        transcribe_chunks(Model(fail=1), audio, {"model": "small"}, lambda *_: None)
        == result
    )


def test_changed_audio_or_model_discards_checkpoint(tmp_path):
    audio = audio_file(tmp_path, 2)
    transcribe_chunks(Model(), audio, "old-model", lambda *_: None)
    new = Model()
    transcribe_chunks(new, audio, "new-model", lambda *_: None)
    assert len(new.lengths) == 1
    with wave.open(str(audio), "wb") as f:
        f.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        f.writeframes(np.ones(16000, dtype="<i2").tobytes())
    changed = Model()
    transcribe_chunks(changed, audio, "new-model", lambda *_: None)
    assert changed.lengths == [16000]


def test_silent_chunks_checkpoint_and_invalid_pcm(tmp_path):
    class Silent:
        def transcribe(self, samples, **kwargs):
            return iter([]), None

    audio = audio_file(tmp_path, 2)
    progress = []
    assert (
        transcribe_chunks(Silent(), audio, "model", lambda *x: progress.append(x)) == []
    )
    assert progress[-1] == (1, 1)
    with wave.open(str(audio), "wb") as f:
        f.setparams((2, 2, 16000, 0, "NONE", "not compressed"))
        f.writeframes(b"\x00" * 64000)
    with pytest.raises(ValueError, match="PCM16"):
        transcribe_chunks(Silent(), audio, "model", lambda *_: None)
