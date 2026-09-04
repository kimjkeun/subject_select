# -*- coding: utf-8 -*-
"""AI 과목 선택 상담 에이전트 인터페이스.

3계층 아키텍처 연계:
  1계층: 전 과목/학과 색인을 시스템 프롬프트(캐시)로 주입
  2계층: 과목/학과 상세 및 부록 권장과목을 도구(Tool Calling)로 조회
  3계층: 학생 이수 계획의 제약 조건 검증은 결정론적 코드(Validator)가 판정

학생 인생이 걸린 과목 이수/졸업 요건 숫자는 LLM이 환각하지 않고 코드가 보장하며,
AI는 공감, 진로 연계 이유 설명, 대안 제안을 담당합니다.
"""
import json
from typing import Dict, Any, List, Optional
from engine.query import QueryEngine
from engine.validator import load_school, validate, explain


class SubjectAdvisor:
    def __init__(self, school_slug: str = "금옥여자고등학교_2026"):
        self.query_engine = QueryEngine()
        self.school_slug = school_slug
        self.school = load_school(school_slug)

    def get_system_prompt(self) -> str:
        """1계층: 시스템 프롬프트에 전 과목 및 학과 색인 요약을 주입합니다."""
        subject_summary = []
        for s in self.query_engine.subject_index:
            subject_summary.append(
                f"- {s['id']} [{s.get('group')}/{s.get('type')}, {s.get('credits')}]: {s.get('one_liner', '')} (키워드: {', '.join(s.get('keywords', [])[:4])})"
            )
        subjects_text = "\n".join(subject_summary)

        prompt = f"""너는 고등학교 학생들의 2022 개정 교육과정 선택 과목 이수 계획을 지도하는 전문 진로·진학 AI 상담 교사다.
현재 상담 대상 학교는 '{self.school.get('school', '고등학교')}'(2026학년도 입학생 기준)이다.

[상담 원칙 및 지침]
1. 근거 기반 상담: 모든 조언은 『선택 과목 안내서』 및 학교 교육과정 학점 배당표에 근거해야 한다.
   - 필요 시 도구(`get_subject_detail`, `get_major_detail`, `get_major_recommended_subjects`, `get_university_requirements`)를 호출하여 상세 정보와 출처 쪽수(`page`)를 확인하고 학생에게 쪽수를 함께 안내하라.
2. 규칙 검증은 코드로 판정: 학생의 학점 수, 졸업 요건, 필수 이수 학점, 선수 과목 위계(예: 대수 미이수 후 미적분Ⅰ 수강 불가) 등은 절대로 네가 임의로 숫자를 계산하여 보증하지 말고, 반드시 `validate_student_plan` 도구를 호출하여 판정받아라.
3. 친절하고 구체적인 설명: 검증 결과에 오류(Error)나 대학 권장과목 누락이 있다면 "왜 이것이 문제가 되는지", "몇 학년 몇 학기에 어떤 과목을 대신 선택하면 좋은지" 현실적인 대안을 제시하라.
4. 평가 방식 안내: 과목별로 5등급 상대평가(석차등급 산출)인지, 성취평가(A~E 또는 A~C 절대평가)인지 학생의 입시 유불리 관점에서 균형 있게 조언하라.

[전체 과목 색인 지도 (109과목)]
{subjects_text}
"""
        return prompt

    def execute_tool(self, tool_name: str, args: Dict[str, Any]) -> Any:
        """2계층/3계층 도구 호출 디스패처."""
        if tool_name == "get_subject_detail":
            return self.query_engine.get_subject_detail(args.get("names", []))
        elif tool_name == "get_major_detail":
            return self.query_engine.get_major_detail(args.get("name", ""))
        elif tool_name == "get_major_recommended_subjects":
            return self.query_engine.get_major_recommended_subjects(args.get("major_name", ""))
        elif tool_name == "get_university_requirements":
            return self.query_engine.get_university_requirements(
                args.get("target_unit", ""),
                args.get("university")
            )
        elif tool_name == "validate_student_plan":
            slug = args.get("school_slug", self.school_slug)
            school = load_school(slug)
            res = validate(
                picks=args.get("picks", {}),
                school=school,
                target_unit=args.get("target_unit"),
                target_university=args.get("target_university")
            )
            return {
                "validation_result": res,
                "text_summary": explain(res)
            }
        else:
            return {"error": f"Unknown tool: {tool_name}"}

    def consult(self, user_query: str, current_picks: Optional[Dict[str, List[str]]] = None, target_unit: Optional[str] = None, target_university: Optional[str] = None) -> Dict[str, Any]:
        """학생 질문에 대해 초기 맥락(지망 학과 추천과목, 현재 이수 계획 검증 리포트)을 자동으로 구성해 반환하는 상담 컨텍스트 빌더."""
        context = {}
        
        # 지망 학과가 언급되었거나 지정된 경우
        if target_unit:
            context["major_recommendations"] = self.query_engine.get_major_recommended_subjects(target_unit)
            context["university_requirements"] = self.query_engine.get_university_requirements(target_unit, target_university)
            
        # 현재 선택안이 제공된 경우 검증 리포트 자동 첨부
        if current_picks:
            val_res = validate(current_picks, self.school, target_unit=target_unit, target_university=target_university)
            context["validation"] = val_res
            context["validation_summary"] = explain(val_res)

        return {
            "query": user_query,
            "school": self.school.get("school"),
            "context": context,
            "tools": self.query_engine.get_tools_definition()
        }
