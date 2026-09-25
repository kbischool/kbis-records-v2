
"""
KBIS Schools — Student Records data builder
=============================================
Reads the school's FEE workbooks (one per session) + INVOICE.xlsx (the master
fee structure) + STOCKS.xlsx (uniforms/textbooks/stationery/stock) and
produces normalised JSON files that the website reads.

USAGE
-----
    python3 build_data.py

Run this any time you:
  - update INVOICE.xlsx (a new session's fee structure / sessional adjustment)
  - add a new term sheet to a session workbook
  - add/remove students in a term sheet
  - start a brand-new session (drop a new "20XX - 20XX FEE.xlsx" file in /source)

It looks for workbooks inside ./source and writes JSON into ./docs/data.
Commit the regenerated ./docs/data/*.json files and push — GitHub Pages (and
every installed copy of the app) will pick up the change automatically.
"""
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import openpyxl

ROOT = Path(__file__).parent
SOURCE = ROOT / "source"
OUT = ROOT / "docs" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# 1. Which workbook is authoritative for which session, and which sheets in
#    it hold per-student term accounts (LOG / REMIT / PAYMENT SHEET sheets
#    are transaction ledgers, not account structures, so we skip them here).
# ---------------------------------------------------------------------------
SESSION_SOURCES = [
    {
        "file": "2022-2023 FEE.xlsx",
        "sessions": {
            "2021-2022": ["1ST TERM 2021-2022", "2ND TERM 2021-2022", "3RD TERM 2021-2022"],
            "2022-2023": ["1ST TERM 2022-2023", "2ND TERM 2022-2023", "3RD TERM 2022-2023"],
        },
    },
    {
        "file": "2023-2024 FEE.xlsx",
        "sessions": {
            "2023-2024": ["1ST TERM 2023-2024", "2ND TERM 2023-2024", "3RD TERM 2023-2024"],
        },
    },
    {
        "file": "2024-2025 FEE.xlsx",
        "sessions": {
            "2024-2025": ["1ST TERM 2024-2025", "2ND TERM 2024-2025 ", "3RD TERM 2024-2025"],
        },
    },
    {
        "file": "2025 - 2026 FEE.xlsx",
        "sessions": {
            "2025-2026": ["1ST TERM 2025-2026", "2ND TERM 2025-2026", "3RD TERM 2025-2026"],
        },
    },
    {
        "file": "2026 - 2027 FEE.xlsx",
        "sessions": {
            "2026-2027": ["1ST TERM ACCOUNT"],
        },
    },
]

TERM_LABELS = {
    0: "1st Term",
    1: "2nd Term",
    2: "3rd Term",
}

# Columns that are never fee line-items
IDENTITY_COLS = {"LAST NAME", "FIRST NAME", "CLASS"}
TOTAL_COLS = {"TOTAL FEE", "TOTAL"}
PAID_COLS = {"TOTAL PAID"}
BALANCE_COLS = {"BALANCE", "BALANCE REMAINING"}
DISCOUNT_COLS = {"DISCOUNT"}
DEPOSIT_COLS = {"FIRST DEPOSIT", "SECOND DEPOSIT", "THIRD DEPOSIT", "FOURTH DEPOSIT"}
EXTRA_COLS = {"LESSON FEE PRY", "LESSON FEE SEC", "PARTY FEE REMIT"}
# "FULL X" / "ACTUAL TUITION" columns are the pre-discount list price, kept as
# reference info rather than summed into the charged total.
REFERENCE_PREFIXES = ("FULL ",)
REFERENCE_EXACT = {"ACTUAL TUITION"}
# On sheets that carry a DISCOUNT column, these are the *pre-discount* twins of
# the actually-charged items (AD_FORM, TUITION, PTA&EXAM, REPORT_CARD,
# PRACTICAL) — without this, both twins show up as separate "items" and double
# up the account breakdown.
DISCOUNT_TWIN_REFERENCE = {"AD-FORM", "PTA/EXAM", "REPORT CARD", "PRACTICALS"}

CLASS_ORDER = [
    "CRECHE", "PLAYGROUP 1", "PLAYGROUP 2", "NURSERY 1", "NURSERY 2",
    "PRIMARY 1", "PRIMARY 2", "PRIMARY 3", "PRIMARY 4", "PRIMARY 5",
    "JUNIOR SECONDARY SCHOOL 1", "JUNIOR SECONDARY SCHOOL 2", "JUNIOR SECONDARY SCHOOL 3",
    "SENIOR SECONDARY SCHOOL 1", "SENIOR SECONDARY SCHOOL 2", "SENIOR SECONDARY SCHOOL 3",
]

