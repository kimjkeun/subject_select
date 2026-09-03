# -*- coding: utf-8 -*-
"""추출 JSON들을 웹앱 런타임 산출물로 합친다.

  web/data/subjects.json        과목 전체 상세 (툴 호출로 필요한 것만 꺼내 씀)
  web/data/subject_index.json   과목 색인 - 시스템 프롬프트에 항상 캐시로 올림
  web/data/majors.json          학과 상세
  web/data/major_index.json     학과 색인
  web/data/major_subject_map.json  학과 -> 관련 선택 과목 역/정방향 매핑
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "data" / "extracted"
WEB = ROOT / "web" / "data"


def load(kind):
    d = EX / kind
    if not d.exists():
        return []
    return [json.loads(f.read_text(encoding="utf-8"))
            for f in sorted(d.glob("*.json"))]


def est_tokens(obj):
    """한글 위주 텍스트의 대략적 토큰 수. 음절 1.4토큰 + 그 외 0.3토큰."""
    s = json.dumps(obj, ensure_ascii=False)
    han = len(re.findall(r"[가-힣]", s))
    return int(han * 1.4 + (len(s) - han) * 0.3)


def build_subjects():
    rows = load("subject")
    subjects, index = {}, []
    for r in rows:
        sid = r["name"]
        subjects[sid] = r
        index.append({
            "id": sid, "group": r.get("group"), "type": r.get("type"),
            "credits": r.get("credits"), "csat": r.get("csat_2029"),
            "one_liner": r.get("one_liner"), "keywords": r.get("keywords", []),
            "page": r.get("_source_page"),
        })
    index.sort(key=lambda x: (x["group"] or "", x["type"] or "", x["id"]))
    return subjects, index


def build_majors():
    majors, index = {}, []
    for page in load("major"):
        for m in page.get("majors", []):
            mid = m["name"]
            m["_source_page"] = page.get("_source_page")
            majors[mid] = m
            rs = m.get("related_subjects") or {}
            index.append({
                "id": mid, "field": m.get("field"), "track": m.get("track"),
                "summary": (m.get("summary") or "")[:120],
                "n_subjects": sum(len(rs.get(k, [])) for k in
                                  ("general", "career", "fusion")),
                "page": m.get("_source_page"),
            })
    index.sort(key=lambda x: (x["field"] or "", x["track"] or "", x["id"]))
    return majors, index


def build_map(majors, subjects):
    """학과 -> 과목, 과목 -> 학과. 안내서 표기가 과목 DB에 없으면 unmatched로 남긴다."""
    m2s, s2m, unmatched = {}, defaultdict(list), defaultdict(set)
    for mid, m in majors.items():
        rs = m.get("related_subjects") or {}
        flat = {k: rs.get(k, []) for k in ("general", "career", "fusion")}
        m2s[mid] = flat
        for kind, names in flat.items():
            for n in names:
                if n in subjects:
                    s2m[n].append(mid)
                else:
                    unmatched[n].add(mid)
    return m2s, {k: sorted(set(v)) for k, v in s2m.items()}, \
        {k: sorted(v) for k, v in sorted(unmatched.items())}


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    subjects, s_index = build_subjects()
    majors, m_index = build_majors()
    m2s, s2m, unmatched = build_map(majors, subjects)

    files = {
        "subjects.json": subjects, "subject_index.json": s_index,
        "majors.json": majors, "major_index.json": m_index,
        "major_subject_map.json": {"major_to_subjects": m2s,
                                   "subject_to_majors": s2m,
                                   "unmatched_subject_names": unmatched},
    }
    for name, obj in files.items():
        (WEB / name).write_text(
            json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"과목 {len(subjects)}개 / 학과 {len(majors)}개")
    for name in files:
        p = WEB / name
        print(f"  {name:26s} {p.stat().st_size/1024:7.1f} KB")
    print(f"\n색인(항상 주입) 예상 토큰: 과목 {est_tokens(s_index):,} "
          f"+ 학과 {est_tokens(m_index):,}")
    if subjects:
        avg = sum(est_tokens(v) for v in subjects.values()) // len(subjects)
        print(f"과목 상세 1건 평균 {avg:,} 토큰 (툴 호출로 5~8건 주입 시 "
              f"{avg*6:,} 토큰)")
    if unmatched:
        print(f"\n과목 DB에 없는 표기 {len(unmatched)}종 "
              f"(교과군 뭉뚱그림/미개설 과목 - 별칭 사전 필요):")
        for n, ms in list(unmatched.items())[:10]:
            print(f"  - {n}  ({len(ms)}개 학과)")


if __name__ == "__main__":
    main()
