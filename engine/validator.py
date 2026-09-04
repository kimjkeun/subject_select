# -*- coding: utf-8 -*-
"""이수 계획 검증기.

여기는 AI가 판단하지 않는다. 졸업 요건과 학교 편성은 그럴듯한 답이 아니라
정확한 답이어야 하므로 코드가 판정하고, AI는 그 결과를 설명만 한다.

  from engine.validator import validate, load_school, check_target_recommendation
  r = validate({"g2-1-a": ["생명과학", "화학", "기하", "물리학"], ...}, school, target_unit="경영", target_university="서울대")
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "data"
SEMESTERS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"]

# 위계: 뒤 과목을 들으려면 앞 과목을 먼저 들어야 한다.
PREREQ = {
    "미적분Ⅰ": ["대수"],
    "미적분Ⅱ": ["미적분Ⅰ"],
    "기하": ["대수"],
    "역학과 에너지": ["물리학"],
    "전자기와 양자": ["물리학"],
    "물질과 에너지": ["화학"],
    "화학 반응의 세계": ["화학"],
    "세포와 물질대사": ["생명과학"],
    "생물의 유전": ["생명과학"],
    "지구시스템과학": ["지구과학"],
    "행성우주과학": ["지구과학"],
}

# 창의적 체험활동. 기본 배당표 기준 (학교 totals의 creative_activity_credits가 있으면 우선)
DEFAULT_CCA = {"1-1": 3, "1-2": 3, "2-1": 2, "2-2": 2, "3-1": 4, "3-2": 4}


def load_school(slug):
    path = WEB / "schools" / f"{slug}.json"
    if not path.exists():
        if (WEB / "schools" / slug).exists():
            path = WEB / "schools" / slug
        else:
            raise FileNotFoundError(f"School file not found: {slug}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_appendix_map():
    p = WEB / "appendix_domain_map.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def load_appendix_requirements():
    p = WEB / "appendix_requirements.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


class Report:
    def __init__(self):
        self.errors, self.warnings, self.recommendations, self.summary = [], [], [], {}

    def err(self, rule, msg, **kw):
        self.errors.append({"rule": rule, "message": msg, **kw})

    def warn(self, rule, msg, **kw):
        self.warnings.append({"rule": rule, "message": msg, **kw})

    def rec(self, rule, msg, **kw):
        self.recommendations.append({"rule": rule, "message": msg, **kw})

    def as_dict(self):
        return {
            "ok": not self.errors,
            "errors": self.errors,
            "warnings": self.warnings,
            "recommendations": self.recommendations,
            "summary": self.summary,
        }


def check_target_recommendation(taken_names, target_unit, target_university=None, report=None):
    """학생이 선택한 과목이 지망 모집단위(학부/학과) 및 대학의 권장과목을 충족하는지 검사한다."""
    if report is None:
        report = Report()

    reqs = load_appendix_requirements()
    dom_map = load_appendix_map().get("columns", {})
    if not reqs or not dom_map:
        return report

    matches = [r for r in reqs if r.get("unit") == target_unit]
    if target_university:
        matches = [r for r in matches if target_university in r.get("university", "")]

    if not matches:
        report.warn("권장과목안내", f"부록 표에서 모집단위 '{target_unit}'(대학: {target_university or '전체'}) 정보를 찾지 못했습니다.")
        return report

    for entry in matches:
        uni = entry["university"]
        unit = entry["unit"]
        for col_name, val in entry.get("subjects", {}).items():
            if val is True:  # 필수/반영/권장 표시됨
                col_def = dom_map.get(col_name, {})
                core_subjects = col_def.get("core", [])
                related_subjects = col_def.get("related", [])
                all_allowed = set(core_subjects + related_subjects)

                overlap = all_allowed.intersection(taken_names)
                if not overlap:
                    needed_str = ", ".join(core_subjects) if core_subjects else col_name
                    report.rec(
                        "대학권장과목",
                        f"[{uni} {unit}] 2028 대입 반영(권장) '{col_name}' 영역 과목({needed_str})이 이수 계획에 없습니다.",
                        university=uni,
                        unit=unit,
                        column=col_name,
                        suggested=list(all_allowed)
                    )
            elif isinstance(val, str) and val.strip():
                report.rec(
                    "대학특이사항",
                    f"[{uni} {unit}] 특이 권장사항: {val}",
                    university=uni,
                    unit=unit,
                    detail=val
                )

    return report


def validate(picks, school, target_unit=None, target_university=None):
    """picks: {choice_group_id: [과목명, ...]}. 학교지정 과목은 자동 이수."""
    r = Report()
    off = {o["name"]: o for o in school["offerings"]}
    groups = {g["id"]: g for g in school.get("choice_groups", [])}

    # 1. 택N 그룹 검사
    chosen = []
    for gid, g in groups.items():
        sel = list(picks.get(gid, []))
        dup = {x for x in sel if sel.count(x) > 1}
        if dup:
            r.err("중복선택", f"{gid}: {', '.join(sorted(dup))}을(를) 여러 번 골랐습니다.",
                  group=gid)
        sel = sorted(set(sel))
        outside = [x for x in sel if x not in g["members"]]
        if outside:
            r.err("그룹밖선택",
                  f"{g['semester']} 선택군에 없는 과목입니다: {', '.join(outside)}",
                  group=gid, subjects=outside)
        valid = [x for x in sel if x in g["members"]]
        if len(valid) != g["pick"]:
            verb = "더 골라야" if len(valid) < g["pick"] else "덜 골라야"
            r.err("선택개수",
                  f"{g['semester']} {g['credits']}학점 택{g['pick']} - "
                  f"{len(valid)}개 선택. {abs(g['pick'] - len(valid))}개 {verb} 합니다.",
                  group=gid, picked=len(valid), required=g["pick"])
        chosen += valid

    for gid in picks:
        if gid not in groups:
            r.err("없는선택군", f"'{gid}'는 이 학교에 없는 선택군입니다.", group=gid)

    # 2. 학점 집계
    taken = {}
    for o in school["offerings"]:
        if o["track"] == "학교지정" or o["name"] in chosen:
            taken[o["name"]] = o

    cca_map = school.get("totals", {}).get("cca_by_semester", DEFAULT_CCA)
    by_sem, by_group, by_track = defaultdict(int), defaultdict(int), defaultdict(int)
    rot_done = set()
    for n, o in taken.items():
        for s in o["semesters"]:
            if o.get("rotation"):
                key = (o["rotation"], s)
                if key in rot_done:
                    continue
                rot_done.add(key)
                by_sem[s] += o["credits"]
            else:
                by_sem[s] += o["credits"]
        by_group[o["group"]] += o["credits"]
        by_track[o["track"]] += o["credits"]

    subject_total = sum(by_sem.values())
    cca_total = sum(cca_map.get(s, DEFAULT_CCA.get(s, 0)) for s in SEMESTERS)
    r.summary = {
        "과목수": len(taken),
        "교과학점": subject_total,
        "창체학점": cca_total,
        "총이수학점": subject_total + cca_total,
        "학기별": {s: by_sem[s] + cca_map.get(s, DEFAULT_CCA.get(s, 0)) for s in SEMESTERS},
        "학기별_교과": {s: by_sem[s] for s in SEMESTERS},
        "교과군별": dict(sorted(by_group.items(), key=lambda x: -x[1])),
        "구분별": dict(by_track),
    }

    # 3. 총량 및 졸업 요건
    t = school.get("totals", {})
    if "subject_credits" in t and subject_total != t["subject_credits"]:
        r.err("교과학점", f"교과 이수 학점 {subject_total} - "
                        f"{t['subject_credits']}학점이어야 합니다.")
    total = subject_total + cca_total
    if "graduation_credits" in t and total != t["graduation_credits"]:
        r.err("졸업학점", f"총 이수 학점 {total} - "
                        f"졸업 요건은 {t['graduation_credits']}학점입니다.")
    if "credits_per_semester" in t:
        for s in SEMESTERS:
            got = by_sem[s] + cca_map.get(s, DEFAULT_CCA.get(s, 0))
            if got != t["credits_per_semester"]:
                r.err("학기학점", f"{s} 학기 {got}학점 - "
                                f"{t['credits_per_semester']}학점이어야 합니다.", semester=s)

    # 4. 교과군 필수 이수
    alias = {"한국사": ["한국사1", "한국사2"]}
    for g, need in school.get("required_by_group", {}).items():
        if g in alias:
            got = sum(taken[n]["credits"] for n in alias[g] if n in taken)
        elif g == "사회":
            got = sum(o["credits"] for n, o in taken.items()
                      if o["group"].startswith("사회") and n not in alias.get("한국사", []))
        else:
            got = sum(credits for grp, credits in by_group.items()
                      if grp == g or grp.startswith(f"{g}(") or grp.startswith(f"{g}/"))
        if got < need["required"]:
            r.err("필수이수", f"{g} 교과(군) {got}학점 - "
                            f"필수 이수 {need['required']}학점에 미달합니다.",
                  group=g, got=got, required=need["required"])

    # 5. 학교 고유 규칙
    for rule in school.get("rules", []):
        gs = rule.get("groups", [])
        
        def matches_group(grp):
            for target_g in gs:
                if grp == target_g or grp.startswith(f"{target_g}(") or grp.startswith(f"{target_g}/"):
                    return True
            return False

        if rule["type"] == "max_credits":
            if rule.get("scope"):
                got = sum(o["credits"] for o in taken.values()
                          if matches_group(o["group"]) and o["track"] != "학교지정")
            else:
                got = sum(credits for grp, credits in by_group.items() if matches_group(grp))
            if got > rule["limit"]:
                r.err(rule["id"], f"{rule['text']} 현재 {got}학점.",
                      got=got, limit=rule["limit"])
        elif rule["type"] == "min_credits":
            got = sum(credits for grp, credits in by_group.items() if matches_group(grp))
            if got < rule["limit"]:
                r.err(rule["id"], f"{rule['text']} 현재 {got}학점.",
                      got=got, limit=rule["limit"])
        elif rule["type"] == "advisory":
            r.warn(rule["id"], rule["text"])

    # 6. 위계 검증
    order = {s: i for i, s in enumerate(SEMESTERS)}
    for n, o in taken.items():
        for need in PREREQ.get(n, []):
            if need not in taken:
                if need in off:
                    r.err("위계", f"{n}을(를) 들으려면 {need}을(를) 먼저 이수해야 합니다.",
                          subject=n, prerequisite=need)
                else:
                    r.warn("위계", f"{n}의 선수 과목 {need}이(가) 이 학교에 개설되지 "
                                  f"않습니다.", subject=n, prerequisite=need)
                continue
            a = min(order[s] for s in taken[need]["semesters"])
            b = min(order[s] for s in o["semesters"])
            if a > b:
                r.err("배당표위계",
                      f"배당표 확인 필요 - 선수 과목 {need}"
                      f"({taken[need]['semesters'][0]})이(가) "
                      f"{n}({o['semesters'][0]})보다 뒤에 편성돼 있습니다.",
                      subject=n, prerequisite=need)

    # 7. 목표 모집단위/대학 권장과목 체크
    if target_unit:
        check_target_recommendation(set(taken.keys()), target_unit, target_university, report=r)

    return r.as_dict()


def explain(result):
    s = result["summary"]
    out = ["[통과]" if result["ok"] else "[미충족]"]
    out.append(f"  과목 {s['과목수']}개 / 교과 {s['교과학점']} + 창체 {s['창체학점']} "
               f"= 총 {s['총이수학점']}학점")
    out.append("  학기별  " + "  ".join(f"{k} {v}" for k, v in s["학기별"].items()))
    out.append("  교과군  " + "  ".join(f"{k.split('(')[0]} {v}"
                                       for k, v in s["교과군별"].items()))
    for e in result["errors"]:
        out.append(f"  X [{e['rule']}] {e['message']}")
    for w in result["warnings"]:
        out.append(f"  ! [{w['rule']}] {w['message']}")
    for rec in result.get("recommendations", []):
        out.append(f"  ? [{rec['rule']}] {rec['message']}")
    return "\n".join(out)
