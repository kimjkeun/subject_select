# -*- coding: utf-8 -*-
"""낱쪽을 문서 유형별로 분류한다. 유형마다 추출 스키마가 다르다.

  subject     보통교과 과목 프로필 (Ⅱ단원)
  special     계열별 선택 과목 - 간략 안내 (Ⅱ단원 말미)
  group_map   교과(군) 표지 - 일반/진로/융합 선택 과목 지도
  major_intro 계열 소개 - 관련 학과 목록
  major       계열별 학과 안내 (Ⅲ단원)
  appendix    부록 (반영/권장과목 표 등)
  front       Ⅰ단원·표지·목차 등 서두
  skip        빈 페이지 / 간지
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "pages"


def classify(text, printed):
    t = text
    if len(t.strip()) < 120:
        return "skip"
    if "과목 프로필" in t and "교과(군)" in t:
        return "subject"
    if "계열별 선택 과목" in t or ("선택 유형" in t and "주요 내용" in t):
        return "special"
    if "주요 전공 교과목" in t or "유사 학과" in t:
        return "major"
    if "관련 학과" in t and "계열" in t:
        return "major_intro"
    if ("일반" in t and "진로" in t and "융합" in t and len(t.strip()) < 900):
        return "group_map"
    if printed and printed >= 346:
        return "appendix"
    if printed and printed <= 37:
        return "front"
    return "other"


def main():
    idx = json.loads((PAGES / "index.json").read_text(encoding="utf-8"))
    counts = {}
    for x in idx:
        t = (PAGES / f"{x['name']}.txt").read_text(encoding="utf-8")
        x["kind"] = classify(t, x["printed_page"])
        counts[x["kind"]] = counts.get(x["kind"], 0) + 1
    (PAGES / "index.json").write_text(
        json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")

    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        rng = [x["printed_page"] for x in idx
               if x["kind"] == k and x["printed_page"]]
        span = f"p.{min(rng)}~{max(rng)}" if rng else "-"
        print(f"  {k:9s} {v:4d}쪽   {span}")


if __name__ == "__main__":
    main()
