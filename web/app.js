/**
 * @file app.js - 학년별 집중 선택 및 기이수 과목 연동 컨트롤러
 */
import { validatePlan } from "./validator.js";

const state = {
  school: null,
  subjects: null,
  appendixRequirements: null,
  appendixDomainMap: null,
  majorSubjectMap: null,
  
  // 현재 학생 학년: 1 = 현재 1학년(2학년 과목 선택), 2 = 현재 2학년(3학년 과목 선택)
  currentStudentGrade: 1, 
  activeSemIdx: 0, // 0 = 당해 학년 1학기, 1 = 당해 학년 2학기
  
  picks: {}, // { gid: [과목명...] }
  completedGrade2Electives: ["기하", "물리학", "화학", "생명과학", "정보", "일본어", "역학과 에너지", "화학 반응의 세계", "세포와 물질대사", "동아시아 역사 기행", "인공지능 기초", "일본어 회화"], // 2학년 학생일 때 2학년 때 이수한 과목
  
  targetUnit: "기계공학",
  targetUni: "서울대"
};

const GROUP_COLORS = {
  국어: "bg-red-50 text-red-700 border-red-200",
  수학: "bg-blue-50 text-blue-700 border-blue-200",
  영어: "bg-amber-50 text-amber-700 border-amber-200",
  "사회(역사/도덕 포함)": "bg-emerald-50 text-emerald-700 border-emerald-200",
  사회: "bg-emerald-50 text-emerald-700 border-emerald-200",
  과학: "bg-cyan-50 text-cyan-700 border-cyan-200",
  체육: "bg-orange-50 text-orange-700 border-orange-200",
  예술: "bg-purple-50 text-purple-700 border-purple-200",
  "기술·가정/정보": "bg-indigo-50 text-indigo-700 border-indigo-200",
  "제2외국어/한문": "bg-pink-50 text-pink-700 border-pink-200",
  교양: "bg-slate-100 text-slate-700 border-slate-200"
};

async function init() {
  try {
    const [schoolRes, subjRes, appReqRes, appDomRes, mapRes] = await Promise.all([
      fetch("data/schools/금옥여자고등학교_2026.json").then(r => r.json()),
      fetch("data/subjects.json").then(r => r.json()),
      fetch("data/appendix_requirements.json").then(r => r.json()),
      fetch("data/appendix_domain_map.json").then(r => r.json()),
      fetch("data/major_subject_map.json").then(r => r.json())
    ]);

    state.school = schoolRes;
    state.subjects = subjRes;
    state.appendixRequirements = appReqRes;
    state.appendixDomainMap = appDomRes;
    state.majorSubjectMap = mapRes;

    // 선택군 초기화
    for (const g of (state.school.choice_groups || [])) {
      state.picks[g.id] = [];
    }

    setupEventListeners();
    renderCompletedElectivesList();
    renderChoiceGroups();
    updateValidation();
    updateTargetRecommendations();

  } catch (err) {
    console.error("데이터 로드 실패:", err);
  }
}

function setupEventListeners() {
  // 학년 스위처 버튼
  document.getElementById("mode-grade1").addEventListener("click", () => switchGradeMode(1));
  document.getElementById("mode-grade2").addEventListener("click", () => switchGradeMode(2));

  // 학기 탭 전환 (1학기 vs 2학기)
  document.querySelectorAll(".sem-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sem-btn").forEach(b => {
        b.classList.remove("bg-indigo-600", "text-white", "shadow-sm");
        b.classList.add("text-slate-600");
      });
      btn.classList.add("bg-indigo-600", "text-white", "shadow-sm");
      btn.classList.remove("text-slate-600");
      state.activeSemIdx = parseInt(btn.dataset.semIdx, 10);
      renderChoiceGroups();
    });
  });

  // 목표 전공/대학 적용
  document.getElementById("btn-apply-target").addEventListener("click", () => {
    state.targetUnit = document.getElementById("target-unit").value.trim();
    state.targetUni = document.getElementById("target-uni").value.trim();
    updateValidation();
    updateTargetRecommendations();
  });

  // 추천 과목 빠른 채우기
  document.getElementById("btn-quick-sample").addEventListener("click", fillSamplePicks);

  // 2학년 기이수 과목 아코디언 토글
  const completedHeader = document.getElementById("completed-toggle-btn");
  if (completedHeader) {
    completedHeader.addEventListener("click", () => {
      const list = document.getElementById("completed-list-container");
      const arrow = document.getElementById("completed-arrow");
      const isHidden = list.classList.toggle("hidden");
      arrow.className = isHidden ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
    });
  }
}

