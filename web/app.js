/**
 * @file app.js - 과목 선택 인터페이스 및 실시간 검증 반응형 컨트롤러
 */
import { validatePlan } from "./validator.js";

// 상태 저장소
const state = {
  school: null,
  subjects: null,
  appendixRequirements: null,
  appendixDomainMap: null,
  majorSubjectMap: null,
  activeSem: "1-1",
  picks: {}, // { gid: [과목명, ...] }
  targetUnit: "기계공학",
  targetUni: "서울대"
};

// 교과군별 배지 색상 매핑
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

// 초기 데이터 로드
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

    // 기본 타겟 셋팅
    document.getElementById("target-unit").value = state.targetUnit;
    document.getElementById("target-uni").value = state.targetUni;

    // 이벤트 리스너 등록
    setupEventListeners();

    // 초기 렌더링
    renderSemesterTabs();
    renderSemesterContent();
    updateValidation();

  } catch (err) {
    console.error("데이터 로드 실패:", err);
    document.getElementById("sem-content-container").innerHTML = `
      <div class="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">
        데이터를 불러오지 못했습니다. 로컬 서버(예: python -m http.server 8000) 환경에서 실행해주세요.
      </div>`;
  }
}

function setupEventListeners() {
  // 학기 탭 전환
  document.querySelectorAll(".sem-tab-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      document.querySelectorAll(".sem-tab-btn").forEach(b => {
        b.classList.remove("active", "bg-indigo-600", "text-white");
        b.classList.add("text-slate-600");
      });
      btn.classList.add("active", "bg-indigo-600", "text-white");
      btn.classList.remove("text-slate-600");
      state.activeSem = btn.dataset.sem;
      renderSemesterContent();
    });
  });

  // 목표 대학/학과 설정
  document.getElementById("btn-apply-target").addEventListener("click", () => {
    state.targetUnit = document.getElementById("target-unit").value.trim();
    state.targetUni = document.getElementById("target-uni").value.trim();
    updateValidation();
    updateAiAdvice();
  });

  // 샘플 자동 채우기 (공학 계열)
  document.getElementById("btn-quick-fill").addEventListener("click", () => {
    state.picks = {
      "g2-1-a": ["기하", "물리학", "화학", "생명과학"],
      "g2-1-b": ["정보"],
      "g2-1-c": ["일본어"],
      "g2-2-a": ["역학과 에너지", "화학 반응의 세계", "세포와 물질대사", "동아시아 역사 기행"],
      "g2-2-b": ["인공지능 기초"],
      "g2-2-c": ["일본어 회화"],
      "g3-1-a": ["미적분Ⅱ", "확률과 통계", "전자기와 양자", "물질과 에너지", "생물의 유전"],
      "g3-1-b": ["데이터 과학"],
      "g3-1-c": ["음악 연주와 창작"],
      "g3-2-a": ["실용 통계", "과학의 역사와 문화", "기후변화와 환경생태", "매체 의사소통", "심화 영어 독해와 작문"],
      "g3-2-b": ["창의 공학 설계"],
      "g3-2-c": ["음악 감상과 비평"]
    };
    renderSemesterContent();
    updateValidation();
    updateAiAdvice();
  });

  // 초기화
  document.getElementById("btn-reset").addEventListener("click", () => {
    for (const gid of Object.keys(state.picks)) {
      state.picks[gid] = [];
    }
    renderSemesterContent();
    updateValidation();
    updateAiAdvice();
  });

  // AI 챗봇 질문
  document.getElementById("btn-ask-ai").addEventListener("click", handleAiAsk);
  document.getElementById("ai-chat-input").addEventListener("keypress", e => {
    if (e.key === "Enter") handleAiAsk();
  });
}

function renderSemesterTabs() {
  const activeBtn = document.querySelector(`.sem-tab-btn[data-sem="${state.activeSem}"]`);
  if (activeBtn) {
    activeBtn.classList.add("bg-indigo-600", "text-white");
    activeBtn.classList.remove("text-slate-600");
  }
}