CLASS_ALIASES = {
    "CRECHE": "CRECHE",
    "PG1": "PLAYGROUP 1", "PLAYGROUP 1": "PLAYGROUP 1",
    "PG2": "PLAYGROUP 2", "PLAYGROUP 2": "PLAYGROUP 2",
    "NUR1": "NURSERY 1", "NURSERY 1": "NURSERY 1",
    "NUR2": "NURSERY 2", "NURSERY 2": "NURSERY 2",
    "PRY1": "PRIMARY 1", "PRIMARY 1": "PRIMARY 1",
    "PRY2": "PRIMARY 2", "PRIMARY 2": "PRIMARY 2",
    "PRY3": "PRIMARY 3", "PRIMARY 3": "PRIMARY 3",
    "PRY4": "PRIMARY 4", "PRIMARY 4": "PRIMARY 4",
    "PRY5": "PRIMARY 5", "PRIMARY 5": "PRIMARY 5",
    "JSS1": "JUNIOR SECONDARY SCHOOL 1", "JUNIOR SECONDARY SCHOOL 1": "JUNIOR SECONDARY SCHOOL 1",
    "JSS2": "JUNIOR SECONDARY SCHOOL 2", "JUNIOR SECONDARY SCHOOL 2": "JUNIOR SECONDARY SCHOOL 2",
    "JSS3": "JUNIOR SECONDARY SCHOOL 3", "JUNIOR SECONDARY SCHOOL 3": "JUNIOR SECONDARY SCHOOL 3",
    "SSS1": "SENIOR SECONDARY SCHOOL 1", "SENIOR SECONDARY SCHOOL 1": "SENIOR SECONDARY SCHOOL 1",
    "SSS2": "SENIOR SECONDARY SCHOOL 2", "SENIOR SECONDARY SCHOOL 2": "SENIOR SECONDARY SCHOOL 2",
    "SSS3": "SENIOR SECONDARY SCHOOL 3", "SENIOR SECONDARY SCHOOL 3": "SENIOR SECONDARY SCHOOL 3",
}


def clean_col(c):
    return re.sub(r"\s+", " ", str(c)).strip()


def norm_class(raw):
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    key = clean_col(raw).upper()
    return CLASS_ALIASES.get(key, key)


