from pathlib import Path
import json
import openpyxl

path = Path(r"C:\Users\King2\Downloads\Final 50.xlsx")
wb = openpyxl.load_workbook(path, data_only=True)
ws = wb.active
questions: list[dict] = []
for row in ws.iter_rows(values_only=True):
    sno, q = row[0] if len(row) > 0 else None, row[1] if len(row) > 1 else None
    if q is None:
        continue
    q = str(q).strip()
    if not q or q.lower().startswith("question"):
        continue
    # skip pure numbers as question text
    if isinstance(sno, (int, float)) or (isinstance(sno, str) and sno.strip().isdigit()):
        num = int(float(sno)) if sno is not None else len(questions) + 1
    else:
        # sometimes S.No empty — try parse leading number from q
        num = len(questions) + 1
    questions.append({"n": num, "q": q})

out = Path(r"C:\Users\King2\Desktop\Astra\src\_final50_questions.json")
out.write_text(json.dumps(questions, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"count={len(questions)}")
for item in questions:
    print(f"{item['n']}. {item['q'][:120]}")
