# -*- coding: utf-8 -*-
"""A3 2-up 스프레드 PDF를 낱쪽(A4)으로 분리해 텍스트/이미지를 추출한다.

출력:
  data/pages/p{NNN}.txt   낱쪽 텍스트 (레이아웃 보존)
  data/images/p{NNN}.png  낱쪽 렌더 이미지 (기본 150dpi)
  data/pages/index.json   낱쪽 메타 (원본 시트/좌우/인쇄 쪽번호 추정)
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF = next(ROOT.glob("*.pdf"))
PAGES = ROOT / "data" / "pages"
IMAGES = ROOT / "data" / "images"
DPI = int(sys.argv[1]) if len(sys.argv) > 1 else 150
RENDER = "--no-images" not in sys.argv

# 푸터에서 인쇄 쪽번호를 뽑는다. 좌: "12 서울특별시교육청교육연구정보원" / 우: "... 안내서 13"
RE_LEFT_FOOT = re.compile(r"^\s*(\d{1,3})\s+서울특별시교육청", re.M)
RE_RIGHT_FOOT = re.compile(r"안내서\s+(\d{1,3})\s*$", re.M)


def printed_no(text, side):
    m = (RE_LEFT_FOOT if side == "L" else RE_RIGHT_FOOT).search(text)
    return int(m.group(1)) if m else None


def main():
    doc = pymupdf.open(PDF)
    index = []
    seq = 0
    for sheet_no, page in enumerate(doc, start=1):
        r = page.rect
        spread = r.width > r.height  # A3 가로 = 2-up
        halves = (
            [("L", pymupdf.Rect(r.x0, r.y0, r.x0 + r.width / 2, r.y1)),
             ("R", pymupdf.Rect(r.x0 + r.width / 2, r.y0, r.x1, r.y1))]
            if spread else [("S", r)]
        )
        for side, clip in halves:
            seq += 1
            name = f"p{seq:03d}"
            text = page.get_text("text", clip=clip, sort=True)
            (PAGES / f"{name}.txt").write_text(text, encoding="utf-8")
            if RENDER:
                pix = page.get_pixmap(clip=clip, dpi=DPI)
                pix.save(IMAGES / f"{name}.png")
            index.append({
                "seq": seq, "name": name, "sheet": sheet_no, "side": side,
                "printed_page": printed_no(text, side),
                "chars": len(text.strip()),
            })
    (PAGES / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    found = sum(1 for x in index if x["printed_page"])
    print(f"시트 {len(doc)}장 -> 낱쪽 {seq}쪽")
    print(f"인쇄 쪽번호 인식 {found}/{seq}쪽")
    print(f"빈 페이지(<50자) {sum(1 for x in index if x['chars'] < 50)}쪽")


if __name__ == "__main__":
    main()
