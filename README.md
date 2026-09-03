# 선택 과목 안내서 → 구조화 데이터 파이프라인

『2026학년도 입학생을 위한 2022 개정 교육과정 선택 과목 안내서』(A3 2-up, 182시트 = 362쪽)를
AI 과목 선택 도우미 웹앱이 쓸 수 있는 JSON DB로 변환한다.

## 실행 순서

```bash
python pipeline/01_split.py 150        # A3 스프레드 → 낱쪽 텍스트 + 150dpi PNG
python pipeline/02_classify.py         # 낱쪽을 문서 유형별로 분류
export ANTHROPIC_API_KEY=...
python pipeline/03_extract.py subject --sync -n 3   # 표본 확인 (동기 호출)
python pipeline/03_extract.py subject              # 전체 (배치 API)
python pipeline/03_extract.py subject --collect <batch_id>
python pipeline/05_verify.py           # 원문 대조 자동 검수 → 사람이 볼 목록 축소
python pipeline/04_build.py            # web/data/*.json 런타임 산출물 생성
```

`subject` 자리에 `major`, `special`, `appendix` 를 넣어 나머지 단원도 같은 방식으로 돌린다.
이미 추출된 쪽은 자동으로 건너뛴다(`--redo` 로 재추출).

## 분류 결과 (362쪽)

| kind | 쪽 수 | 인쇄쪽 | 내용 |
|---|---|---|---|
| `subject` | 109 | 39~156 | 보통교과 과목 프로필 — 핵심 데이터 |
| `major` | 120 | 175~330 | 계열별 학과 안내 (관련 선택 과목 예시 포함) |
| `special` | 14 | 157~168 | 계열별 선택 과목 간략 안내 |
| `appendix` | 16 | 346~361 | 2028 계열별 반영(권장)과목 표 등 |
| `major_intro` | 20 | — | 계열 소개 / 관련 학과 목록 |
| `front` `group_map` | 31 | 12~37 | Ⅰ단원, 교과군 과목 지도 |
| `skip` | 32 | — | 간지 / 빈 쪽 |

## 산출물

```
data/pages/pNNN.txt      낱쪽 텍스트 (표 열 순서가 뒤섞일 수 있음)
data/pages/index.json    낱쪽 메타 (원본 시트/좌우/인쇄 쪽번호/분류)
data/images/pNNN.png     낱쪽 렌더 이미지 — 표 판독의 최종 근거
data/extracted/<kind>/pNNN.json   쪽 단위 추출 결과
web/data/*.json          웹앱이 로드하는 최종 DB
```

## 웹앱 연동 (2-tier)

- `subject_index.json` — 전 과목 요약. **시스템 프롬프트에 항상 올리고 prompt caching 적용.**
- `subjects.json` — 과목 상세. `get_subject_detail(ids[])` 툴로 필요한 것만 주입.
- `major_subject_map.json` — 학과↔과목 매핑. "○○학과 지망" → 후보 과목 좁히기에 사용.

**졸업 학점·필수 이수·선이수 조건 검증은 LLM이 아니라 코드로 한다.** (별도 validator)

## 추출 원칙

- 이미지 + 원시 텍스트를 함께 넘긴다. 원시 텍스트만으로는 표의 열이 뒤섞인다.
- 프롬프트는 "원문 그대로, 요약 금지, 추측 금지". 모든 레코드에 `_source_page` 를 남겨
  AI 답변이 안내서 쪽수를 근거로 댈 수 있게 한다.
- `05_verify.py` 가 원문 대조로 환각·색인글자 잔존·빈 필드를 잡아 사람 검수 대상을 줄인다.
