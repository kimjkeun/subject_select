/**
 * @file app.js - 카테고리별 과목 그룹화, 메인 탭 네비게이션, 목표 대학/권장과목 뷰어
 */
import { validatePlan } from "./validator.js";

const state = {
  school: null,
  subjects: null,
  subjectIndex: null,
  appendixRequirements: null,
  appendixDomainMap: null,
  majorSubjectMap: null,
  
  activeTab: "select", // "select" | "target" | "handbook"
  currentStudentGrade: 1, // 1 = 현재 1학년 (2학년 과목 선택), 2 = 현재 2학년 (3학년 과목 선택)
  activeSemIdx: 0, // 0 = 1학기, 1 = 2학기
  
  picks: {}, // { gid: [과목명...] }
  completedGrade2Electives: ["기하", "물리학", "화학", "생명과학", "정보", "일본어", "역학과 에너지", "화학 반응의 세계", "세포와 물질대사", "동아시아 역사 기행", "인공지능 기초", "일본어 회화"],
  
  targetUnit: "기계공학",
  targetUni: "서울대"
};

// 교과군별 배지 및 스타일 매핑
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

// 교과군 순서 정의 (수학/과학/사회/국어/영어/기타)
const GROUP_ORDER = [
  "수학", "과학", "국어", "영어", 
  "사회(역사/도덕 포함)", "사회", 
  "기술·가정/정보", "제2외국어/한문", "예술", "체육", "교양"
];

async function init() {
  try {
    const [schoolRes, subjRes, sIdxRes, appReqRes, appDomRes, mapRes] = await Promise.all([
      fetch("data/schools/금옥여자고등학교_2026.json").then(r => r.json()),
      fetch("data/subjects.json").then(r => r.json()),
      fetch("data/subject_index.json").then(r => r.json()),
      fetch("data/appendix_requirements.json").then(r => r.json()),
      fetch("data/appendix_domain_map.json").then(r => r.json()),
      fetch("data/major_subject_map.json").then(r => r.json())
    ]);

    state.school = schoolRes;
    state.subjects = subjRes;
    state.subjectIndex = sIdxRes;
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
    updateTargetView();
    renderHandbookGrid();

  } catch (err) {
    console.error("데이터 로드 실패:", err);
  }
}

function setupEventListeners() {
  // 메인 탭 전환
  document.querySelectorAll(".main-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchMainTab(tab);
    });
  });

  // 목표 상세 바로가기 버튼
  const goTargetBtn = document.getElementById("btn-go-target-tab");
  if (goTargetBtn) {
    goTargetBtn.addEventListener("click", () => switchMainTab("target"));
  }

  // 학년 스위처
  document.getElementById("mode-grade1").addEventListener("click", () => switchGradeMode(1));
  document.getElementById("mode-grade2").addEventListener("click", () => switchGradeMode(2));

  // 학기 탭 (1학기 vs 2학기)
  document.querySelectorAll(".sem-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sem-btn").forEach(b => {
        b.classList.remove("bg-indigo-600", "text-white", "shadow-xs");
        b.classList.add("text-slate-600");
      });
      btn.classList.add("bg-indigo-600", "text-white", "shadow-xs");
      btn.classList.remove("text-slate-600");
      state.activeSemIdx = parseInt(btn.dataset.semIdx, 10);
      renderChoiceGroups();
    });
  });

  // 추천 과목 빠른 채우기
  document.getElementById("btn-quick-sample").addEventListener("click", fillSamplePicks);

  // 목표 저장 및 적용 (TAB 2)
  document.getElementById("btn-save-target").addEventListener("click", () => {
    state.targetUnit = document.getElementById("select-target-unit").value;
    state.targetUni = document.getElementById("input-target-uni").value.trim();
    updateTargetView();
    updateValidation();
    // 상단 칩 갱신
    document.getElementById("target-summary-chip").textContent = `${state.targetUni || '대학'} ${state.targetUnit}`;
    document.getElementById("quick-target-label").textContent = `목표: ${state.targetUni || '대학'} ${state.targetUnit}`;
  });

  // 2학년 기이수 과목 접이식 토글
  const completedHeader = document.getElementById("completed-toggle-btn");
  if (completedHeader) {
    completedHeader.addEventListener("click", () => {
      const list = document.getElementById("completed-list-container");
      const arrow = document.getElementById("completed-arrow");
      const isHidden = list.classList.toggle("hidden");
      arrow.className = isHidden ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
    });
  }

  // 과목 사전 검색 입력
  const searchInput = document.getElementById("search-subject-input");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      renderHandbookGrid(e.target.value);
    });
  }
}

function switchMainTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll(".main-nav-btn").forEach(b => {
    b.classList.remove("bg-white", "text-indigo-600", "shadow-xs");
    b.classList.add("text-slate-600");
  });
  const activeBtn = document.querySelector(`.main-nav-btn[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add("bg-white", "text-indigo-600", "shadow-xs");
    activeBtn.classList.remove("text-slate-600");
  }

  document.getElementById("view-select").classList.toggle("hidden", tabName !== "select");
  document.getElementById("view-target").classList.toggle("hidden", tabName !== "target");
  document.getElementById("view-handbook").classList.toggle("hidden", tabName !== "handbook");
}

function switchGradeMode(studentGrade) {
  state.currentStudentGrade = studentGrade;
  state.activeSemIdx = 0;

  const g1Btn = document.getElementById("mode-grade1");
  const g2Btn = document.getElementById("mode-grade2");
  if (studentGrade === 1) {
    g1Btn.className = "grade-mode-btn px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition bg-indigo-600 text-white shadow-xs";
    g2Btn.className = "grade-mode-btn px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition text-slate-600 hover:text-slate-900";
    document.getElementById("target-credit-label").textContent = "2학년 선택 과목 학점";
    document.getElementById("completed-electives-card").classList.add("hidden");
  } else {
    g2Btn.className = "grade-mode-btn px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition bg-indigo-600 text-white shadow-xs";
    g1Btn.className = "grade-mode-btn px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition text-slate-600 hover:text-slate-900";
    document.getElementById("target-credit-label").textContent = "3학년 선택 과목 학점";
    document.getElementById("completed-electives-card").classList.remove("hidden");
  }

  const semNames = studentGrade === 1 
    ? ["2학년 1학기 (2-1)", "2학년 2학기 (2-2)"] 
    : ["3학년 1학기 (3-1)", "3학년 2학기 (3-2)"];

  document.getElementById("sem-tab-1").querySelector("span").textContent = semNames[0];
  document.getElementById("sem-tab-2").querySelector("span").textContent = semNames[1];

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

  document.getElementById("designated-list").textContent = desigSummary || "없음";
  document.getElementById("designated-credits").textContent = `${desigCredits}학점 자동 배정`;

  // 2. 해당 학기 선택군들
  const groups = (state.school.choice_groups || []).filter(g => g.semester === currentSem);

  for (const g of groups) {
    const sel = state.picks[g.id] || [];
    const isDone = sel.length === g.pick;

    const gBox = document.createElement("div");
    gBox.className = "bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col gap-4";

    // 선택군 헤더
    const headerHtml = `
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-amber-400'}"></span>
          <div>
            <span class="font-extrabold text-xs md:text-sm text-slate-900">
              [${g.semester} 선택군] &middot; ${g.credits}학점 중 <strong class="text-indigo-600 font-black">택${g.pick}</strong>
            </span>
            <span class="text-[11px] text-slate-400 block sm:inline sm:ml-2">
              (교과군별 분류를 확인하여 희망 전공에 맞게 균형 있게 선택하세요)
            </span>
          </div>
        </div>
        <span class="text-xs font-black px-3 py-1 rounded-full ${isDone ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
          ${sel.length} / ${g.pick} 선택
        </span>
      </div>
    `;

    // 과목들을 교과군(수학, 과학, 사회, 국어, 영어 등)별로 카테고리화
    const byCategory = {};
    for (const mName of g.members) {
      const off = (state.school.offerings || []).find(x => x.name === mName) || {};
      const cat = off.group || "기타";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(mName);
    }

    // 정렬된 교과군 순서로 렌더링
    const sortedCats = Object.keys(byCategory).sort((a, b) => {
      const idxA = GROUP_ORDER.indexOf(a);
      const idxB = GROUP_ORDER.indexOf(b);
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
    });

    let categoriesHtml = `<div class="flex flex-col gap-4">`;

    for (const catName of sortedCats) {
      const memberNames = byCategory[catName];
      const catColor = GROUP_COLORS[catName] || "bg-slate-100 text-slate-700 border-slate-200";

      categoriesHtml += `
        <div class="category-block bg-slate-50/70 border border-slate-200/80 rounded-xl p-3">
          <div class="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-200/60">
            <span class="text-[11px] font-extrabold px-2 py-0.5 rounded border ${catColor}">
              ${catName} 교과군 (${memberNames.length}과목)
            </span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            ${memberNames.map(mName => {
              const isSelected = sel.includes(mName);
              const off = (state.school.offerings || []).find(x => x.name === mName) || {};

              return `
                <div class="subj-card p-2.5 rounded-xl border-2 transition-all cursor-pointer select-none flex flex-col justify-between gap-1.5
                            ${isSelected ? 'border-indigo-600 bg-white shadow-xs ring-2 ring-indigo-200/70' : 'border-slate-200 hover:border-slate-300 bg-white'}"
                     data-group-id="${g.id}" data-subject="${mName}">
                  <div class="flex items-start justify-between gap-1">
                    <div>
                      <div class="font-extrabold text-slate-900 text-xs flex items-center gap-1">
                        ${mName}
                        <button class="text-slate-400 hover:text-indigo-600 info-btn z-10" data-subj="${mName}">
                          <i class="fa-solid fa-circle-question"></i>
                        </button>
                      </div>
                      <span class="text-[10px] text-slate-500 mt-0.5 block">
                        ${off.type || '선택'} &middot; ${off.credits || 3}학점
                      </span>
                    </div>
                    <div class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5
                                ${isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-transparent'}">
                      <i class="fa-solid fa-check"></i>
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }
    categoriesHtml += `</div>`;

    gBox.innerHTML = headerHtml + categoriesHtml;
    container.appendChild(gBox);
  }

  // 카드 클릭
  container.querySelectorAll(".subj-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".info-btn")) return;
      toggleSelect(card.dataset.groupId, card.dataset.subject);
    });
  });

  // 과목 정보 모달
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
      current.shift();
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

  const grade2Members = new Set();
  (state.school.choice_groups || [])
    .filter(g => g.semester.startsWith("2-"))
    .forEach(g => g.members.forEach(m => grade2Members.add(m)));

  for (const name of Array.from(grade2Members).sort()) {
    const isChecked = state.completedGrade2Electives.includes(name);
    const label = document.createElement("label");
    label.className = `flex items-center gap-1.5 p-1.5 rounded-lg border cursor-pointer select-none text-[11px] transition ${
      isChecked ? "bg-indigo-100/80 border-indigo-300 font-bold text-indigo-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
    }`;
    label.innerHTML = `
      <input type="checkbox" class="completed-chk accent-indigo-600" value="${name}" ${isChecked ? "checked" : ""}>
      <span>${name}</span>
    `;
    container.appendChild(label);
  }

  document.getElementById("completed-count-badge").textContent = `${state.completedGrade2Electives.length}개 완료`;

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

  const chosenCredits = report.summary.선택과목학점 || 0;
  document.getElementById("stat-chosen-credits").textContent = `${chosenCredits} / ${targetCredits}학점`;

  const pill = document.getElementById("status-pill");
  const badge = document.getElementById("err-badge");

  if (report.ok && chosenCredits === targetCredits) {
    pill.className = "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 bg-emerald-100 text-emerald-800";
    pill.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> <span>선택 완료</span>`;
    badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
    badge.textContent = "정상 충족";
  } else {
    pill.className = "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 bg-amber-100 text-amber-800";
    pill.innerHTML = `<i class="fa-solid fa-clock text-amber-600"></i> <span>선택 진행 중</span>`;
    badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800";
    badge.textContent = `${report.errors.length}건 확인 필요`;
  }

  const msgBox = document.getElementById("validation-messages");
  msgBox.innerHTML = "";

  if (report.errors.length === 0 && report.recommendations.length === 0) {
    msgBox.innerHTML = `<div class="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs">
      ${targetGrade}학년 선택 과목 규정 및 위계를 완벽히 충족합니다.
    </div>`;
  }

  report.errors.forEach(e => {
    const div = document.createElement("div");
    div.className = "p-2 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-start gap-1.5";
    div.innerHTML = `<i class="fa-solid fa-circle-xmark text-red-500 mt-0.5"></i> <div><strong>[${e.rule}]</strong> ${e.message}</div>`;
    msgBox.appendChild(div);
  });

  report.recommendations.forEach(r => {
    const div = document.createElement("div");
    div.className = "p-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 flex items-start gap-1.5";
    div.innerHTML = `<i class="fa-solid fa-lightbulb text-blue-500 mt-0.5"></i> <div><strong>[대입권장]</strong> ${r.message}</div>`;
    msgBox.appendChild(div);
  });
}

function updateTargetView() {
  const unit = state.targetUnit;
  const uni = state.targetUni;

  // 1. 우측 미니 요약 업데이트
  const quickBox = document.getElementById("quick-target-summary");
  const m2s = (state.majorSubjectMap && state.majorSubjectMap.major_to_subjects) || {};
  const related = m2s[unit] || m2s[`${unit}학과`] || {};

  const gen = (related.general || []).slice(0, 3).join(", ") || "대수, 물리학 등";
  const car = (related.career || []).slice(0, 3).join(", ") || "기하, 역학과 에너지 등";

  if (quickBox) {
    quickBox.innerHTML = `
      <div class="text-[11px] text-slate-700 space-y-1">
        <div><strong>일반선택 추천:</strong> ${gen}</div>
        <div><strong>진로선택 추천:</strong> ${car}</div>
        <div class="text-[10px] text-indigo-600 pt-1 font-semibold border-t border-indigo-100">
          💡 '목표 대학 & 권장과목' 탭에서 대학별 반영 표를 확인하세요.
        </div>
      </div>
    `;
  }

  // 2. TAB 2의 상세 테이블 및 학과 가이드 렌더링
  const tableContainer = document.getElementById("target-uni-table-container");
  if (!tableContainer) return;

  const reqs = (state.appendixRequirements || []).filter(r => (r.unit || "").includes(unit));
  const filtered = uni ? reqs.filter(r => (r.university || "").includes(uni)) : reqs;

  if (filtered.length === 0) {
    tableContainer.innerHTML = `<p class="p-4 text-center text-slate-400">일치하는 대학 권장과목 정보가 없습니다.</p>`;
  } else {
    tableContainer.innerHTML = `
      <table class="w-full border-collapse border border-slate-200 text-left">
        <thead>
          <tr class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
            <th class="p-2 border-r border-slate-200">대학교</th>
            <th class="p-2 border-r border-slate-200">모집단위</th>
            <th class="p-2">2028 반영 / 권장 과목</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(entry => {
            const list = [];
            for (const [subj, val] of Object.entries(entry.subjects || {})) {
              if (val === true) list.push(`<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[10px]">${subj}</span>`);
              else if (typeof val === "string" && val.trim()) list.push(`<span class="text-[10px] text-amber-700">(${val})</span>`);
            }
            return `
              <tr class="border-b border-slate-100 hover:bg-slate-50/50">
                <td class="p-2 font-bold text-slate-900 border-r border-slate-200">${entry.university}</td>
                <td class="p-2 text-slate-600 border-r border-slate-200">${entry.unit}</td>
                <td class="p-2 flex flex-wrap gap-1">${list.join("") || '<span class="text-slate-400">지정 과목 없음</span>'}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  // 안내서 공식 선택 과목 예시
  const handbookBox = document.getElementById("target-major-handbook-box");
  if (handbookBox) {
    handbookBox.innerHTML = `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-1.5">
        <span class="font-bold text-slate-900 text-xs text-indigo-700">[일반 선택 과목]</span>
        <p class="text-slate-600 text-[11px]">${(related.general || []).join(", ") || "내용 없음"}</p>
      </div>
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-1.5">
        <span class="font-bold text-slate-900 text-xs text-purple-700">[진로 선택 과목]</span>
        <p class="text-slate-600 text-[11px]">${(related.career || []).join(", ") || "내용 없음"}</p>
      </div>
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-1.5">
        <span class="font-bold text-slate-900 text-xs text-emerald-700">[융합 선택 과목]</span>
        <p class="text-slate-600 text-[11px]">${(related.fusion || []).join(", ") || "내용 없음"}</p>
      </div>
    `;
  }
}

function renderHandbookGrid(query = "") {
  const grid = document.getElementById("handbook-grid");
  if (!grid || !state.subjectIndex) return;
  grid.innerHTML = "";

  const q = query.trim().toLowerCase();
  const list = state.subjectIndex.filter(s => {
    if (!q) return true;
    return s.id.toLowerCase().includes(q) || 
           (s.group || "").toLowerCase().includes(q) || 
           (s.one_liner || "").toLowerCase().includes(q) ||
           (s.keywords || []).some(k => k.toLowerCase().includes(q));
  });

  grid.innerHTML = list.map(s => {
    const grpColor = GROUP_COLORS[s.group] || "bg-slate-100 text-slate-700 border-slate-200";
    return `
      <div class="p-3 bg-white rounded-xl border border-slate-200 flex flex-col justify-between gap-2 hover:border-indigo-300 transition">
        <div>
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-900 text-xs">${s.id}</h4>
            <span class="text-[9px] px-1.5 py-0.5 rounded border ${grpColor}">${s.group}</span>
          </div>
          <p class="text-[10px] text-slate-500 mt-1 leading-relaxed line-clamp-2">${s.one_liner || ''}</p>
        </div>
        <div class="flex items-center justify-between text-[9px] text-slate-400 pt-1 border-t border-slate-100">
          <span>${s.type} &middot; ${s.credits}</span>
          <span>안내서 p.${s.page || '-'}</span>
        </div>
      </div>
    `;
  }).join("");
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
  const csatBadge = detail.csat_2029 ? "2028 수능 출제" : "수능 미출제";

  contentEl.innerHTML = `
    <div>
      <div class="font-extrabold text-slate-900 text-xs flex justify-between items-center mb-1">
        <span>${detail.name}</span>
        <div class="flex gap-1">
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 border text-slate-600">${evalType}</span>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">${csatBadge}</span>
        </div>
      </div>
      <p class="text-[11px] text-slate-600 mb-2 leading-relaxed">${detail.one_liner || ''}</p>
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
    state.picks = {
      "g2-1-a": ["기하", "물리학", "화학", "생명과학"],
      "g2-1-b": ["정보"],
      "g2-1-c": ["일본어"],
      "g2-2-a": ["역학과 에너지", "화학 반응의 세계", "세포와 물질대사", "동아시아 역사 기행"],
      "g2-2-b": ["인공지능 기초"],
      "g2-2-c": ["일본어 회화"]
    };
  } else {
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