function switchGradeMode(studentGrade) {
  state.currentStudentGrade = studentGrade;
  state.activeSemIdx = 0;

  // 버튼 스타일
  const g1Btn = document.getElementById("mode-grade1");
  const g2Btn = document.getElementById("mode-grade2");
  if (studentGrade === 1) {
    g1Btn.className = "grade-mode-btn px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition bg-indigo-600 text-white shadow-sm";
    g2Btn.className = "grade-mode-btn px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition text-slate-600 hover:text-slate-900";
    document.getElementById("target-credit-label").textContent = "2학년 선택 과목 학점";
    document.getElementById("completed-electives-card").classList.add("hidden");
  } else {
    g2Btn.className = "grade-mode-btn px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition bg-indigo-600 text-white shadow-sm";
    g1Btn.className = "grade-mode-btn px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition text-slate-600 hover:text-slate-900";
    document.getElementById("target-credit-label").textContent = "3학년 선택 과목 학점";
    document.getElementById("completed-electives-card").classList.remove("hidden");
  }

  // 학기 탭 버튼 이름 업데이트
  const semNames = studentGrade === 1 ? ["2학년 1학기 (2-1)", "2학년 2학기 (2-2)"] : ["3학년 1학기 (3-1)", "3학년 2학기 (3-2)"];
  document.getElementById("sem-tab-1").textContent = semNames[0];
  document.getElementById("sem-tab-2").textContent = semNames[1];

  // 1학기 탭 활성화
  document.getElementById("sem-tab-1").click();

  renderChoiceGroups();
  updateValidation();
}

function getActiveSemester() {
  const grade = state.currentStudentGrade === 1 ? 2 : 3;
  return `${grade}-${state.activeSemIdx + 1}`;
}

function renderChoiceGroups() {
  const container = document.getElementById("choice-groups-container");
  container.innerHTML = "";

  const currentSem = getActiveSemester();

  // 1. 해당 학기 학교 지정 과목 바
  const designated = (state.school.offerings || []).filter(o => 
    o.track === "학교지정" && o.semesters.includes(currentSem)
  );

  const desigSummary = designated.map(o => o.name).join(", ");
  const desigCredits = designated.reduce((sum, o) => sum + o.credits, 0);

  const desigBanner = document.createElement("div");
  desigBanner.className = "p-3 bg-slate-200/70 border border-slate-300/80 rounded-xl text-xs flex items-center justify-between text-slate-700";
  desigBanner.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="font-bold text-slate-900">학교 지정 과목 (${desigCredits}학점):</span>
      <span class="text-slate-600">${desigSummary || '없음'}</span>
    </div>
    <span class="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border">자동 배정</span>
  `;
  container.appendChild(desigBanner);

  // 2. 해당 학기 선택군들만 렌더링
  const groups = (state.school.choice_groups || []).filter(g => g.semester === currentSem);

  for (const g of groups) {
    const sel = state.picks[g.id] || [];
    const isDone = sel.length === g.pick;

    const gBox = document.createElement("div");
    gBox.className = "bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col gap-3.5";
    gBox.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-amber-400'}"></span>
          <span class="font-bold text-xs md:text-sm text-slate-900">
            [${g.semester} 선택군] &middot; ${g.credits}학점 중 <strong class="text-indigo-600">택${g.pick}</strong>
          </span>
        </div>
        <span class="text-xs font-bold px-2.5 py-0.5 rounded-full ${isDone ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
          ${sel.length} / ${g.pick} 선택
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        ${g.members.map(mName => {
          const isSelected = sel.includes(mName);
          const off = (state.school.offerings || []).find(x => x.name === mName) || {};
          const grpColor = GROUP_COLORS[off.group] || "bg-slate-100 text-slate-600 border-slate-200";

          return `
            <div class="subj-card p-3 rounded-xl border-2 transition-all cursor-pointer select-none flex flex-col justify-between gap-2
                        ${isSelected ? 'border-indigo-600 bg-indigo-50/70 shadow-sm' : 'border-slate-200 hover:border-slate-300 bg-white'}"
                 data-group-id="${g.id}" data-subject="${mName}">
              <div class="flex items-start justify-between gap-1">
                <div>
                  <div class="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                    ${mName}
                    <button class="text-slate-400 hover:text-indigo-600 info-btn z-10" data-subj="${mName}">
                      <i class="fa-solid fa-circle-question"></i>
                    </button>
                  </div>
                  <span class="inline-block mt-1 text-[10px] px-2 py-0.5 rounded border font-medium ${grpColor}">
                    ${off.group || '일반'} &middot; ${off.type || '선택'}
                  </span>
                </div>
                <div class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                            ${isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-transparent'}">
                  <i class="fa-solid fa-check text-[10px]"></i>
                </div>
              </div>
              <div class="text-[10px] text-slate-400 border-t border-slate-100 pt-1 flex justify-between">
                <span>${off.credits || 3}학점</span>
                <span>${off.type === '진로' ? '성취도(A~C)' : '석차5등급'}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
    container.appendChild(gBox);
  }

  // 카드 클릭 이벤트
  container.querySelectorAll(".subj-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".info-btn")) return;
      toggleSelect(card.dataset.groupId, card.dataset.subject);
    });
  });

  // 과목 정보 버튼
  container.querySelectorAll(".info-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      previewSubject(btn.dataset.subj);
    });
  });
}

