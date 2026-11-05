"""Validated deterministic teaching simulation specifications; never execute AI code."""

# ruff: noqa: B008
import json
import math
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import config, model_service
from .db import connect

CATALOG = json.loads(
    (config.ROOT / "frontend/src/simulation-catalog.json").read_text(encoding="utf-8")
)


class Input(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=5, max_length=6000)
    use_ai: bool = False
    allow_external: bool = False


class Save(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=6000)
    spec: dict


def validate(spec):
    definition = next((d for d in CATALOG if d["id"] == spec.get("kind")), None)
    if not definition:
        raise HTTPException(
            422, "当前支持单摆、平抛、弹簧、行波和 RC 电路；该课程尚无已验证的模型"
        )
    raw = spec.get("params", {})
    if not isinstance(raw, dict) or set(raw) - {p["key"] for p in definition["params"]}:
        raise HTTPException(422, "模型参数不匹配")
    params = {}
    for p in definition["params"]:
        v = raw.get(p["key"], p["value"])
        if (
            isinstance(v, bool)
            or not isinstance(v, (float, int))
            or not math.isfinite(v)
            or not p["min"] <= v <= p["max"]
        ):
            raise HTTPException(422, "参数超出教学模型的适用范围")
        params[p["key"]] = v
    return {"kind": definition["id"], "params": params}


def from_text(text):
    definition = next(
        (d for d in CATALOG if any(k.lower() in text.lower() for k in d["keywords"])),
        None,
    )
    if not definition:
        raise HTTPException(
            422,
            "未识别到支持的模型，请明确描述单摆、平抛、弹簧振子、正弦行波或 RC 充电电路",
        )
    params = {p["key"]: p["value"] for p in definition["params"]}
    for p in definition["params"]:
        match = re.search(
            re.escape(p["label"]) + r"\s*(?:为|是|=|：|:)?\s*([+-]?\d+(?:\.\d+)?)", text
        )
        if match:
            value = float(match[1])
            suffix = text[match.end() :].lstrip()
            unit_match = re.match(r"[a-zA-ZμµΩ/²°]+|厘米|毫米|千克|米|克", suffix)
            unit = unit_match[0] if unit_match else ""
            conversions = {
                "m": {
                    "m": 1,
                    "米": 1,
                    "cm": 0.01,
                    "厘米": 0.01,
                    "mm": 0.001,
                    "毫米": 0.001,
                },
                "kg": {"kg": 1, "千克": 1, "g": 0.001, "克": 0.001},
                "kΩ": {"kΩ": 1, "Ω": 0.001},
                "μF": {"μF": 1, "µF": 1, "uF": 1, "mF": 1000, "F": 1000000},
            }.get(p["unit"], {p["unit"]: 1})
            if unit and unit not in conversions:
                raise HTTPException(422, "无法确认描述中的单位，请按参数面板单位填写")
            params[p["key"]] = value * conversions.get(unit, 1)
    return validate({"kind": definition["id"], "params": params})


def router_for(current_user):
    router = APIRouter(prefix="/api/simulations", tags=["理科动态模型"])

    @router.post("/interpret")
    async def interpret(body: Input, user=Depends(current_user)):
        if not body.use_ai:
            return {
                "spec": from_text(body.description),
                "engine": "本地规则匹配（参数可编辑）",
            }
        settings, key = model_service._read(user["id"])
        if settings["provider"] == "openai" and not body.allow_external:
            raise HTTPException(400, "请确认将课程描述发送到个人模型服务")
        if settings["provider"] == "rules":
            raise HTTPException(
                400, "请在空间设置配置个人 API 或本地 Ollama，或使用本地规则匹配"
            )
        system = (
            "将课程描述转换为 JSON 对象 {kind,params}，只使用以下受支持模型，参数单位严格遵循目录，不输出代码。不能匹配时返回 {kind:unsupported}。目录："
            + json.dumps(CATALOG, ensure_ascii=False)
        )
        result = await model_service.complete(
            settings,
            key,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": body.description},
            ],
        )
        answer, engine = result["content"], result["engine"]
        try:
            text = answer.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
            spec = json.loads(text)
            if not isinstance(spec, dict):
                raise TypeError()
        except (ValueError, TypeError):
            raise HTTPException(
                422, "模型没有返回有效参数，请改写描述或使用规则匹配"
            ) from None
        return {"spec": validate(spec), "engine": engine}

    @router.get("")
    def listing(user=Depends(current_user)):
        with connect() as db:
            return [
                {**dict(r), "spec": json.loads(r["spec"])}
                for r in db.execute(
                    "SELECT * FROM simulations WHERE user_id=? ORDER BY created DESC LIMIT 100",
                    (user["id"],),
                )
            ]

    @router.post("", status_code=201)
    def save(body: Save, user=Depends(current_user)):
        spec = validate(body.spec)
        vid = uuid.uuid4().hex
        if not body.title.strip():
            raise HTTPException(400, "请填写模型名称")
        with connect() as db:
            db.execute(
                "INSERT INTO simulations VALUES(?,?,?,?,?,?)",
                (
                    vid,
                    user["id"],
                    body.title.strip(),
                    body.description,
                    json.dumps(spec),
                    time.time(),
                ),
            )
        return {"id": vid}

    @router.delete("/{vid}")
    def delete(vid: str, user=Depends(current_user)):
        with connect() as db:
            if (
                db.execute(
                    "DELETE FROM simulations WHERE id=? AND user_id=?",
                    (vid, user["id"]),
                ).rowcount
                != 1
            ):
                raise HTTPException(404, "模型不存在")
        return {"ok": True}

    return router
