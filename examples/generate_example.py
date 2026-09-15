"""Generate explicitly synthetic fixtures; no real classroom data is included."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.analysis import analyze, parse_transcript

root = Path(__file__).resolve().parent.parent
lines = [
    "教师：同学们好，今天我们从生活中的抛物线开始，认识二次函数。",
    "教师：回顾上节课学习的一次函数，它的图像有什么特点？",
    "学生：一次函数的图像是一条直线。",
    "教师：那么，如果把一次项变成平方项，图像会发生什么变化？",
    "教师：请观察函数 y=x² 的表达式，自变量可以取任意实数。",
    "教师：我们先建立平面直角坐标系，标出横轴与纵轴的单位。",
    "教师：然后，取 -3 到 3 的整数，分别求出对应的函数值。",
    "教师：那么，将这些点在坐标系中描出，注意坐标的正负号。",
    "教师：用平滑的曲线连接这些点，就得到一条抛物线。",
    "教师：那么，这条曲线具有轴对称的性质，对称轴是 y 轴。",
    "教师：当 x=0 时，函数取到最小值，原点称为顶点。",
    "教师：然后，我们观察 y=2x² 与 y=x² 的差异。",
    "教师：系数绝对值增大，抛物线的开口变窄，这一点要注意。",
    "教师：接下来比较 y=-x²，开口方向向下，对不对？",
    "教师：那么，系数的正负决定开口方向，绝对值影响开口大小。",
    "教师：在顶点左侧和右侧，函数值的变化趋势不同。",
    "教师：我们可以通过列表、描点、连线三个步骤作图。",
    "教师：那么，请独立完成练习一，画出 y=0.5x² 的图像。",
    "学生：老师，我画的图像比 y=x² 更宽。",
    "教师：这个观察很好。你认为是什么决定了开口大小？请分享依据。",
    "学生：系数的绝对值小于一，所以开口更宽。",
    "教师：然后完成练习二，比较三个函数的开口方向。",
    "教师：请计算当 x=2 时三个函数的值，并检查符号。",
    "教师：那么，作图时不要把抛物线画成折线。",
    "教师：这节课我们总结二次函数的开口、顶点与对称轴。",
    "教师：请用一句话归纳系数 a 对函数图像的影响，下课。",
]


def stamp(seconds):
    return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d},000"


text = "\n\n".join(
    f"{i + 1}\n{stamp(i * 95)} --> {stamp(i * 95 + 80)}\n{line}"
    for i, line in enumerate(lines)
)
fixture = {
    "title": "二次函数的图像与性质",
    "subject": "数学",
    "class_name": "九年级 · 三班",
    "text": text,
}
(root / "examples" / "lesson.json").write_text(
    json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8"
)
analysis = analyze(parse_transcript(text))
lesson = {
    "id": "demo-math",
    "user_id": "demo",
    "title": fixture["title"],
    "subject": "数学",
    "class_name": fixture["class_name"],
    "status": "completed",
    "progress": 100,
    "stage": "分析完成",
    "duration": analysis["duration"],
    "example": 1,
    "created": 1789434000,
    "metrics": analysis["metrics"],
    "analysis": analysis,
    "frames": [],
    "has_video": False,
}
(root / "frontend" / "src" / "demo.json").write_text(
    json.dumps(lesson, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("Synthetic example fixtures generated.")