function toggleSelect(gid, subj) {
  const g = (state.school.choice_groups || []).find(x => x.id === gid);
  if (!g) return;

  const current = state.picks[gid] || [];
  if (current.includes(subj)) {
    state.picks[gid] = current.filter(x => x !== subj);
  } else {
    if (current.length >= g.pick) {
      current.shift(); // 꽉 차면 이전 것 1개 제거하고 새로 추가
    }
    current.push(subj);
    state.picks[gid] = current;
  }

  renderChoiceGroups();
  updateValidation();
}

function renderCompletedElectivesList() {
  const container = document.getElementById("completed-list-container");
  if (!container) return;
  container.innerHTML = "";

  // 2학년 선택과목 목록
  const grade2Members = new Set();
  (state.school.choice_groups || [])
    .filter(g => g.semester.startsWith("2-"))
    .forEach(g => g.members.forEach(m => grade2Members.add(m)));

  for (const name of Array.from(grade2Members).sort()) {
    const isChecked = state.completedGrade2Electives.includes(name);
    const label = document.createElement("label");
    label.className = `flex items-center gap-1.5 p-1.5 rounded-lg border cursor-pointer select-none text-[11px] transition ${
      isChecked ? "bg-indigo-100/70 border-indigo-300 font-bold text-indigo-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
    }`;
    label.innerHTML = `
      <input type="checkbox" class="completed-chk accent-indigo-600" value="${name}" ${isChecked ? "checked" : ""}>
      <span>${name}</span>
    `;
    container.appendChild(label);
  }

  document.getElementById("completed-count-badge").textContent = `${state.completedGrade2Electives.length}개 이수 완료`;

  container.querySelectorAll(".completed-chk").forEach(chk => {
    chk.addEventListener("change", e => {
      const val = e.target.value;
      if (e.target.checked) {
        if (!state.completedGrade2Electives.includes(val)) state.completedGrade2Electives.push(val);
      } else {
        state.completedGrade2Electives = state.completedGrade2Electives.filter(x => x !== val);
      }
      renderCompletedElectivesList();
      updateValidation();
    });
  });
}

