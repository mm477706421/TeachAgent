import html


def markdown(lesson, analysis):
    lines = [
        f"# {lesson['title']} · 教学分析报告",
        "",
        f"学科：{lesson['subject']}　班级：{lesson['class_name']}",
        "",
        "> 数据性质："
        + ("合成示例，仅用于体验。" if lesson["example"] else "本地课堂转写分析。"),
        "",
        "## 授课方式画像",
        "",
        analysis["summary"],
        "",
        "| 指标 | 结果 |",
        "| --- | --- |",
    ]
    labels = {
        "characters": "有效字符",
        "segments": "话语片段",
        "questions": "提问线索",
        "interactions": "互动邀请线索",
        "speech_rate": "话语语速（字/分钟）",
        "labeled_student_segments": "显式学生标签片段",
    }
    lines += [
        f"| {label} | {analysis['metrics'][key]} |" for key, label in labels.items()
    ]
    lines += ["", "## 环节时间分配", ""]
    lines += [
        f"- {s['name']}：{s['seconds']} 秒，占有效话语时长 {s['percent']}%"
        for s in analysis["distribution"]
    ]
    lines += ["", "## 可优化点清单", ""]
    for s in analysis["suggestions"]:
        lines += [
            f"### {s['title']}",
            "",
            f"证据（片段 #{s['segment_id']}）：{s['evidence']}",
            "",
            f"建议：{s['action']}",
            "",
        ]
    lines += ["## 方法与边界", ""] + ["- " + text for text in analysis["limitations"]]
    lines += ["", "## 转写原文", ""]
    for s in analysis["segments"]:
        stamp = f"{int(s['start'] // 60):02d}:{int(s['start'] % 60):02d}"
        lines.append(f"- [{stamp}] #{s['id']} 【{s['stage']}】{s['text']}")
    return "\n".join(lines)


def html_report(lesson, analysis):
    content = html.escape(markdown(lesson, analysis))
    return f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TeachAgent 教学报告</title><style>body{{font-family:system-ui,sans-serif;max-width:960px;margin:48px auto;padding:24px;color:#163e36;line-height:1.9}}pre{{white-space:pre-wrap;font:inherit}}@media print{{body{{margin:0}}}}</style><h1>TeachAgent · 教学分析报告</h1><p>可通过浏览器打印菜单保存为 PDF。学校本地数据，请妥善保管。</p><pre>{content}</pre></html>'
