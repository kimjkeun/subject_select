# -*- coding: utf-8 -*-
"""이수 계획 검증기.

여기는 AI가 판단하지 않는다. 졸업 요건과 학교 편성은 그럴듯한 답이 아니라
정확한 답이어야 하므로 코드가 판정하고, AI는 그 결과를 설명만 한다.

  from engine.validator import validate, load_school
  r = validate({"g2-1-a": ["생명과학", "화학", "기하", "물리학"], ...}, school)
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

# 창의적 체험활동. 배당표에 학기별로 고정 편성돼 있다.
CCA = {"1-1": 3, "1-2": 3, "2-1": 2, "2-2": 2, "3-1": 4, "3-2": 4}


def load_school(slug):
    return json.loads((WEB / "schools" / f"{slug}.json").read_text(encoding="utf-8"))


class Report:
    def __init__(self):
        self.errors, self.warnings, self.summary = [], [], {}

    def err(self, rule, msg, **kw):
        self.errors.append({"rule": rule, "message": msg, **kw})

    def warn(self, rule, msg, **kw):
        self.warnings.append({"rule": rule, "message": msg, **kw})

    def as_dict(self):
        return {"ok": not self.errors, "errors": self.errors,
                "warnings": self.warnings, "summary": self.summary}


def validate(picks, school):
    """picks: {choice_group_id: [과목명, ...]}. 학교지정 과목은 자동 이수."""
    r = Report()
    off = {o["name"]: o for o in school["offerings"]}
    groups = {g["id"]: g for g in school["choice_groups"]}

    # ---------------------------------------------------------- 1. 택N 그룹
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

    # ---------------------------------------------------------- 2. 학점 집계
    taken = {}                       # 과목명 -> (학기, 학점, 교과군, 구분)
    for o in school["offerings"]:
        if o["track"] == "학교지정" or o["name"] in chosen:
            taken[o["name"]] = o

    by_sem, by_group, by_track = defaultdict(int), defaultdict(int), defaultdict(int)
    rot_done = set()
    for n, o in taken.items():
        for s in o["semesters"]:
            if o.get("rotation"):        # 음악/미술 분반 교차: 학기당 한 과목만
                key = (o["rotation"], s)
                if key in rot_done:
                    continue
                rot_done.add(key)
                by_sem[s] += 3
            else:
                by_sem[s] += o["credits"]
        by_group[o["group"]] += o["credits"]
        by_track[o["track"]] += o["credits"]

    subject_total = sum(by_sem.values())
    r.summary = {
        "과목수": len(taken),
        "교과학점": subject_total,
        "창체학점": sum(CCA.values()),
        "총이수학점": subject_total + sum(CCA.values()),
        "학기별": {s: by_sem[s] + CCA[s] for s in SEMESTERS},
        "학기별_교과": {s: by_sem[s] for s in SEMESTERS},
        "교과군별": dict(sorted(by_group.items(), key=lambda x: -x[1])),
        "구분별": dict(by_track),
    }

    # ---------------------------------------------------------- 3. 총량
    t = school["totals"]
    if subject_total != t["subject_credits"]:
        r.err("교과학점", f"교과 이수 학점 {subject_total} - "
                        f"{t['subject_credits']}학점이어야 합니다.")
    total = subject_total + sum(CCA.values())
    if total != t["graduation_credits"]:
        r.err("졸업학점", f"총 이수 학점 {total} - "
                        f"졸업 요건은 {t['graduation_credits']}학점입니다.")
    for s in SEMESTERS:
        got = by_sem[s] + CCA[s]
        if got != t["credits_per_semester"]:
            r.err("학기학점", f"{s} 학기 {got}학점 - "
                            f"{t['credits_per_semester']}학점이어야 합니다.", semester=s)

    # ---------------------------------------------------------- 4. 교과군 필수 이수
    alias = {"한국사": ["한국사1", "한국사2"]}
    for g, need in school["required_by_group"].items():
        if g in alias:
            got = sum(taken[n]["credits"] for n in alias[g] if n in taken)
        elif g == "사회":
            got = sum(o["credits"] for n, o in taken.items()
                      if o["group"].startswith("사회") and n not in alias["한국사"])
        else:
            got = by_group.get(g, 0)
        if got < need["required"]:
            r.err("필수이수", f"{g} 교과(군) {got}학점 - "
                            f"필수 이수 {need['required']}학점에 미달합니다.",
                  group=g, got=got, required=need["required"])

    # ---------------------------------------------------------- 5. 학교 고유 규칙
    for rule in school["rules"]:
        gs = rule.get("groups", [])
        if rule["type"] == "max_credits":
            if rule.get("scope"):        # 2·3학년 선택분만
                got = sum(o["credits"] for o in taken.values()
                          if o["group"] in gs and o["track"] != "학교지정")
            else:
                got = sum(by_group.get(g, 0) for g in gs)
            if got > rule["limit"]:
                r.err(rule["id"], f"{rule['text']} 현재 {got}학점.",
                      got=got, limit=rule["limit"])
        elif rule["type"] == "min_credits":
            got = sum(by_group.get(g, 0) for g in gs)
            if got < rule["limit"]:
                r.err(rule["id"], f"{rule['text']} 현재 {got}학점.",
                      got=got, limit=rule["limit"])
        elif rule["type"] == "advisory":
            r.warn(rule["id"], rule["text"])

    # ---------------------------------------------------------- 6. 위계
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
            # 학기는 학생이 고르는 것이 아니라 학교가 정한다. 같은 학기 동시
            # 이수는 학교의 편성이므로 통과시키고, 선수 과목이 더 뒤에 놓인
            # 경우만 잡는다. 이건 학생의 실수가 아니라 배당표 자체의 문제다.
            a = min(order[s] for s in taken[need]["semesters"])
            b = min(order[s] for s in o["semesters"])
            if a > b:
                r.err("배당표위계",
                      f"배당표 확인 필요 - 선수 과목 {need}"
                      f"({taken[need]['semesters'][0]})이(가) "
                      f"{n}({o['semesters'][0]})보다 뒤에 편성돼 있습니다.",
                      subject=n, prerequisite=need)

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
    return "\n".join(out)