function updateValidation() {
  const targetGrade = state.currentStudentGrade === 1 ? 2 : 3;
  const targetCredits = targetGrade === 2 ? 36 : 40;

  const appendixData = {
    requirements: state.appendixRequirements,
    domainMap: state.appendixDomainMap
  };

  const report = validatePlan(
    state.picks,
    state.school,
    appendixData,
    state.targetUnit,
    state.targetUni,
    targetGrade,
    state.completedGrade2Electives
  );

  // 상단 통계
  const chosenCredits = report.summary.선택과목학점 || 0;
  document.getElementById("stat-chosen-credits").textContent = `${chosenCredits} / ${targetCredits}학점`;

  // 상태 배지
  const pill = document.getElementById("status-pill");
  const badge = document.getElementById("err-badge");

  if (report.ok && chosenCredits === targetCredits) {
    pill.className = "px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 bg-emerald-100 text-emerald-800";
    pill.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> <span>선택 완료</span>`;
    badge.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
    badge.textContent = "정상 충족";
  } else {
    pill.className = "px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 bg-amber-100 text-amber-800";
    pill.innerHTML = `<i class="fa-solid fa-clock text-amber-600"></i> <span>선택 진행 중</span>`;
    badge.className = "text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800";
    badge.textContent = `${report.errors.length}건 확인 필요`;
  }

  // 메시지 박스
  const msgBox = document.getElementById("validation-messages");
  msgBox.innerHTML = "";

  if (report.errors.length === 0 && report.recommendations.length === 0) {
    msgBox.innerHTML = `<div class="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200">
      ${targetGrade}학년 선택 과목 규정 및 위계를 완벽히 만족합니다.
    </div>`;
  }

  // 에러
  report.errors.forEach(e => {
    const div = document.createElement("div");
    div.className = "p-2 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-start gap-1.5";
    div.innerHTML = `<i class="fa-solid fa-circle-xmark text-red-500 mt-0.5"></i> <div><strong>[${e.rule}]</strong> ${e.message}</div>`;
    msgBox.appendChild(div);
  });

  // 권장과목
  report.recommendations.forEach(r => {
    const div = document.createElement("div");
    div.className = "p-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 flex items-start gap-1.5";
    div.innerHTML = `<i class="fa-solid fa-lightbulb text-blue-500 mt-0.5"></i> <div><strong>[대입권장]</strong> ${r.message}</div>`;
    msgBox.appendChild(div);
  });
}

function updateTargetRecommendations() {
  const box = document.getElementById("target-recommendations");
  const unit = state.targetUnit;
  const uni = state.targetUni;

  const m2s = (state.majorSubjectMap && state.majorSubjectMap.major_to_subjects) || {};
  const related = m2s[unit] || m2s[`${unit}학과`] || {};

  const gen = (related.general || []).slice(0, 4).join(", ") || "대수, 물리학 등";
  const car = (related.career || []).slice(0, 4).join(", ") || "기하, 역학과 에너지 등";

  box.innerHTML = `
    <div class="space-y-1.5">
      <div class="font-bold text-indigo-900 flex items-center justify-between">
        <span>[${uni || '대학'} ${unit}] 핵심 추천</span>
      </div>
      <div class="text-slate-600 text-[11px]">
        <strong>일반선택:</strong> ${gen}<br>
        <strong>진로선택:</strong> ${car}
      </div>
      <p class="text-[10px] text-indigo-600 pt-1 border-t border-indigo-100">
        위계 주의: 2학년 '물리학' 이수 후 3학년 '전자기와 양자' 수강 가능
      </p>
    </div>
  `;
}

function previewSubject(subjName) {
  const detail = state.subjects[subjName];
  const pageEl = document.getElementById("preview-page");
  const contentEl = document.getElementById("preview-content");

  if (!detail) {
    pageEl.textContent = "";
    contentEl.textContent = `'${subjName}' 과목의 상세 안내서 정보가 없습니다.`;
    return;
  }

  pageEl.textContent = `안내서 p.${detail._source_page || '-'}`;
  const evalType = detail.eval && detail.eval.rank ? `${detail.eval.rank} 상대평가` : (detail.eval && detail.eval.achievement ? "성취평가" : "성취평가");

  contentEl.innerHTML = `
    <div>
      <div class="font-bold text-slate-900 text-xs flex justify-between items-center mb-1">
        <span>${detail.name}</span>
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 border text-slate-600">${evalType}</span>
      </div>
      <p class="text-[11px] text-slate-600 mb-2">${detail.one_liner || ''}</p>
      ${detail.keywords && detail.keywords.length > 0 ? `
        <div class="flex flex-wrap gap-1">
          ${detail.keywords.slice(0, 4).map(k => `<span class="bg-slate-100 text-slate-500 text-[9px] px-1.5 py-0.5 rounded">#${k}</span>`).join("")}
        </div>
      ` : ''}
    </div>
  `;
}

function fillSamplePicks() {
  if (state.currentStudentGrade === 1) {
    // 1학년 학생 -> 2학년 과목 36학점 채우기
    state.picks = {
      "g2-1-a": ["기하", "물리학", "화학", "생명과학"],
      "g2-1-b": ["정보"],
      "g2-1-c": ["일본어"],
      "g2-2-a": ["역학과 에너지", "화학 반응의 세계", "세포와 물질대사", "동아시아 역사 기행"],
      "g2-2-b": ["인공지능 기초"],
      "g2-2-c": ["일본어 회화"]
    };
  } else {
    // 2학년 학생 -> 3학년 과목 40학점 채우기
    state.picks = {
      "g3-1-a": ["미적분Ⅱ", "확률과 통계", "전자기와 양자", "물질과 에너지", "생물의 유전"],
      "g3-1-b": ["데이터 과학"],
      "g3-1-c": ["음악 연주와 창작"],
      "g3-2-a": ["실용 통계", "과학의 역사와 문화", "기후변화와 환경생태", "매체 의사소통", "심화 영어 독해와 작문"],
      "g3-2-b": ["창의 공학 설계"],
      "g3-2-c": ["음악 감상과 비평"]
    };
  }
  renderChoiceGroups();
  updateValidation();
}

window.addEventListener("DOMContentLoaded", init);