def norm_name_part(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    s = re.sub(r"\s+", " ", s).strip().upper()
    return s


def slugify(*parts):
    s = "-".join(parts).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def to_number(v):
    if v is None:
        return 0
    if isinstance(v, str):
        v = v.replace(",", "").strip()
        if v == "" or v.upper() in ("N/A", "NA", "-"):
            return 0
    try:
        f = float(v)
        if math.isnan(f):
            return 0
        return int(f) if f == int(f) else round(f, 2)
    except (ValueError, TypeError):
        return 0


def classify_columns(columns):
    clean_names = [clean_col(c) for c in columns]
    has_discount = "DISCOUNT" in clean_names
    total, paid, balance, discount = None, None, None, None
    items, reference, deposits, extra = [], [], [], []
    for raw in columns:
        c = clean_col(raw)
        if c in IDENTITY_COLS:
            continue
        elif c in TOTAL_COLS:
            total = raw
        elif c in PAID_COLS:
            paid = raw
        elif c in BALANCE_COLS:
            balance = raw
        elif c in DISCOUNT_COLS:
            discount = raw
        elif c in DEPOSIT_COLS:
            deposits.append(raw)
        elif c in EXTRA_COLS:
            extra.append(raw)
        elif c in REFERENCE_EXACT or c.startswith(REFERENCE_PREFIXES):
            reference.append(raw)
        elif has_discount and c in DISCOUNT_TWIN_REFERENCE:
            reference.append(raw)
        else:
            items.append(raw)
    return {
        "total": total, "paid": paid, "balance": balance, "discount": discount,
        "items": items, "reference": reference, "deposits": deposits, "extra": extra,
    }


def parse_term_sheet(path, sheet_name, term_label):
    df = pd.read_excel(path, sheet_name=sheet_name)
    df = df.dropna(subset=["LAST NAME", "FIRST NAME"], how="all")
    cols = classify_columns(df.columns)
    records = []
    for _, row in df.iterrows():
        last = norm_name_part(row.get("LAST NAME"))
        first = norm_name_part(row.get("FIRST NAME"))
        if not last and not first:
            continue
        klass = norm_class(row.get("CLASS"))
        items = {}
        for c in cols["items"]:
            val = to_number(row.get(c))
            if val:
                items[clean_col(c)] = val
        reference = {}
        for c in cols["reference"]:
            val = to_number(row.get(c))
            if val:
                reference[clean_col(c)] = val
        deposits = {}
        for c in cols["deposits"]:
            val = to_number(row.get(c))
            if val:
                deposits[clean_col(c)] = val
        extra = {}
        for c in cols["extra"]:
            val = to_number(row.get(c))
            if val:
                extra[clean_col(c)] = val

        total = to_number(row.get(cols["total"])) if cols["total"] else sum(items.values())
        balance = to_number(row.get(cols["balance"])) if cols["balance"] else 0
        paid = to_number(row.get(cols["paid"])) if cols["paid"] else max(total - balance, 0)
        discount_raw = row.get(cols["discount"]) if cols["discount"] else 0
        discount = to_number(discount_raw)

        records.append({
            "lastName": last,
            "firstName": first,
            "class": klass,
            "term": term_label,
            "total": total,
            "paid": paid,
            "balance": balance,
            "discount": discount,
            "items": items,
            "reference": reference,
            "deposits": deposits,
            "extra": extra,
        })
    return records


def title_case_name(s):
    return " ".join(w.capitalize() for w in s.split())


def build_students():
    students = {}  # key -> student dict
    all_sessions_order = []

    for source in SESSION_SOURCES:
        path = SOURCE / source["file"]
        if not path.exists():
            print(f"  ! missing workbook, skipping: {source['file']}")
            continue
        for session, sheets in source["sessions"].items():
            if session not in all_sessions_order:
                all_sessions_order.append(session)
            terms_for_session = {}
            for i, sheet in enumerate(sheets):
                term_label = TERM_LABELS.get(i, sheet)
                try:
                    recs = parse_term_sheet(path, sheet, term_label)
                except Exception as e:
                    print(f"  ! could not read {source['file']} :: {sheet} -> {e}")
                    continue
                terms_for_session.setdefault(term_label, []).extend(recs)

            for term_label, recs in terms_for_session.items():
                for r in recs:
                    key = f"{r['lastName']}|{r['firstName']}"
                    if key not in students:
                        students[key] = {
                            "id": None,
                            "lastName": title_case_name(r["lastName"]),
                            "firstName": title_case_name(r["firstName"]),
                            "sessions": {},
                        }
                    sdict = students[key]["sessions"].setdefault(session, {"session": session, "terms": []})
                    sdict["terms"].append({
                        "term": r["term"],
                        "class": r["class"],
                        "total": r["total"],
                        "paid": r["paid"],
                        "balance": r["balance"],
                        "discount": r["discount"],
                        "items": r["items"],
                        "reference": r["reference"],
                        "deposits": r["deposits"],
                        "extra": r["extra"],
                    })

    latest_session = all_sessions_order[-1] if all_sessions_order else None

    out_students = []
    for key, s in students.items():
        sess_list = []
        for session in all_sessions_order:
            if session in s["sessions"]:
                terms = s["sessions"][session]["terms"]
                term_rank = {"1st Term": 0, "2nd Term": 1, "3rd Term": 2}
                terms.sort(key=lambda t: term_rank.get(t["term"], 99))
                sess_list.append({"session": session, "terms": terms})
        if not sess_list:
            continue

        first_session = sess_list[0]["session"]
        last_session_entry = sess_list[-1]
        last_term_entry = last_session_entry["terms"][-1]
        current_class = last_term_entry["class"]
        status = "active" if last_session_entry["session"] == latest_session else "left"

        sid = slugify(s["lastName"], s["firstName"])
        out_students.append({
            "id": sid,
            "lastName": s["lastName"],
            "firstName": s["firstName"],
            "status": status,
            "currentClass": current_class,
            "firstSession": first_session,
            "lastSession": last_session_entry["session"],
            "sessionCount": len(sess_list),
            "latestBalance": last_term_entry["balance"],
            "sessions": sess_list,
        })

    out_students.sort(key=lambda x: (x["lastName"], x["firstName"]))
    return out_students, all_sessions_order, latest_session


def build_stock():
    """Uniforms / Textbooks / Notebooks & Stationery / Stock, from STOCKS.xlsx.

    All four sheets are read and everything on them is published as-is --
    cost price, selling price, totals, profit, quantities, amounts paid and
    balances.
    """
    path = SOURCE / "STOCKS.xlsx"
    if not path.exists():
        print(" ! STOCKS.xlsx not found, skipping stock data")
        return {"uniforms": [], "textbooks": [], "notebooksAndStationery": [], "stock": []}

    # UNIFORMS: matrix sheet -- rows are class/gender groups, columns are
    # item types (UNIFORM / HOODY / SPORTSWEAR), each cell a cost price.
    df = pd.read_excel(path, sheet_name="UNIFORMS", header=1)
    df = df.rename(columns={df.columns[0]: "GROUP"})
    df = df.dropna(subset=["GROUP"])
    item_cols = [c for c in df.columns if c != "GROUP"]
    uniforms = []
    for _, row in df.iterrows():
        group = clean_col(row["GROUP"])
        if not group:
            continue
        items = []
        for c in item_cols:
            cost = to_number(row.get(c))
            if cost:
                items.append({"item": clean_col(c), "costPrice": cost})
        if items:
            uniforms.append({"group": group, "items": items})

    # TEXTBOOKS: one row per book -- every column on the sheet.
    # NOTE: STUDENT QTY / AVAILABLE QTY were removed from this sheet -- no
    # longer read or published. Deleting those columns in the workbook also
    # broke the SELL TOTAL / PROFIT formulas (every row now holds a cached
    # #REF! error), so when a cell's data_type marks it as a formula error we
    # recompute it ourselves as neededQty * sellPrice (and profit from that),
    # which is exactly what the formula did before the column was removed.
    # Read via openpyxl directly (not pandas) because pandas silently turns
    # Excel error cells into NaN, indistinguishable from a genuinely blank
    # cell -- openpyxl's cell.data_type == "e" is what actually tells them apart.
    wb_tb = openpyxl.load_workbook(path, data_only=True)
    ws_tb = wb_tb["TEXTBOOKS"]
    tb_header = [clean_col(c) if c is not None else None for c in next(ws_tb.iter_rows(min_row=1, max_row=1, values_only=True))]

    def tb_col(row_cells, label):
        return row_cells[tb_header.index(label)] if label in tb_header else None

    textbooks = []
    textbook_recomputed = 0
    for row_cells in ws_tb.iter_rows(min_row=2):
        values = [c.value for c in row_cells]
        raw_title = tb_col(values, "TEXTBOOK")
        if raw_title is None:
            continue
        title = clean_col(raw_title)
        if not title:
            continue
        needed_qty = to_number(tb_col(values, "NEEDED QTY"))
        sell_price = to_number(tb_col(values, "SELL PRICE"))
        cost_total = to_number(tb_col(values, "COST TOTAL"))

        sell_total_idx = tb_header.index("SELL TOTAL") if "SELL TOTAL" in tb_header else None
        profit_idx = tb_header.index("PROFIT") if "PROFIT" in tb_header else None
        sell_total_broken = sell_total_idx is not None and row_cells[sell_total_idx].data_type == "e"
        profit_broken = profit_idx is not None and row_cells[profit_idx].data_type == "e"

        if sell_total_broken or profit_broken:
            sell_total = needed_qty * sell_price
            profit = sell_total - cost_total
            textbook_recomputed += 1
        else:
            sell_total = to_number(tb_col(values, "SELL TOTAL"))
            profit = to_number(tb_col(values, "PROFIT"))
        textbooks.append({
            "class": clean_col(tb_col(values, "CLASS")),
            "subject": clean_col(tb_col(values, "SUBJECTS")),
            "textbook": title,
            "provider": clean_col(tb_col(values, "PROVIDER")),
            "neededQty": needed_qty,
            "costPrice": to_number(tb_col(values, "COST PRICE")),
            "sellPrice": sell_price,
            "costTotal": cost_total,
            "sellTotal": sell_total,
            "profit": profit,
        })
    if textbook_recomputed:
        print(f"  ! TEXTBOOKS: recomputed SELL TOTAL/PROFIT for {textbook_recomputed} row(s) "
              f"with broken formulas in STOCKS.xlsx (e.g. #REF!) -- consider fixing the "
              f"formulas in the workbook itself so this doesn't rely on the fallback")

    # NB & STAT: one row per stationery item -- cost/selling price plus the
    # per-class quantity columns.
    df = pd.read_excel(path, sheet_name="NB & STAT")
    df = df.dropna(subset=["ITEM"], how="all")
    class_qty_cols = [c for c in df.columns if c not in ("ITEM", "COST PRICE", "SELLING PRICE")]
    nb_stat = []
    for _, row in df.iterrows():
        item = clean_col(row.get("ITEM"))
        if not item:
            continue
        by_class = {}
        for c in class_qty_cols:
            qty = to_number(row.get(c))
            if qty:
                by_class[clean_col(c)] = qty
        nb_stat.append({
            "item": item,
            "costPrice": to_number(row.get("COST PRICE")),
            "sellingPrice": to_number(row.get("SELLING PRICE")),
            "qtyByClass": by_class,
        })

    # STOCK: available/needed qty, cost per item, totals, amount paid, balance.
    df = pd.read_excel(path, sheet_name="STOCK")
    df = df.dropna(subset=["ITEMS"], how="all")
    stock_rows = []
    for _, row in df.iterrows():
        item = clean_col(row.get("ITEMS"))
        if not item:
            continue
        stock_rows.append({
            "item": item,
            "availableQty": to_number(row.get("AVAILABLE QTY")),
            "neededQty": to_number(row.get("NEEDED QTY")),
            "costPerItem": to_number(row.get("COST PER ITEM")),
            "totalCost": to_number(row.get("TOTAL COST")),
            "amountPaid": to_number(row.get("AMOUNT PAID")),
            "balance": to_number(row.get("BALANCE")),
        })

    return {
        "uniforms": uniforms,
        "textbooks": textbooks,
        "notebooksAndStationery": nb_stat,
        "stock": stock_rows,
    }


MONTH_NAMES = {
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
}


def build_salary():
    """Every staff salary sheet in SALARY.xlsx -- every field, every month, every year.

    Sheet names are matched two ways:
      "YYYY STAFF SALARY"                 -> year YYYY, category "all"
      "YYYY PRIMARY/SECONDARY/SUPPORT STAFF" -> year YYYY, that category

    Each sheet is laid out as a header row, then repeating [MONTH marker row,
    one row per staff member, a totals row] blocks. Column sets differ by
    year/sheet (older sheets have DEDUCTION/OUTSTANDING/DATE DUE, newer ones
    have PAID/BALANCE) -- everything present on a given sheet is included;
    fields a sheet doesn't have are simply absent from its records.
    """
    path = SOURCE / "SALARY.xlsx"
    if not path.exists():
        print(" ! SALARY.xlsx not found, skipping salary data")
        return {}

    wb = openpyxl.load_workbook(path, data_only=True)
    years = {}

    for sheet_name in wb.sheetnames:
        m = re.match(r"(\d{4})\s+(PRIMARY|SECONDARY|SUPPORT)\s+STAFF", sheet_name, re.I)
        if m:
            year, category = m.group(1), m.group(2).lower()
        else:
            m2 = re.match(r"(\d{4})\s+STAFF\s+SALARY", sheet_name, re.I)
            if not m2:
                continue
            year, category = m2.group(1), "all"

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = [clean_col(c) if c is not None else None for c in rows[0]]
        has_split_name = "FIRSTNAME" in header and "LASTNAME" in header

        def col(row, label):
            return row[header.index(label)] if label in header else None

        records = []
        current_month = None
        for row in rows[1:]:
            first = row[0]
            if isinstance(first, str) and first.strip().upper() in MONTH_NAMES:
                current_month = first.strip().title()
                continue

            if has_split_name:
                name = f"{clean_col(row[0])} {clean_col(row[1])}".strip()
            else:
                name = clean_col(col(row, "NAME"))
            if not name:
                continue  # totals row or blank row

            def num(label):
                v = col(row, label)
                return to_number(v) if v is not None else None

            def txt(label):
                v = col(row, label)
                if v is None:
                    return None
                if hasattr(v, "isoformat"):
                    return v.isoformat()
                return clean_col(v) or None

            acct = col(row, "ACCOUNT NUMBER")
            if isinstance(acct, float) and acct == int(acct):
                acct = str(int(acct))
            elif acct is not None:
                acct = clean_col(acct) or None

            records.append({
                "month": current_month,
                "name": name,
                "bank": clean_col(col(row, "BANK")) or None,
                "accountNumber": acct,
                "contract": clean_col(col(row, "CONTRACT")) or None if "CONTRACT" in header else None,
                "basicSalary": num("BASIC SALARY"),
                "taxDeduction": num("1% TAX DEDUCTION"),
                "monthlyDeduction": num("10% MONTHLY DEDUCTION") if "10% MONTHLY DEDUCTION" in header else (num("10% DEDUCTION") if "10% DEDUCTION" in header else None),
                "deduction": num("DEDUCTION") if "DEDUCTION" in header else None,
                "outstanding": num("OUTSTANDING SALARY") if "OUTSTANDING SALARY" in header else (num("OUTSTANDING") if "OUTSTANDING" in header else None),
                "extraBonus": num("EXTRA BONUS"),
                "amountPayable": num("AMOUNT PAYABLE"),
                "paid": num("PAID") if "PAID" in header else None,
                "balance": num("BALANCE") if "BALANCE" in header else None,
                "dateDue": txt("DATE DUE") if "DATE DUE" in header else None,
            })

        bucket = years.setdefault(year, {"categories": {}})
        bucket["categories"][category] = records

    return years


def build_invoice():
    path = SOURCE / "INVOICE.xlsx"
    if not path.exists():
        print("  ! INVOICE.xlsx not found, skipping fee-structure reference")
        return {"classes": []}
    df = pd.read_excel(path, sheet_name="FEE BREAKDOWN")
    classes = []
    for _, row in df.iterrows():
        klass = norm_class(row.get("CLASS"))
        if not klass:
            continue
        items = {}
        for c in df.columns:
            cc = clean_col(c)
            if cc in ("CLASS", "GRAND TOTAL"):
                continue
            v = to_number(row.get(c))
            if v:
                items[cc] = v
        classes.append({
            "class": klass,
            "items": items,
            "grandTotal": to_number(row.get("GRAND TOTAL")) or sum(items.values()),
        })
    classes.sort(key=lambda c: CLASS_ORDER.index(c["class"]) if c["class"] in CLASS_ORDER else 999)
    return {"classes": classes}


def main():
    print("Building KBIS Schools data set…")
    students, sessions, latest_session = build_students()
    invoice = build_invoice()
    stock = build_stock()
    salary = build_salary()

    active = [s for s in students if s["status"] == "active"]
    left = [s for s in students if s["status"] == "left"]

    class_counts = {}
    outstanding_total = 0
    for s in active:
        c = s["currentClass"] or "UNASSIGNED"
        class_counts[c] = class_counts.get(c, 0) + 1
        outstanding_total += s["latestBalance"] or 0

    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sessions": sessions,
        "currentSession": latest_session,
        "classes": CLASS_ORDER,
        "totalStudents": len(students),
        "activeStudents": len(active),
        "leftStudents": len(left),
        "classCounts": class_counts,
        "currentOutstanding": outstanding_total,
    }

    (OUT / "students.json").write_text(json.dumps(students, indent=1, ensure_ascii=False))
    (OUT / "invoice.json").write_text(json.dumps(invoice, indent=1, ensure_ascii=False))
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    (OUT / "stock.json").write_text(json.dumps(stock, indent=1, ensure_ascii=False))
    (OUT / "salary.json").write_text(json.dumps(salary, indent=1, ensure_ascii=False))

    print(f"  students: {len(students)}  (active: {len(active)}, left: {len(left)})")
    print(f"  sessions: {sessions}")
    print(f"  stock: {len(stock['uniforms'])} uniform groups, {len(stock['textbooks'])} textbooks, "
          f"{len(stock['notebooksAndStationery'])} notebook/stationery items, "
          f"{len(stock['stock'])} stock rows")
    salary_years = sorted(salary.keys())
    salary_rows = sum(len(cat_rows) for y in salary.values() for cat_rows in y["categories"].values())
    print(f"  salary: {salary_years} ({salary_rows} monthly staff records)")
    print(f"  wrote -> {OUT}/students.json, invoice.json, meta.json, stock.json, salary.json")
    print("Done. Commit the docs/data/*.json files and push to publish the update.")


if __name__ == "__main__":
    main()
