"""Offline Simplified Chinese normalization shared by speech recognition providers."""

from opencc import OpenCC

_converter = OpenCC("t2s")


def simplify_segments(segments):
    return [
        {**segment, "text": _converter.convert(segment["text"])} for segment in segments
    ]
