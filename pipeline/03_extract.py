# -*- coding: utf-8 -*-
"""낱쪽(이미지+텍스트)을 Claude에 넘겨 구조화 JSON으로 추출한다.

사용법
  python pipeline/03_extract.py subject            # 전체(배치 API, 권장)
  python pipeline/03_extract.py subject --sync -n 3  # 표본 3쪽만 동기 호출로 확인
  python pipeline/03_extract.py subject --collect <batch_id>  # 배치 결과 수거

환경변수 ANTHROPIC_API_KEY 필요. 이미 추출된 쪽은 건너뛴다.
"""
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    sys.exit("pip install anthropic 이 필요합니다.")

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "pages"
IMAGES = ROOT / "data" / "images"
PROMPTS = ROOT / "pipeline" / "prompts"
OUT = ROOT / "data" / "extracted"

MODEL = "claude-opus-5"
MAX_TOKENS = 8000


def targets(kind, limit=None, redo=False):
    idx = json.loads((PAGES / "index.json").read_text(encoding="utf-8"))
    out = OUT / kind
    out.mkdir(parents=True, exist_ok=True)
    sel = [x for x in idx if x["kind"] == kind]
    if not redo:
        sel = [x for x in sel if not (out / f"{x['name']}.json").exists()]
    return sel[:limit] if limit else sel


def build_content(kind, page):
    img = (IMAGES / f"{page['name']}.png").read_bytes()
    txt = (PAGES / f"{page['name']}.txt").read_text(encoding="utf-8")
    return [
        {"type": "image", "source": {"type": "base64",
                                     "media_type": "image/png",
                                     "data": base64.standard_b64encode(img).decode()}},
        {"type": "text", "text": f"<원시_텍스트 쪽='{page['printed_page']}'>\n{txt}\n</원시_텍스트>"},
        {"type": "text", "text": "위 쪽을 스키마대로 추출해 JSON 객체만 출력하라."},
    ]


def system_blocks(kind):
    # 프롬프트는 전 페이지 공통 -> 캐시 걸어 입력 비용을 줄인다.
    return [{"type": "text",
             "text": (PROMPTS / f"{kind}.md").read_text(encoding="utf-8"),
             "cache_control": {"type": "ephemeral"}}]


def parse_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return json.loads(text)


def save(kind, page, data):
    data["_source_page"] = page["printed_page"]
    data["_page_file"] = page["name"]
    (OUT / kind / f"{page['name']}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def run_sync(client, kind, pages):
    for p in pages:
        r = client.messages.create(
            model=MODEL, max_tokens=MAX_TOKENS,
            system=system_blocks(kind),
            messages=[{"role": "user", "content": build_content(kind, p)}])
        try:
            save(kind, p, parse_json(r.content[0].text))
            print(f"  OK   {p['name']} (p.{p['printed_page']})")
        except json.JSONDecodeError as e:
            print(f"  FAIL {p['name']}: {e}")
            (OUT / kind / f"{p['name']}.raw.txt").write_text(
                r.content[0].text, encoding="utf-8")


def run_batch(client, kind, pages):
    reqs = [{
        "custom_id": p["name"],
        "params": {"model": MODEL, "max_tokens": MAX_TOKENS,
                   "system": system_blocks(kind),
                   "messages": [{"role": "user",
                                 "content": build_content(kind, p)}]},
    } for p in pages]
    batch = client.messages.batches.create(requests=reqs)
    (OUT / f"{kind}.batch_id").write_text(batch.id, encoding="utf-8")
    print(f"배치 {len(reqs)}건 제출: {batch.id}")
    print(f"수거: python pipeline/03_extract.py {kind} --collect {batch.id}")


def collect(client, kind, batch_id):
    idx = {x["name"]: x for x in
           json.loads((PAGES / "index.json").read_text(encoding="utf-8"))}
    b = client.messages.batches.retrieve(batch_id)
    if b.processing_status != "ended":
        print(f"아직 처리 중: {b.processing_status} / {b.request_counts}")
        return
    ok = fail = 0
    for res in client.messages.batches.results(batch_id):
        name = res.custom_id
        if res.result.type != "succeeded":
            print(f"  ERR  {name}: {res.result.type}")
            fail += 1
            continue
        text = res.result.message.content[0].text
        try:
            save(kind, idx[name], parse_json(text))
            ok += 1
        except json.JSONDecodeError:
            (OUT / kind / f"{name}.raw.txt").write_text(text, encoding="utf-8")
            print(f"  JSON 파싱 실패 -> {name}.raw.txt")
            fail += 1
    print(f"수거 완료: 성공 {ok}, 실패 {fail}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["subject", "major", "special", "appendix"])
    ap.add_argument("--sync", action="store_true", help="배치 대신 동기 호출")
    ap.add_argument("-n", type=int, help="앞에서 N쪽만")
    ap.add_argument("--redo", action="store_true", help="이미 추출된 쪽도 다시")
    ap.add_argument("--collect", metavar="BATCH_ID")
    a = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY 환경변수를 설정하세요.")
    client = anthropic.Anthropic()

    if a.collect:
        return collect(client, a.kind, a.collect)

    pages = targets(a.kind, a.n, a.redo)
    if not pages:
        return print("추출할 쪽이 없습니다. (--redo 로 재추출)")
    print(f"{a.kind}: {len(pages)}쪽 대상")
    (run_sync if a.sync else run_batch)(client, a.kind, pages)


if __name__ == "__main__":
    main()
