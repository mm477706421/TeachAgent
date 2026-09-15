import pytest
from backend.analysis import analyze, clean_text, parse_transcript


def test_srt_timing_and_evidence_references():
    segments = parse_transcript(
        "1\n00:00:02,500 --> 00:00:08,000\n教师：为什么？\n\n2\n00:00:10,000 --> 00:00:15,000\n教师：请小组讨论。"
    )
    result = analyze(segments)
    assert result["duration"] == 15
    assert result["segments"][0]["start"] == 2.5
    assert result["metrics"]["questions"] == 1
    assert result["metrics"]["interactions"] == 1
    assert abs(sum(s["percent"] for s in result["distribution"]) - 100) < 0.2
    ids = {s["id"] for s in result["segments"]}
    assert all(s["segment_id"] in ids for s in result["suggestions"])


def test_unlabeled_speech_is_not_assigned_to_teacher():
    result = analyze(parse_transcript("大家好，今天我们学习。学生：我的答案是二。"))
    assert result["segments"][0]["speaker"] == "unknown"
    assert "teacher_ratio" not in result["metrics"]
    assert result["segments"][0]["timing"] == "estimated"


def test_cleaning_and_empty_transcript():
    assert clean_text(" \ufeff<b>今天</b>   我们\n学习 ") == "今天 我们 学习"
    with pytest.raises(ValueError):
        analyze([])


def test_vtt_and_bad_timestamp():
    segments = parse_transcript(
        "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n今天我们学习。"
    )
    assert len(segments) == 1
    assert segments[0]["timing"] == "provided"
    assert segments[0]["end"] == 4
    short = parse_transcript("WEBVTT\n\n00:01.000 --> 00:04.000\n今天我们学习。")
    assert short[0]["end"] == 4
    assert short[0]["timing"] == "provided"
