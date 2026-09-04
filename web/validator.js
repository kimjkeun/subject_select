/**
 * @file validator.js - 브라우저 클라이언트 사이드 결정론적 교육과정 검증기
 * 대상 학년별 부분 선택 검증(targetGrade: 2 또는 3) 및 전체 검증을 모두 지원합니다.
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

/**
 * @param {Object} picks - 선택군ID: [선택과목명...]
 * @param {Object} school - 학교 프로필 json
 * @param {Object} appendixData - 대학 권장과목 데이터
 * @param {string} targetUnit - 지망 학과/학부
 * @param {string} targetUniversity - 지망 대학
 * @param {number|null} targetGrade - 대상 학년 (2: 1학년 학생이 2학년 과목 선택, 3: 2학년 학생이 3학년 과목 선택, null: 전학년)
 * @param {Array<string>} completedElectives - (3학년 선택 시) 2학년 때 이미 이수한 선택과목 목록
 */
export function validatePlan(
  picks,
  school,
  appendixData = null,
  targetUnit = null,
  targetUniversity = null,
  targetGrade = null,
  completedElectives = []
) {
  const r = new Report();
  const off = {};
  for (const o of school.offerings) {
    off[o.name] = o;
  }

  // 대상 그룹 필터링
  let activeGroups = school.choice_groups || [];
  if (targetGrade === 2) {
    activeGroups = activeGroups.filter(g => g.semester.startsWith("2-"));
  } else if (targetGrade === 3) {
    activeGroups = activeGroups.filter(g => g.semester.startsWith("3-"));
  }

  const groups = {};
  for (const g of activeGroups) {
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

  // 2. 이수 집계
  const taken = {};
  // 1학년 학교지정과목은 항상 포함
  for (const o of school.offerings) {
    if (o.track === "학교지정") {
      if (targetGrade === 2 && !o.semesters.some(s => s.startsWith("1-") || s.startsWith("2-"))) {
        continue; // 2학년 선택 시 3학년 지정과목은 제외
      }
      taken[o.name] = o;
    }
  }

  // 3학년 선택 모드인 경우: 2학년 기이수 과목 추가
  if (targetGrade === 3 && completedElectives && completedElectives.length > 0) {
    for (const name of completedElectives) {
      if (off[name]) taken[name] = off[name];
    }
  }

  // 이번에 선택한 과목 추가
  for (const name of chosen) {
    if (off[name]) taken[name] = off[name];
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

  // 선택한 학점만 계산
  let currentChosenCredits = 0;
  for (const name of chosen) {
    if (off[name]) currentChosenCredits += off[name].credits;
  }

  r.summary = {
    과목수: Object.keys(taken).length,
    선택과목학점: currentChosenCredits,
    교과학점: subjectTotal,
    창체학점: ccaTotal,
    총이수학점: subjectTotal + ccaTotal,
    학기별: semSummary,
    학기별_교과: { ...bySem },
    교과군별: byGroup,
    구분별: byTrack
  };

  // 3. 학년별 학점 검증
  const t = school.totals || {};
  if (targetGrade === 2) {
    // 2학년 선택과목 합계 검증 (금옥여고: 36학점)
    const requiredGrade2Electives = (t.elective_credits && t.elective_credits.grade2) || 36;
    if (currentChosenCredits !== requiredGrade2Electives) {
      const verb = currentChosenCredits < requiredGrade2Electives ? "부족" : "초과";
      r.err(
        "2학년선택학점",
        `2학년 선택과목은 총 ${requiredGrade2Electives}학점이어야 합니다. 현재 ${currentChosenCredits}학점으로 ${Math.abs(requiredGrade2Electives - currentChosenCredits)}학점 ${verb}합니다.`
      );
    }
  } else if (targetGrade === 3) {
    // 3학년 선택과목 합계 검증 (금옥여고: 40학점)
    const requiredGrade3Electives = (t.elective_credits && t.elective_credits.grade3) || 40;
    if (currentChosenCredits !== requiredGrade3Electives) {
      const verb = currentChosenCredits < requiredGrade3Electives ? "부족" : "초과";
      r.err(
        "3학년선택학점",
        `3학년 선택과목은 총 ${requiredGrade3Electives}학점이어야 합니다. 현재 ${currentChosenCredits}학점으로 ${Math.abs(requiredGrade3Electives - currentChosenCredits)}학점 ${verb}합니다.`
      );
    }
  } else {
    // 전학년 모드
    if (t.subject_credits && subjectTotal !== t.subject_credits) {
      r.err("교과학점", `교과 이수 학점 ${subjectTotal} - ${t.subject_credits}학점이어야 합니다.`);
    }
    const total = subjectTotal + ccaTotal;
    if (t.graduation_credits && total !== t.graduation_credits) {
      r.err("졸업학점", `총 이수 학점 ${total} - 졸업 요건은 ${t.graduation_credits}학점입니다.`);
    }
  }

  // 4. 국수영 선택 한도 검증 (2·3학년 통틀어 25학점 이하)
  const korMathEngGroups = ["국어", "수학", "영어"];
  const matchesKME = grp => korMathEngGroups.some(tg => grp === tg || grp.startsWith(`${tg}(`) || grp.startsWith(`${tg}/`));
  let kmeElectiveCredits = 0;
  for (const o of Object.values(taken)) {
    if (matchesKME(o.group) && o.track !== "학교지정") {
      kmeElectiveCredits += o.credits;
    }
  }

  if (targetGrade === 2 && kmeElectiveCredits > 25) {
    r.err("국수영-선택-총량", `2학년 국수영 선택과목은 25학점을 초과할 수 없습니다. 현재 ${kmeElectiveCredits}학점.`);
  } else if (targetGrade === 3 && kmeElectiveCredits > 25) {
    r.err("국수영-선택-총량", `2, 3학년 누적 국수영 선택과목은 25학점 이하여야 합니다. 현재(2학년 기이수 포함) ${kmeElectiveCredits}학점.`);
  }

  // 5. 위계 검증
  const order = {};
  SEMESTERS.forEach((s, idx) => { order[s] = idx; });

  for (const [n, o] of Object.entries(taken)) {
    // 이번 학년에 듣는 과목들에 대해 위계 검사
    if (!chosen.includes(n)) continue;

    for (const need of (PREREQ[n] || [])) {
      if (!taken[need]) {
        if (off[need]) {
          r.err("위계", `${n}을(를) 들으려면 선수 과목 '${need}'을(를) 먼저 이수해야 합니다.`, {
            subject: n,
            prerequisite: need
          });
        } else {
          r.warn("위계", `${n}의 선수 과목 '${need}'이(가) 학교에 개설되지 않습니다.`, {
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
          "위계역전",
          `선수 과목 '${need}'(${taken[need].semesters[0]})이(가) 후속 과목 '${n}'(${o.semesters[0]})보다 뒤 학기에 놓여 있습니다.`,
          { subject: n, prerequisite: need }
        );
      }
    }
  }

  // 6. 대학 권장과목 체크
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
              `[${entry.university} ${entry.unit}] 2028 대입 반영(권장) '${colName}' 영역 과목(${needStr})이 아직 이수 계획에 없습니다.`,
              { university: entry.university, unit: entry.unit, column: colName, suggested: allowed }
            );
          }
        }
      }
    }
  }

  return r.asDict();
}
