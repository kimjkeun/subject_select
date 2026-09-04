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


def load_aliases():
    """표기 흔들림 사전. canonical=정규 과목명으로 치환, special=전문교과라 정상 미매칭."""
    f = ROOT / "pipeline" / "aliases.json"
    if not f.exists():
        return {}, set()
    d = json.loads(f.read_text(encoding="utf-8"))
    canon = {k: v for k, v in d.get("canonical", {}).items()
             if not k.startswith("_")}
    special = {k for k in d.get("special_not_alias", {})
               if not k.startswith("_")}
    return canon, special


def build_special():
    """계열별 선택 과목 등록부. 보통 교과가 아니라 별도 축으로 둔다."""
    out = {}
    for d in load("special"):
        for s in d.get("subjects", []):
            out[s["name"]] = {
                "name": s["name"], "track": d.get("track"),
                "group": s.get("group"), "type": s.get("type"),
                "description": s.get("description"),
                "page": d.get("_source_page"),
            }
    return dict(sorted(out.items()))


def build_map(majors, subjects, special_db):
    """학과 -> 과목, 과목 -> 학과. 별칭을 정규화하고 전문교과는 따로 센다."""
    canon, special_known = load_aliases()
    m2s, s2m, unmatched = {}, defaultdict(list), defaultdict(set)
    aliased, spec = defaultdict(set), defaultdict(set)
    for mid, m in majors.items():
        rs = m.get("related_subjects") or {}
        flat = {}
        for k in ("general", "career", "fusion"):
            names = []
            for n in rs.get(k, []):
                t = canon.get(n, n)
                if t != n:
                    aliased[n].add(mid)
                if t in subjects:
                    s2m[t].append(mid)
                elif t in special_known or t in special_db:
                    spec[t].add(mid)
                else:
                    unmatched[t].add(mid)
                names.append(t)
            flat[k] = names
        m2s[mid] = flat
    srt = lambda d: {k: sorted(v) for k, v in sorted(d.items())}
    return (m2s, {k: sorted(set(v)) for k, v in s2m.items()},
            srt(unmatched), srt(aliased), srt(spec))


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    subjects, s_index = build_subjects()
    majors, m_index = build_majors()
    special = build_special()
    m2s, s2m, unmatched, aliased, spec = build_map(majors, subjects, special)

    files = {
        "subjects.json": subjects, "subject_index.json": s_index,
        "majors.json": majors, "major_index.json": m_index,
        "special_subjects.json": special,
        "major_subject_map.json": {"major_to_subjects": m2s,
                                   "subject_to_majors": s2m,
                                   "special_subject_refs": spec,
                                   "applied_aliases": aliased,
                                   "unmatched_subject_names": unmatched},
    }
    for name, obj in files.items():
        (WEB / name).write_text(
            json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"과목 {len(subjects)}개 / 학과 {len(majors)}개 / "
          f"계열별 선택 과목 {len(special)}개")
    for name in files:
        p = WEB / name
        print(f"  {name:26s} {p.stat().st_size/1024:7.1f} KB")
    print(f"\n색인(항상 주입) 예상 토큰: 과목 {est_tokens(s_index):,} "
          f"+ 학과 {est_tokens(m_index):,}")
    if subjects:
        avg = sum(est_tokens(v) for v in subjects.values()) // len(subjects)
        print(f"과목 상세 1건 평균 {avg:,} 토큰 (툴 호출로 5~8건 주입 시 "
              f"{avg*6:,} 토큰)")
    print()
    print(f"별칭 치환 {len(aliased)}종 / 전문교과 참조 {len(spec)}종 / "
          f"미해결 {len(unmatched)}종")
    for n, ms in aliased.items():
        print(f"  별칭   {n} ({len(ms)}개 학과)")
    for n, ms in spec.items():
        print(f"  전문   {n} ({len(ms)}개 학과)")
    for n, ms in unmatched.items():
        print(f"  미해결 {n} ({len(ms)}개 학과)")


if __name__ == "__main__":
    main()
