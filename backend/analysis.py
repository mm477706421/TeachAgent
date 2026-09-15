"""Auditable text heuristics. No model scores or unverified speaker inference."""

import re
from collections import Counter

STAGES = [
    ("课堂导入", ("上节课", "今天我们", "同学们好", "回顾", "导入")),
    ("探究互动", ("讨论", "小组", "谁来", "你认为", "为什么", "想一想", "试一试")),
    ("练习巩固", ("练习", "完成", "做一做", "作业", "计算", "独立")),
    ("总结回顾", ("总结", "这节课", "下课", "收获", "归纳")),
]
FILLERS = ["那么", "然后", "就是说", "对不对", "是不是", "嗯", "那个"]


def clean_text(text):
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_transcript(text):
    # SRT/VTT retain timestamps; plain text uses explicitly estimated timing.
    stamp = re.compile(
        r"((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})[^\n]*\n(.*?)(?=\n\s*\n|\Z)",
        re.S,
    )

    def seconds(value):
        parts = value.replace(",", ".").split(":")
        h, m, s = parts if len(parts) == 3 else ["0", *parts]
        return int(h) * 3600 + int(m) * 60 + float(s)

    segments = []
    for match in stamp.finditer(text):
        start, end = seconds(match[1]), seconds(match[2])
        content = clean_text(match[3])
        if content and end > start:
            segments.append(
                {"start": start, "end": end, "text": content, "timing": "provided"}
            )
    if not segments:
        cursor = 0.0
        for line in re.split(r"\n+|(?<=[。！？!?])", text):
            line = clean_text(line)
            if not line or line == "WEBVTT":
                continue
            duration = max(3, len(line) / 3.5)
            segments.append(
                {
                    "start": round(cursor, 2),
                    "end": round(cursor + duration, 2),
                    "text": line,
                    "timing": "estimated",
                }
            )
            cursor += duration
    return sorted(segments, key=lambda s: s["start"])


