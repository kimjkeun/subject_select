# -*- coding: utf-8 -*-
"""추출 결과를 원본 텍스트와 대조해 의심 항목만 골라낸다. 사람 검수 대상 축소용."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "pages"
EX = ROOT / "data" / "extracted"

CREDIT = re.compile(r"\d+\s*~\s*\d+\s*학점|\d+\s*학점")


def check_subject(d, raw):
    bad = []
    if not d.get("name") or d["name"] not in raw:
        bad.append("과목명이 원본 텍스트에 없음")
    if d.get("credits") and d["credits"].replace(" ", "") not in \
            raw.replace(" ", ""):
        bad.append(f"편성 학점 불일치: {d.get('credits')!r}")
    if not CREDIT.search(raw):
        bad.append("원본에서 학점 표기를 못 찾음(표 판독 확인 필요)")
    if not d.get("units"):
        bad.append("units 비어 있음")
    if not d.get("recommended_for"):
        bad.append("recommended_for 비어 있음")
    for u in d.get("units", []):
        for a in u.get("activities", []):
            if "Ⅰ" in a or "Ⅱ" in a or "Ⅲ" in a:
                bad.append(f"측면 색인 글자 잔존: {a[:30]}")
    # 원문 대조: 각 활동 문장의 앞 12자가 원본에 있는지
    flat = re.sub(r"\s+", "", raw)
    for u in d.get("units", []):
        for a in u.get("activities", []):
            head = re.sub(r"\s+", "", a)[:12]
            if head and head not in flat:
                bad.append(f"원문에 없는 활동(환각 의심): {a[:30]}")
    return bad


def check_major(d, raw):
    bad = []
    if not d.get("majors"):
        return ["majors 비어 있음"]
    for m in d["majors"]:
        if m["name"] not in raw:
            bad.append(f"학과명 불일치: {m['name']}")
        rs = m.get("related_subjects") or {}
        if not any(rs.get(k) for k in ("general", "career", "fusion")):
            bad.append(f"{m['name']}: 관련 선택 과목 비어 있음")
    return bad


CHECKS = {"subject": check_subject, "major": check_major}


def main():
    for kind, fn in CHECKS.items():
        d = EX / kind
        if not d.exists():
            continue
        files = sorted(d.glob("*.json"))
        flagged = 0
        print(f"\n[{kind}] {len(files)}건 검사")
        for f in files:
            data = json.loads(f.read_text(encoding="utf-8"))
            raw = (PAGES / f"{data.get('_page_file', f.stem)}.txt")
            raw = raw.read_text(encoding="utf-8") if raw.exists() else ""
            bad = fn(data, raw)
            if bad:
                flagged += 1
                print(f"  {f.stem} (p.{data.get('_source_page')})")
                for b in bad[:5]:
                    print(f"      - {b}")
        print(f"  => 검수 필요 {flagged}/{len(files)}건")


if __name__ == "__main__":
    main()
