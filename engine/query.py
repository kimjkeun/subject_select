# -*- coding: utf-8 -*-
"""교육과정 및 과목/학과 상담 질의 엔진.

3계층 아키텍처의 1계층(색인)과 2계층(도구 호출/상세 조회)을 제공합니다.
AI 상담 에이전트는 이 툴들을 호출하여 필요한 사실 정보만을 가져와 상담을 진행합니다.
"""
import json
from pathlib import Path
from typing import List, Dict, Any, Optional

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "data"


class QueryEngine:
    def __init__(self):
        self._subjects = None
        self._subject_index = None
        self._majors = None
        self._major_index = None
        self._major_subject_map = None
        self._special_subjects = None
        self._appendix_requirements = None
        self._appendix_domain_map = None

    def _load(self, filename: str):
        p = WEB / filename
        if not p.exists():
            return {}
        return json.loads(p.read_text(encoding="utf-8"))

    @property
    def subjects(self) -> Dict[str, Any]:
        if self._subjects is None:
            self._subjects = self._load("subjects.json")
        return self._subjects

    @property
    def subject_index(self) -> List[Dict[str, Any]]:
        if self._subject_index is None:
            self._subject_index = self._load("subject_index.json")
        return self._subject_index

    @property
    def majors(self) -> Dict[str, Any]:
        if self._majors is None:
            self._majors = self._load("majors.json")
        return self._majors

    @property
    def major_index(self) -> List[Dict[str, Any]]:
        if self._major_index is None:
            self._major_index = self._load("major_index.json")
        return self._major_index

    @property
    def major_subject_map(self) -> Dict[str, Any]:
        if self._major_subject_map is None:
            self._major_subject_map = self._load("major_subject_map.json")
        return self._major_subject_map

    @property
    def special_subjects(self) -> Dict[str, Any]:
        if self._special_subjects is None:
            self._special_subjects = self._load("special_subjects.json")
        return self._special_subjects

    @property
    def appendix_requirements(self) -> List[Dict[str, Any]]:
        if self._appendix_requirements is None:
            self._appendix_requirements = self._load("appendix_requirements.json")
        return self._appendix_requirements

    @property
    def appendix_domain_map(self) -> Dict[str, Any]:
        if self._appendix_domain_map is None:
            self._appendix_domain_map = self._load("appendix_domain_map.json")
        return self._appendix_domain_map

    # -------------------------------------------------------------
    # 1. 과목 관련 도구 (Subject Tools)
    # -------------------------------------------------------------
    def get_subject_detail(self, names: List[str]) -> Dict[str, Any]:
        """과목명의 상세 정보(개념, 활동, 평가방식, 2028수능여부, 출처쪽수)를 반환합니다."""
        results = {}
        for name in names:
            if name in self.subjects:
                results[name] = self.subjects[name]
            elif name in self.special_subjects:
                results[name] = {
                    "is_special": True,
                    **self.special_subjects[name]
                }
        return results

    def search_subjects(self, query: str, group: Optional[str] = None) -> List[Dict[str, Any]]:
        """키워드나 교과군으로 과목 색인을 검색합니다."""
        q = query.strip().lower()
        matched = []
        for s in self.subject_index:
            if group and s.get("group") != group:
                continue
            name = s.get("id", "").lower()
            one_liner = (s.get("one_liner") or "").lower()
            keywords = [k.lower() for k in s.get("keywords", [])]
            if q in name or q in one_liner or any(q in k for k in keywords):
                matched.append(s)
        return matched

    # -------------------------------------------------------------
    # 2. 학과 관련 도구 (Major Tools)
    # -------------------------------------------------------------
    def get_major_detail(self, name: str) -> Optional[Dict[str, Any]]:
        """학과의 상세 정보(소개, 추천학생, 주요전공교과목, 개설대학, 관련선택과목)를 반환합니다."""
        # Exact match or substring match
        if name in self.majors:
            return self.majors[name]
        for m_name, m in self.majors.items():
            if name in m_name or m_name in name:
                return m
        return None

    def search_majors(self, query: str) -> List[Dict[str, Any]]:
        """학과명 또는 요약 키워드로 학과 색인을 검색합니다."""
        q = query.strip().lower()
        matched = []
        for m in self.major_index:
            m_id = m.get("id", "").lower()
            summary = (m.get("summary") or "").lower()
            if q in m_id or q in summary:
                matched.append(m)
        return matched

    def get_major_recommended_subjects(self, major_name: str) -> Dict[str, Any]:
        """학과 안내서에 명시된 '관련 고등학교 선택 과목 예시'를 일반/진로/융합 선택별로 조회합니다."""
        m2s = self.major_subject_map.get("major_to_subjects", {})
        if major_name in m2s:
            return {
                "major": major_name,
                "related_subjects": m2s[major_name]
            }
        for m_name, subjects in m2s.items():
            if major_name in m_name or m_name in major_name:
                return {
                    "major": m_name,
                    "related_subjects": subjects
                }
        return {"major": major_name, "related_subjects": {}}

    # -------------------------------------------------------------
    # 3. 대학/부록 반영과목 도구 (University Appendix Tools)
    # -------------------------------------------------------------
    def get_university_requirements(self, target_unit: str, university: Optional[str] = None) -> List[Dict[str, Any]]:
        """2028 대입 전형에서 해당 모집단위/대학이 요구하거나 권장하는 과목 표를 조회합니다."""
        matches = [r for r in self.appendix_requirements if target_unit in r.get("unit", "")]
        if university:
            matches = [r for r in matches if university in r.get("university", "")]
        return matches

    def get_tools_definition(self) -> List[Dict[str, Any]]:
        """LLM(OpenAI/Claude/Gemini) function call/tool schemas."""
        return [
            {
                "name": "get_subject_detail",
                "description": "선택 과목의 단원, 핵심 개념, 학습 활동, 평가 방식(석차등급 산출 여부), 출처 페이지 등 상세 정보를 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "names": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "조회할 과목명 목록 (예: ['물리학', '미적분Ⅱ', '경제'])"
                        }
                    },
                    "required": ["names"]
                }
            },
            {
                "name": "get_major_detail",
                "description": "학과의 소개, 이런 학생에게 추천, 주요 전공 과목, 개설 대학, 관련 선택 과목 등 상세 정보를 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "학과명 (예: '경영학과', '컴퓨터공학과', '의예과')"
                        }
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "get_major_recommended_subjects",
                "description": "지망 학과와 연계된 고등학교 일반선택, 진로선택, 융합선택 과목 목록을 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "major_name": {
                            "type": "string",
                            "description": "학과명 (예: '기계공학과')"
                        }
                    },
                    "required": ["major_name"]
                }
            },
            {
                "name": "get_university_requirements",
                "description": "2028 대입 전형에서 대학 및 대표 모집단위가 반영/권장하는 수학, 과학, 사회 등의 과목 조건을 조회합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target_unit": {
                            "type": "string",
                            "description": "모집단위 (예: '기계공학', '경영', '의예', '컴퓨터공학', '약학')"
                        },
                        "university": {
                            "type": "string",
                            "description": "대학명 (선택 사항, 예: '서울대', '고려대')"
                        }
                    },
                    "required": ["target_unit"]
                }
            },
            {
                "name": "validate_student_plan",
                "description": "학생이 고른 과목 편성안이 학교의 교육과정 편성표 규정(총 이수 학점, 교과군 최소이수, 국수영 한도, 선수과목 위계 등)을 만족하는지 코드 엔진으로 검증합니다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "picks": {
                            "type": "object",
                            "description": "선택군ID별 학생이 선택한 과목 목록 (예: {'g2-1-a': ['기하', '물리학', '화학', '생명과학']})"
                        },
                        "school_slug": {
                            "type": "string",
                            "description": "학교 프로필 슬러그 (기본값: '금옥여자고등학교_2026')"
                        },
                        "target_unit": {
                            "type": "string",
                            "description": "학생 지망 모집단위/학부 (선택)"
                        },
                        "target_university": {
                            "type": "string",
                            "description": "학생 지망 대학교 (선택)"
                        }
                    },
                    "required": ["picks"]
                }
            }
        ]