def analyze(segments, duration=0):
    segments = [
        dict(s, text=clean_text(s["text"])) for s in segments if clean_text(s["text"])
    ]
    if not segments:
        raise ValueError("未检测到有效话语，请检查音轨或导入转写文本。")
    duration = max(duration, max(s["end"] for s in segments), 1)
    totals = Counter()
    timeline, questions, interactions = [], [], []
    all_text = "".join(s["text"] for s in segments)
    for i, s in enumerate(segments):
        text = s["text"]
        s["id"] = i + 1
        s["speaker"] = (
            "student"
            if re.match(r"^(学生|生)[：:]", text)
            else "teacher"
            if re.match(r"^(教师|老师|师)[：:]", text)
            else "unknown"
        )
        stage = next(
            (name for name, words in STAGES if any(w in text for w in words)),
            "知识讲授",
        )
        s["stage"] = stage
        s["question"] = bool(
            re.search(r"[?？]|为什么|怎么|如何|谁来|是否|什么|对不对|是不是", text)
        )
        s["interaction"] = any(
            w in text
            for w in [
                "讨论",
                "小组",
                "谁来",
                "请回答",
                "举手",
                "分享",
                "你认为",
                "同桌",
            ]
        )
        totals[stage] += max(0, s["end"] - s["start"])
        if s["question"]:
            questions.append({"segment_id": s["id"], "start": s["start"], "text": text})
        if s["interaction"]:
            interactions.append(
                {"segment_id": s["id"], "start": s["start"], "text": text}
            )
        if (
            timeline
            and timeline[-1]["name"] == stage
            and s["start"] - timeline[-1]["end"] < 15
        ):
            timeline[-1]["end"] = s["end"]
            timeline[-1]["segment_ids"].append(s["id"])
        else:
            timeline.append(
                {
                    "name": stage,
                    "start": s["start"],
                    "end": s["end"],
                    "segment_ids": [s["id"]],
                }
            )
    utterance_seconds = sum(max(0, s["end"] - s["start"]) for s in segments)
    characters = len(re.sub(r"\W", "", all_text))
    rate = round(characters / max(utterance_seconds / 60, 1 / 60))
    distribution = [
        {
            "name": name,
            "seconds": round(value, 1),
            "percent": round(value / max(utterance_seconds, 1) * 100, 1),
        }
        for name, value in totals.items()
    ]
    fillers = [
        {"word": word, "count": all_text.count(word)}
        for word in FILLERS
        if word in all_text
    ]
    bins = []
    for i in range(12):
        start, end = duration * i / 12, duration * (i + 1) / 12
        matching = [s for s in segments if start <= s["start"] < end]
        bins.append(
            {
                "start": round(start),
                "questions": sum(s["question"] for s in matching),
                "interactions": sum(s["interaction"] for s in matching),
                "characters": sum(len(s["text"]) for s in matching),
            }
        )
    longest = max(timeline, key=lambda t: t["end"] - t["start"])
    suggestions = []
    if len(interactions) < max(2, duration / 600):
        suggestions.append(
            {
                "priority": "优先尝试",
                "title": "给学生留出可见的表达机会",
                "evidence": f"全文识别到 {len(interactions)} 处互动邀请线索；最长连续环节为「{longest['name']}」。",
                "action": "在这一环节加入一次“独立思考 30 秒 → 同桌交流 60 秒 → 两位学生分享”，并记录不同观点。",
                "segment_id": longest["segment_ids"][0],
            }
        )
    if questions:
        suggestions.append(
            {
                "priority": "教学建议",
                "title": "让提问从判断走向解释",
                "evidence": f"识别到 {len(questions)} 个含疑问线索的话语片段，例如“{questions[0]['text'][:65]}”。",
                "action": "选择一个问题，增加“你的依据是什么？”和“还有其他解法吗？”两轮追问，等待至少 3–5 秒。",
                "segment_id": questions[0]["segment_id"],
            }
        )
    if fillers:
        most = max(fillers, key=lambda f: f["count"])
        suggestions.append(
            {
                "priority": "表达优化",
                "title": f"关注“{most['word']}”的重复使用",
                "evidence": f"该表达出现 {most['count']} 次。部分用法可能具有教学意义，需要结合原文判断。",
                "action": "回听高频片段，将不必要的衔接词换成短暂停顿，在关键概念前后保留清晰留白。",
                "segment_id": next(
                    s["id"] for s in segments if most["word"] in s["text"]
                ),
            }
        )
    if not any(t["name"] == "总结回顾" for t in timeline):
        suggestions.append(
            {
                "priority": "结构优化",
                "title": "以学生复述收束课堂",
                "evidence": "转写中未识别到明确的总结回顾关键词，可能存在漏识别。",
                "action": "预留最后 2 分钟，让学生用一句话总结概念，再写出一个仍未解决的问题。",
                "segment_id": segments[-1]["id"],
            }
        )
    if not suggestions:
        suggestions.append(
            {
                "priority": "教学建议",
                "title": "用一次出口任务检验理解",
                "evidence": f"当前文本包含 {len(segments)} 个话语片段。",
                "action": "设计一道与本课目标一致的简短应用题，根据学生回答调整下一节课的导入。",
                "segment_id": segments[-1]["id"],
            }
        )
    return {
        "version": "1.0",
        "engine": "local-text-rules",
        "duration": round(duration, 2),
        "summary": f"本课共整理 {len(segments)} 个话语片段，识别到 {len(questions)} 处提问线索、{len(interactions)} 处互动邀请。主要环节为「{max(totals, key=totals.get)}」，可结合原文证据回看教学节奏。",
        "metrics": {
            "characters": characters,
            "segments": len(segments),
            "questions": len(questions),
            "interactions": len(interactions),
            "speech_rate": rate,
            "labeled_student_segments": sum(
                s["speaker"] == "student" for s in segments
            ),
        },
        "segments": segments,
        "timeline": timeline,
        "distribution": distribution,
        "questions": questions,
        "interactions": interactions,
        "fillers": fillers,
        "rhythm": bins,
        "suggestions": suggestions,
        "limitations": [
            "环节、提问与互动使用可审计的文本规则识别，属于线索而非人工确认事实。",
            "未进行声纹分离；仅识别文本显式师生标签，不推测真实师生发言占比。",
            "普通文本时间轴按每秒 3.5 字估算；SRT/VTT 与 ASR 使用原始时间戳。",
            "语速为有效话语时长内字符数/分钟；重叠字幕可能影响计算。",
            "一期不含动作、情绪、板书或深度视觉识别。",
        ],
    }


def grounded_reply(question, analysis):
    suggestions = analysis["suggestions"]
    if any(word in question for word in ["语言", "口头", "表达"]):
        suggestions = [
            s for s in suggestions if s["priority"] == "表达优化"
        ] or suggestions
    elif any(word in question for word in ["提问", "问题"]):
        suggestions = [s for s in suggestions if "提问" in s["title"]] or suggestions
    chosen = suggestions[0]
    segment = next(s for s in analysis["segments"] if s["id"] == chosen["segment_id"])
    return f"根据本课文本，{chosen['evidence']}\n\n可回看 [{int(segment['start'] // 60):02d}:{int(segment['start'] % 60):02d}] 片段 #{segment['id']}：“{segment['text'][:160]}”\n\n建议：{chosen['action']}\n\n这是本地规则生成的证据建议。仅凭转写不能确认学生实际参与程度；可结合课堂观察核实。"
