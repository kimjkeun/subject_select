/**
 * @file validator.js - 브라우저 클라이언트 사이드 결정론적 교육과정 검증기
 * engine/validator.py와 100% 동일한 규칙을 브라우저에서 즉각 판정합니다.
 */

const SEMESTERS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"];

const PREREQ = {
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
  "행성우주과학": ["지구과학"]
};

const DEFAULT_CCA = { "1-1": 3, "1-2": 3, "2-1": 2, "2-2": 2, "3-1": 4, "3-2": 4 };

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.recommendations = [];
    this.summary = {};
  }

  err(rule, message, extra = {}) {
    this.errors.push({ rule, message, ...extra });
  }

  warn(rule, message, extra = {}) {
    this.warnings.push({ rule, message, ...extra });
  }

  rec(rule, message, extra = {}) {
    this.recommendations.push({ rule, message, ...extra });
  }

  asDict() {
    return {
      ok: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      recommendations: this.recommendations,
      summary: this.summary
    };
  }
}

export function validatePlan(picks, school, appendixData = null, targetUnit = null, targetUniversity = null) {
  const r = new Report();
  const off = {};
  for (const o of school.offerings) {
    off[o.name] = o;
  }

  const groups = {};
  for (const g of (school.choice_groups || [])) {
    groups[g.id] = g;
  }

  // 1. 택N 그룹 검사
  const chosen = [];
  for (const [gid, g] of Object.entries(groups)) {
    const sel = picks[gid] || [];
    const dup = sel.filter((item, index) => sel.indexOf(item) !== index);
    if (dup.length > 0) {
      r.err("중복선택", `${gid}: ${[...new Set(dup)].join(", ")}을(를) 여러 번 골랐습니다.`, { group: gid });
    }

    const uniqueSel = [...new Set(sel)];
    const outside = uniqueSel.filter(x => !g.members.includes(x));
    if (outside.length > 0) {
      r.err("그룹밖선택", `${g.semester} 선택군에 없는 과목입니다: ${outside.join(", ")}`, { group: gid, subjects: outside });
    }

    const valid = uniqueSel.filter(x => g.members.includes(x));
    if (valid.length !== g.pick) {
      const verb = valid.length < g.pick ? "더 골라야" : "덜 골라야";
      r.err(
        "선택개수",
        `${g.semester} ${g.credits}학점 택${g.pick} - ${valid.length}개 선택. ${Math.abs(g.pick - valid.length)}개 ${verb} 합니다.`,
        { group: gid, picked: valid.length, required: g.pick }
      );
    }
    chosen.push(...valid);
  }

  for (const gid of Object.keys(picks)) {
    if (!groups[gid]) {
      r.err("없는선택군", `'${gid}'는 이 학교에 없는 선택군입니다.`, { group: gid });
    }
  }

  // 2. 학점 집계
  const taken = {};
  for (const o of school.offerings) {
    if (o.track === "학교지정" || chosen.includes(o.name)) {
      taken[o.name] = o;
    }
  }

  const ccaMap = (school.totals && school.totals.cca_by_semester) || DEFAULT_CCA;
  const bySem = { "1-1": 0, "1-2": 0, "2-1": 0, "2-2": 0, "3-1": 0, "3-2": 0 };
  const byGroup = {};
  const byTrack = {};
  const rotDone = new Set();

  for (const o of Object.values(taken)) {
    for (const s of o.semesters) {
      if (o.rotation) {
        const key = `${o.rotation}_${s}`;
        if (!rotDone.has(key)) {
          rotDone.add(key);
          bySem[s] = (bySem[s] || 0) + o.credits;
        }
      } else {
        bySem[s] = (bySem[s] || 0) + o.credits;
      }
    }
    byGroup[o.group] = (byGroup[o.group] || 0) + o.credits;
    byTrack[o.track] = (byTrack[o.track] || 0) + o.credits;
  }

  const subjectTotal = Object.values(bySem).reduce((a, b) => a + b, 0);
  const ccaTotal = SEMESTERS.reduce((a, s) => a + (ccaMap[s] || DEFAULT_CCA[s] || 0), 0);

  const semSummary = {};
  for (const s of SEMESTERS) {
    semSummary[s] = bySem[s] + (ccaMap[s] || DEFAULT_CCA[s] || 0);
  }

  r.summary = {
    과목수: Object.keys(taken).length,
    교과학점: subjectTotal,
    창체학점: ccaTotal,
    총이수학점: subjectTotal + ccaTotal,
    학기별: semSummary,
    학기별_교과: { ...bySem },
    교과군별: byGroup,
    구분별: byTrack
  };

  // 3. 총량 및 졸업 요건
  const t = school.totals || {};
  if (t.subject_credits && subjectTotal !== t.subject_credits) {
    r.err("교과학점", `교과 이수 학점 ${subjectTotal} - ${t.subject_credits}학점이어야 합니다.`);
  }
  const total = subjectTotal + ccaTotal;
  if (t.graduation_credits && total !== t.graduation_credits) {
    r.err("졸업학점", `총 이수 학점 ${total} - 졸업 요건은 ${t.graduation_credits}학점입니다.`);
  }
  if (t.credits_per_semester) {
    for (const s of SEMESTERS) {
      const got = bySem[s] + (ccaMap[s] || DEFAULT_CCA[s] || 0);
      if (got !== t.credits_per_semester) {
        r.err("학기학점", `${s} 학기 ${got}학점 - ${t.credits_per_semester}학점이어야 합니다.`, { semester: s });
      }
    }
  }

  // 4. 교과군 필수 이수
  const alias = { 한국사: ["한국사1", "한국사2"] };
  for (const [g, need] of Object.entries(school.required_by_group || {})) {
    let got = 0;
    if (alias[g]) {
      for (const n of alias[g]) {
        if (taken[n]) got += taken[n].credits;
      }
    } else if (g === "사회") {
      for (const o of Object.values(taken)) {
        if (o.group.startsWith("사회") && !(alias["한국사"] || []).includes(o.name)) {
          got += o.credits;
        }
      }
    } else {
      for (const [grp, credits] of Object.entries(byGroup)) {
        if (grp === g || grp.startsWith(`${g}(`) || grp.startsWith(`${g}/`)) {
          got += credits;
        }
      }
    }
    if (got < need.required) {
      r.err("필수이수", `${g} 교과(군) ${got}학점 - 필수 이수 ${need.required}학점에 미달합니다.`, {
        group: g,
        got,
        required: need.required
      });
    }
  }

  // 5. 학교 고유 규칙
  for (const rule of (school.rules || [])) {
    const gs = rule.groups || [];
    const matchesGroup = grp => {
      for (const tg of gs) {
        if (grp === tg || grp.startsWith(`${tg}(`) || grp.startsWith(`${tg}/`)) return true;
      }
      return false;
    };

    if (rule.type === "max_credits") {
      let got = 0;
      if (rule.scope) {
        for (const o of Object.values(taken)) {
          if (matchesGroup(o.group) && o.track !== "학교지정") got += o.credits;
        }
      } else {
        for (const [grp, credits] of Object.entries(byGroup)) {
          if (matchesGroup(grp)) got += credits;
        }
      }
      if (got > rule.limit) {
        r.err(rule.id, `${rule.text} 현재 ${got}학점.`, { got, limit: rule.limit });
      }
    } else if (rule.type === "min_credits") {
      let got = 0;
      for (const [grp, credits] of Object.entries(byGroup)) {
        if (matchesGroup(grp)) got += credits;
      }
      if (got < rule.limit) {
        r.err(rule.id, `${rule.text} 현재 ${got}학점.`, { got, limit: rule.limit });
      }
    } else if (rule.type === "advisory") {
      r.warn(rule.id, rule.text);
    }
  }

  // 6. 위계 검증
  const order = {};
  SEMESTERS.forEach((s, idx) => { order[s] = idx; });

  for (const [n, o] of Object.entries(taken)) {
    for (const need of (PREREQ[n] || [])) {
      if (!taken[need]) {
        if (off[need]) {
          r.err("위계", `${n}을(를) 들으려면 ${need}을(를) 먼저 이수해야 합니다.`, {
            subject: n,
            prerequisite: need
          });
        } else {
          r.warn("위계", `${n}의 선수 과목 ${need}이(가) 이 학교에 개설되지 않습니다.`, {
            subject: n,
            prerequisite: need
          });
        }
        continue;
      }
      const a = Math.min(...taken[need].semesters.map(s => order[s]));
      const b = Math.min(...o.semesters.map(s => order[s]));
      if (a > b) {
        r.err(
          "배당표위계",
          `배당표 확인 필요 - 선수 과목 ${need}(${taken[need].semesters[0]})이(가) ${n}(${o.semesters[0]})보다 뒤에 편성돼 있습니다.`,
          { subject: n, prerequisite: need }
        );
      }
    }
  }

  // 7. 대학 권장과목 체크
  if (appendixData && targetUnit) {
    const { requirements = [], domainMap = {} } = appendixData;
    const cols = domainMap.columns || {};
    let matches = requirements.filter(x => (x.unit || "").includes(targetUnit));
    if (targetUniversity) {
      matches = matches.filter(x => (x.university || "").includes(targetUniversity));
    }
    const takenNames = new Set(Object.keys(taken));

    for (const entry of matches) {
      for (const [colName, val] of Object.entries(entry.subjects || {})) {
        if (val === true) {
          const colDef = cols[colName] || {};
          const allowed = [...(colDef.core || []), ...(colDef.related || [])];
          const hasTaken = allowed.some(s => takenNames.has(s));
          if (!hasTaken) {
            const needStr = (colDef.core && colDef.core.length > 0) ? colDef.core.join(", ") : colName;
            r.rec(
              "대학권장과목",
              `[${entry.university} ${entry.unit}] 2028 대입 반영(권장) '${colName}' 영역 과목(${needStr})이 이수 계획에 없습니다.`,
              { university: entry.university, unit: entry.unit, column: colName, suggested: allowed }
            );
          }
        } else if (typeof val === "string" && val.trim()) {
          r.rec(
            "대학특이사항",
            `[${entry.university} ${entry.unit}] 특이 권장사항: ${val}`,
            { university: entry.university, unit: entry.unit, detail: val }
          );
        }
      }
    }
  }

  return r.asDict();
}
