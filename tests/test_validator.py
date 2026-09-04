# -*- coding: utf-8 -*-
"""검증기(validator) 단위 테스트 모음.

학교별 교육과정 규칙 검증, 위계 검증, 중복/선택개수 검증,
대학 권장과목 체크 등 전 영역을 검증한다.
"""
import unittest
from engine.validator import load_school, validate, Report


class TestValidator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.school = load_school("금옥여자고등학교_2026")

        # 정상 자연/공학 트랙
        cls.valid_picks_stem = {
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
            "g3-2-c": ["음악 감상과 비평"],
        }

        # 정상 인문/사회 트랙
        cls.valid_picks_humanities = {
            "g2-1-a": ["주제 탐구 독서", "한국지리 탐구", "사회와 문화", "현대사회와 윤리"],
            "g2-1-b": ["기술·가정"],
            "g2-1-c": ["일본어"],
            "g2-2-a": ["문학과 영상", "영어 발표와 토론", "세계시민과 지리", "경제"],
            "g2-2-b": ["생활과학 탐구"],
            "g2-2-c": ["일본어 회화"],
            "g3-1-a": ["언어생활 탐구", "심화 영어", "세계사", "법과 사회", "사회문제 탐구"],
            "g3-1-b": ["아동발달과 부모"],
            "g3-1-c": ["음악 연주와 창작"],
            "g3-2-a": ["매체 의사소통", "여행지리", "국가 유산의 이해와 활용", "금융과 경제생활", "윤리문제 탐구"],
            "g3-2-b": ["소프트웨어와 생활"],
            "g3-2-c": ["음악 감상과 비평"],
        }

    def test_valid_plan_passes(self):
        """정상 이수 계획은 ok == True여야 함."""
        res = validate(self.valid_picks_stem, self.school)
        self.assertTrue(res["ok"], f"정상 계획 실패: {res['errors']}")
        self.assertEqual(res["summary"]["총이수학점"], 192)
        self.assertEqual(res["summary"]["교과학점"], 174)
        self.assertEqual(res["summary"]["창체학점"], 18)

    def test_duplicate_pick_error(self):
        """동일 그룹 내 중복 과목 선택 시 오류 발생."""
        bad_picks = dict(self.valid_picks_stem)
        bad_picks["g2-1-a"] = ["기하", "물리학", "화학", "화학"]  # 화학 중복
        res = validate(bad_picks, self.school)
        self.assertFalse(res["ok"])
        rules = [e["rule"] for e in res["errors"]]
        self.assertIn("중복선택", rules)

    def test_outside_group_pick_error(self):
        """해당 선택군에 편성되지 않은 과목 선택 시 오류 발생."""
        bad_picks = dict(self.valid_picks_stem)
        bad_picks["g2-1-b"] = ["물리학"]  # g2-1-b는 기술가정/정보군
        res = validate(bad_picks, self.school)
        self.assertFalse(res["ok"])
        rules = [e["rule"] for e in res["errors"]]
        self.assertIn("그룹밖선택", rules)

    def test_pick_count_mismatch(self):
        """선택 과목 수 미달 또는 초과 시 오류 발생."""
        bad_picks = dict(self.valid_picks_stem)
        bad_picks["g2-1-a"] = ["기하", "물리학", "화학"]  # 택4인데 3개만 선택
        res = validate(bad_picks, self.school)
        self.assertFalse(res["ok"])
        rules = [e["rule"] for e in res["errors"]]
        self.assertIn("선택개수", rules)

    def test_prerequisite_violation(self):
        """선수 과목(위계) 미이수 시 오류 발생 (예: 물리학 없이 역학과 에너지 선택)."""
        bad_picks = dict(self.valid_picks_stem)
        # 물리학 대신 주제 탐구 독서 선택
        bad_picks["g2-1-a"] = ["기하", "주제 탐구 독서", "화학", "생명과학"]
        # g2-2-a에 '역학과 에너지'가 있으므로 물리학 선수 이수 위반
        res = validate(bad_picks, self.school)
        self.assertFalse(res["ok"])
        rules = [e["rule"] for e in res["errors"]]
        self.assertIn("위계", rules)

    def test_korean_math_eng_total_limit(self):
        """국수영 선택 총량 한도(25학점) 초과 시 오류 발생."""
        bad_picks = dict(self.valid_picks_humanities)
        # g2-1-a: 주제탐구독서(국어 3)
        # g2-2-a: 문학과영상(국어 3), 영어발표와토론(영어 3)
        # g3-1-a: 언어생활탐구(국어 3), 심화영어(영어 3), 미적분Ⅱ(수학 3), 확률과통계(수학 3)
        # g3-2-a: 매체의사소통(국어 3), 심화영어독해와작문(영어 3), 실용통계(수학 3), 수학과문화(수학 3) -> 총 33학점
        bad_picks["g3-1-a"] = ["언어생활 탐구", "심화 영어", "미적분Ⅱ", "확률과 통계", "세계사"]
        bad_picks["g3-2-a"] = ["매체 의사소통", "심화 영어 독해와 작문", "실용 통계", "수학과 문화", "여행지리"]
        res = validate(bad_picks, self.school)
        self.assertFalse(res["ok"])
        rules = [e["rule"] for e in res["errors"]]
        self.assertIn("국수영-선택-총량", rules)

    def test_target_recommendation_check(self):
        """지망 대학/모집단위의 권장과목 누락 시 recommendation 리포트 생성."""
        # 인문계열 과목 조합으로 서울대 기계공학을 지망하면 미적분Ⅱ, 물리학, 기하 권장이 뜸
        res = validate(self.valid_picks_humanities, self.school, target_unit="기계공학", target_university="서울대")
        self.assertTrue(res["ok"])  # 학교 졸업요건 자체는 통과
        recs = [r["rule"] for r in res.get("recommendations", [])]
        self.assertIn("대학권장과목", recs)
        cols = [r.get("column") for r in res.get("recommendations", [])]
        self.assertIn("물리학", cols)
        self.assertIn("미적분Ⅱ", cols)
        self.assertIn("기하", cols)


if __name__ == "__main__":
    unittest.main()
