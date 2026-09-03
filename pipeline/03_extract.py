# -*- coding: utf-8 -*-
"""낱쪽(이미지+텍스트)을 분할하여 구조화 JSON으로 추출한다.

사용법
  python pipeline/03_extract.py subject --chunk 1/4 --agent agy      # 나(Gemini)가 1/4 처리
  python pipeline/03_extract.py subject --chunk 2/4 --agent agy      # 나(Gemini)가 2/4 처리
  python pipeline/03_extract.py subject --chunk 3/4 --agent codex    # Codex CLI가 3/4 처리
  python pipeline/03_extract.py subject --chunk 4/4 --agent grok     # Grok CLI가 4/4 처리
"""
import argparse
import base64
import json
import os
import re
import shutil
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "data" / "pages"
IMAGES = ROOT / "data" / "images"
PROMPTS = ROOT / "pipeline" / "prompts"
OUT = ROOT / "data" / "extracted"

def get_chunk(lst, i, n):
    size = len(lst) / n
    start = int(round((i - 1) * size))
    end = int(round(i * size))
    return lst[start:end]

def targets(kind, limit=None, redo=False, chunk=None):
    idx = json.loads((PAGES / "index.json").read_text(encoding="utf-8"))
    out = OUT / kind
    out.mkdir(parents=True, exist_ok=True)
    sel = [x for x in idx if x["kind"] == kind]
    if not redo:
        sel = [x for x in sel if not (out / f"{x['name']}.json").exists()]
    
    if chunk:
        i, n = map(int, chunk.split('/'))
        sel = get_chunk(sel, i, n)
        
    return sel[:limit] if limit else sel

def parse_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        idx1 = text.find("{")
        idx2 = text.rfind("}")
        if idx1 != -1 and idx2 != -1:
            try:
                return json.loads(text[idx1:idx2+1])
            except json.JSONDecodeError:
                pass
        raise

def save(kind, page, data):
    data["_source_page"] = page["printed_page"]
    data["_page_file"] = page["name"]
    (OUT / kind / f"{page['name']}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def run_cli_agent(agent, kind, pages):
    sys_prompt = (PROMPTS / f"{kind}.md").read_text(encoding="utf-8")
    print(f"[{agent}] {len(pages)}개 페이지 처리 시작...")
    
    for p in pages:
        img_path = str(IMAGES / f"{p['name']}.png")
        txt_path = str(PAGES / f"{p['name']}.txt")
        txt_content = Path(txt_path).read_text(encoding="utf-8")
        
        user_prompt = f"<원시_텍스트 쪽='{p['printed_page']}'>\n{txt_content}\n</원시_텍스트>\n\n위 쪽을 스키마대로 추출해 JSON 객체만 출력하라."
        full_prompt = f"System Instruction:\n{sys_prompt}\n\nUser:\n{user_prompt}"
        
        print(f"[{agent}] Processing {p['name']} (p.{p['printed_page']})...")
        
        agent_path = shutil.which(agent) or agent
        if agent.lower() == "codex":
            # Stream the multiline prompt through stdin: Windows .cmd shims can
            # otherwise truncate it, and -- ends the variadic image arguments.
            cmd = [agent_path, "exec", "--image", img_path, "--", "-"]
            run_input = full_prompt
        else:
            cmd = [agent_path, full_prompt, "--file", img_path]
            run_input = None
        
        try:
            result = subprocess.run(cmd, input=run_input, capture_output=True,
                                    text=True, encoding="utf-8")
            if result.returncode != 0:
                print(f"  FAIL {p['name']} CLI error: {result.stderr}")
                continue
                
            out_text = result.stdout
            try:
                save(kind, p, parse_json(out_text))
                print(f"  OK   {p['name']}")
            except Exception as e:
                print(f"  FAIL {p['name']} JSON parse error")
                (OUT / kind / f"{p['name']}.raw.txt").write_text(out_text, encoding="utf-8")
        except FileNotFoundError:
            sys.exit(f"'{agent}' 명령어를 찾을 수 없습니다. PATH를 확인해주세요.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["subject", "major", "special", "appendix"])
    ap.add_argument("--chunk", help="예: 1/4 (4개로 나눈 것 중 첫 번째)")
    ap.add_argument("--agent", help="사용할 CLI 툴 (예: codex, grok, agy)", required=True)
    ap.add_argument("-n", type=int, help="앞에서 N쪽만")
    ap.add_argument("--redo", action="store_true", help="이미 추출된 쪽도 다시")
    a = ap.parse_args()

    pages = targets(a.kind, a.n, a.redo, a.chunk)
    if not pages:
        return print("추출할 쪽이 없습니다. (--redo 로 재추출)")
    
    print(f"{a.kind}: {len(pages)}쪽 대상 (chunk: {a.chunk})")
    run_cli_agent(a.agent, a.kind, pages)

if __name__ == "__main__":
    main()