function renderSemesterContent() {
  const container = document.getElementById("sem-content-container");
  container.innerHTML = "";

  const currentSem = state.activeSem;

  // 1. 학교 지정 과목 목록
  const designated = state.school.offerings.filter(o => 
    o.track === "학교지정" && o.semesters.includes(currentSem)
  );

  const desigCard = document.createElement("div");
  desigCard.className = "bg-white rounded-xl shadow-sm border border-slate-200 p-5";
  desigCard.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
        <h3 class="font-bold text-slate-800 text-sm">학교 지정 과목 (자동 편성)</h3>
      </div>
      <span class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md font-medium">
        ${designated.reduce((acc, cur) => acc + cur.credits, 0)}학점
      </span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      ${designated.map(o => `
        <div class="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
              ${o.name}
              <button class="text-slate-400 hover:text-indigo-600 info-btn" data-subj="${o.name}">
                <i class="fa-solid fa-circle-question"></i>
              </button>
            </div>
            <div class="text-[11px] text-slate-500 mt-0.5">${o.group} &middot; ${o.type}</div>
          </div>
          <span class="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
            ${o.credits}학점
          </span>
        </div>
      `).join("")}
    </div>
  `;
  container.appendChild(desigCard);

  // 2. 학생 선택군(택N) 렌더링
  const groups = (state.school.choice_groups || []).filter(g => g.semester === currentSem);

  if (groups.length === 0) {
    const noChoice = document.createElement("div");
    noChoice.className = "p-6 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs";
    noChoice.textContent = "1학년은 모든 과목이 학교 지정으로 운영되며 별도 학생 선택군이 없습니다.";
    container.appendChild(noChoice);
  } else {
    for (const g of groups) {
      const gCard = document.createElement("div");
      gCard.className = "bg-white rounded-xl shadow-sm border border-slate-200 p-5";
      const selCount = (state.picks[g.id] || []).length;
      const isComplete = selCount === g.pick;

      gCard.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${isComplete ? 'bg-emerald-500' : 'bg-amber-400'}"></span>
            <h3 class="font-bold text-slate-800 text-sm">
              선택군 [${g.id.toUpperCase()}] &mdash; ${g.credits}학점 중 <span class="text-indigo-600">택${g.pick}</span>
            </h3>
          </div>
          <span class="text-xs font-bold px-2.5 py-1 rounded-md ${isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
            선택: ${selCount} / ${g.pick}
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          ${g.members.map(mName => {
            const isSelected = (state.picks[g.id] || []).includes(mName);
            const offInfo = state.school.offerings.find(x => x.name === mName) || {};
            const grpColor = GROUP_COLORS[offInfo.group] || "bg-slate-100 text-slate-700 border-slate-200";

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
                      ${offInfo.group || '일반'} &middot; ${offInfo.type || '선택'}
                    </span>
                  </div>
                  <div class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                              ${isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-transparent'}">
                    <i class="fa-solid fa-check text-[10px]"></i>
                  </div>
                </div>
                <div class="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-100">
                  <span>${offInfo.credits || 3}학점</span>
                  <span class="text-[10px] text-slate-500">${offInfo.choice_group || ''}</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
      container.appendChild(gCard);
    }
  }

  // 카드 클릭 이벤트 핸들러
  container.querySelectorAll(".subj-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".info-btn")) return; // 안내 버튼 클릭 제외
      const gid = card.dataset.groupId;
      const subj = card.dataset.subject;
      toggleSelect(gid, subj);
    });
  });

  // 과목 안내 모달/상세 이벤트 핸들러
  container.querySelectorAll(".info-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      showSubjectDetail(btn.dataset.subj);
    });
  });
}

function toggleSelect(gid, subj) {
  const g = (state.school.choice_groups || []).find(x => x.id === gid);
  if (!g) return;

  const list = state.picks[gid] || [];
  if (list.includes(subj)) {
    state.picks[gid] = list.filter(x => x !== subj);
  } else {
    if (list.length >= g.pick) {
      // 이미 꽉 찬 경우 첫 번째 것 빼고 교체
      list.shift();
    }
    list.push(subj);
    state.picks[gid] = list;
  }

  renderSemesterContent();
  updateValidation();
  updateAiAdvice();
}

function updateValidation() {
  const appendixData = {
    requirements: state.appendixRequirements,
    domainMap: state.appendixDomainMap
  };

  const report = validatePlan(state.picks, state.school, appendixData, state.targetUnit, state.targetUni);

  // 1. 상태 바 수치 갱신
  const s = report.summary;
  document.getElementById("stat-total").textContent = `${s.총이수학점 || 0} / 192`;
  document.getElementById("stat-subject").textContent = `${s.교과학점 || 0} / 174`;

  // 학기별 미니 바
  for (const sem of ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"]) {
    const el = document.getElementById(`sem-bar-${sem}`);
    if (el) {
      const credits = (s.학기별 && s.학기별[sem]) || 0;
      el.querySelector("span").textContent = credits;
      if (credits === 32) {
        el.className = "p-1 bg-emerald-50 rounded border border-emerald-300 text-emerald-800";
      } else {
        el.className = "p-1 bg-slate-100 rounded border border-slate-200 text-slate-600";
      }
    }
  }

  // 상단 상태 배지
  const badge = document.getElementById("status-badge");
  if (report.ok && report.errors.length === 0 && (s.총이수학점 === 192)) {
    badge.className = "px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1.5 bg-emerald-500 text-white";
    badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>편성 통과 (192학점 충족)</span>`;
  } else {
    badge.className = "px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1.5 bg-amber-400 text-slate-900";
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${report.errors.length}건 보완 필요</span>`;
  }

  // 검증 리포트 박스 렌더링
  const box = document.getElementById("validation-report-box");
  box.innerHTML = "";

  document.getElementById("err-count-badge").textContent = `${report.errors.length}건의 위반`;

  if (report.errors.length === 0 && report.recommendations.length === 0) {
    box.innerHTML = `<div class="p-3 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200">
      모든 졸업 요건, 과목군 최소 이수학점, 선수과목 위계 규정을 완벽히 충족합니다.
    </div>`;
  }

  // 오류 렌더링
  report.errors.forEach(e => {
    const item = document.createElement("div");
    item.className = "p-2.5 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-start gap-2";
    item.innerHTML = `<i class="fa-solid fa-circle-xmark mt-0.5 text-red-500"></i> <div><span class="font-bold">[${e.rule}]</span> ${e.message}</div>`;
    box.appendChild(item);
  });

  // 대학 권장과목 제안 렌더링
  report.recommendations.forEach(r => {
    const item = document.createElement("div");
    item.className = "p-2.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 flex items-start gap-2";
    item.innerHTML = `<i class="fa-solid fa-lightbulb mt-0.5 text-blue-500"></i> <div><span class="font-bold">[권장]</span> ${r.message}</div>`;
    box.appendChild(item);
  });

  // 안내 및 경고 렌더링
  report.warnings.forEach(w => {
    const item = document.createElement("div");
    item.className = "p-2.5 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 flex items-start gap-2";
    item.innerHTML = `<i class="fa-solid fa-circle-info mt-0.5 text-amber-500"></i> <div><span class="font-bold">[유의]</span> ${w.message}</div>`;
    box.appendChild(item);
  });
}

function showSubjectDetail(subjName) {
  const card = document.getElementById("subject-detail-card");
  const detail = state.subjects[subjName];
  const pageEl = document.getElementById("detail-page");
  const contentEl = document.getElementById("detail-content");

  if (!detail) {
    pageEl.textContent = "정보 없음";
    contentEl.innerHTML = `<p class="text-slate-500">'${subjName}' 과목의 상세 안내서 정보가 등록되어 있지 않습니다.</p>`;
    return;
  }

  pageEl.textContent = `안내서 p.${detail._source_page || '-'}`;

  const evalInfo = detail.eval || {};
  const evalBadge = evalInfo.rank ? `${evalInfo.rank} 상대평가` : (evalInfo.achievement || "성취평가");
  const csatBadge = detail.csat_2029 ? "2028 수능 출제 과목" : "수능 미출제";

  contentEl.innerHTML = `
    <div class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-900 text-sm">${detail.name}</span>
        <div class="flex gap-1">
          <span class="px-2 py-0.5 rounded bg-slate-100 border text-[10px] text-slate-600">${evalBadge}</span>
          <span class="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-700">${csatBadge}</span>
        </div>
      </div>
      <p class="text-slate-600 text-[11px] leading-relaxed">${detail.one_liner || ''}</p>
      
      ${detail.units && detail.units.length > 0 ? `
        <div class="mt-1">
          <span class="font-bold text-slate-700 text-[11px]">핵심 개념 및 단원:</span>
          <ul class="list-disc list-inside text-slate-500 text-[10px] mt-0.5">
            ${detail.units.slice(0, 2).map(u => `<li>${u.concepts || u.area}</li>`).join("")}
          </ul>
        </div>
      ` : ''}

      ${detail.keywords && detail.keywords.length > 0 ? `
        <div class="flex flex-wrap gap-1 mt-1">
          ${detail.keywords.map(k => `<span class="bg-slate-100 text-slate-600 text-[9px] px-1.5 py-0.5 rounded">#${k}</span>`).join("")}
        </div>
      ` : ''}
    </div>
  `;
}

function updateAiAdvice() {
  const box = document.getElementById("ai-advice-box");
  const unit = state.targetUnit;
  const uni = state.targetUni;

  const m2s = (state.majorSubjectMap && state.majorSubjectMap.major_to_subjects) || {};
  const related = m2s[unit] || m2s[`${unit}학과`] || {};

  const gen = (related.general || []).slice(0, 4).join(", ");
  const car = (related.career || []).slice(0, 4).join(", ");

  box.innerHTML = `
    <div class="space-y-1.5">
      <div class="font-semibold text-indigo-950 flex items-center gap-1.5">
        <span>🎯 [${uni || '전체'} ${unit}] 맞춤 진로 가이드</span>
      </div>
      <p class="text-[11px] text-slate-600">
        안내서 기준 <strong>${unit}</strong> 전공에 추천되는 핵심 과목은 
        일반선택(${gen || '대수, 물리학 등'}), 진로선택(${car || '기하, 역학과 에너지 등'})입니다.
      </p>
      <p class="text-[11px] text-slate-500">
        💡 <strong>팁:</strong> 2학년 때 '대수'와 '물리학'을 선수 이수해야 3학년 때 '미적분Ⅱ'와 '역학과 에너지'를 수강할 수 있습니다.
      </p>
    </div>
  `;
}

function handleAiAsk() {
  const input = document.getElementById("ai-chat-input");
  const query = input.value.trim();
  if (!query) return;

  const box = document.getElementById("ai-advice-box");
  box.innerHTML = `
    <div class="flex items-center gap-2 text-indigo-600 py-2">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>상담 엔진에서 교육과정 지침을 검색 중입니다...</span>
    </div>
  `;

  setTimeout(() => {
    let reply = "";
    if (query.includes("물리") || query.includes("기계") || query.includes("공학")) {
      reply = `<strong>기계/전자/컴퓨터 공학</strong> 계열은 대학에서 물리학 및 미적분을 매우 중요하게 평가합니다. 2-1학기에 <strong>물리학</strong>을 이수하지 않으면 2-2학기 <strong>역학과 에너지</strong>나 3학년 <strong>전자기와 양자</strong>를 위계 규정상 수강할 수 없으므로 반드시 2-1 선택군에서 물리학을 확보하는 것을 추천합니다.`;
    } else if (query.includes("경영") || query.includes("경제") || query.includes("사회")) {
      reply = `<strong>경영·경제 계열</strong>은 2028 대입에서 <strong>확률과 통계</strong> 및 <strong>미적분Ⅰ</strong>을 핵심 권장과목으로 두고 있습니다. 또한 금옥여고 2-2 선택군에서 <strong>경제</strong>, 3-2학기 <strong>금융과 경제생활</strong>을 추천합니다.`;
    } else {
      reply = `학생의 질문 [${query}]에 대해 검토했습니다. 지망 모집단위(${state.targetUnit})와 고교학점제 이수 요건에 맞추어, 2학년 때는 기초 일반선택(국수영/탐구)을 튼튼히 다지고 3학년 때 진로·융합 선택으로 심화시키는 로드맵이 가장 이상적입니다.`;
    }

    box.innerHTML = `
      <div class="space-y-1.5">
        <div class="font-semibold text-indigo-950">🤖 상담 답변</div>
        <p class="text-[11px] text-slate-700 leading-relaxed">${reply}</p>
      </div>
    `;
    input.value = "";
  }, 400);
}

// 시작
window.addEventListener("DOMContentLoaded", init);
