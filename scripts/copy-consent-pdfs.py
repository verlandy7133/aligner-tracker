# 把所有 patients-import.json 裡有 consentPdfPath 的授權書 PDF
# 集中複製到 D:\矯正\病患授權書\
#
# 命名規則：{chartNo}_{姓名}授權書.pdf  (chartNo 前綴避免同名衝突)
# 已存在於目標資料夾的同檔名 → 跳過 (避免覆蓋)
#
# 執行：python scripts/copy-consent-pdfs.py

import json
import shutil
import sys
from pathlib import Path

PATIENTS_JSON = Path('dev-data/patients-import.json')
DEST_DIR = Path(r'D:\矯正\病患授權書')


def main():
    if not PATIENTS_JSON.exists():
        print(f'❌ 找不到 {PATIENTS_JSON}', file=sys.stderr)
        sys.exit(1)

    with open(PATIENTS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    print(f'目標資料夾：{DEST_DIR}')
    print()

    copied = 0
    skipped_exists = 0
    skipped_no_pdf = 0
    missing_source = []

    for p in data['patients']:
        if not p.get('consentPdfPath'):
            skipped_no_pdf += 1
            continue
        src = Path(p['consentPdfPath'])
        if not src.exists():
            missing_source.append(f"  {p['chartNo']} {p['name']} → 來源檔不存在: {src}")
            continue
        dst_name = f"{p['chartNo']}_{p['name']}授權書.pdf"
        dst = DEST_DIR / dst_name
        if dst.exists():
            skipped_exists += 1
            continue
        try:
            shutil.copy2(src, dst)
            copied += 1
        except Exception as e:
            missing_source.append(f"  {p['chartNo']} {p['name']} → 複製失敗: {e}")

    total = len(data['patients'])
    print('=== 統計 ===')
    print(f'  總病患數：{total}')
    print(f'  ✓ 複製成功：{copied}')
    print(f'  ⏭ 已存在跳過：{skipped_exists}')
    print(f'  – 無 PDF 跳過：{skipped_no_pdf}')
    print(f'  ⚠ 來源缺失：{len(missing_source)}')
    if missing_source:
        print()
        print('=== 來源缺失明細 ===')
        for line in missing_source[:30]:
            print(line)
        if len(missing_source) > 30:
            print(f'  ... 還有 {len(missing_source) - 30} 筆')


if __name__ == '__main__':
    main()
