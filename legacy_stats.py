"""Halaqa numbers from before the students registry (PLAN_STUDENTS_SHEET.md, S-28).

Reads the saved Markdown reports of one year folder (Year / Teacher / Month / *.md)
and writes, for each month in the range, one row per teacher code and one for the
academy, with the columns of the «قبل النظام» tab (S-29). The CSV is pasted into
that tab once, on install day. Run it on the synced Drive folder, for example:

    python legacy_stats.py "G:/My Drive/تقرير حلقات أكاديمية سنا/2026" --to 2026-11-02

Counting (section 9 of the plan):
- A halaqa is (date, session, halaqa number).
- A report counts in full unless every student in it was already counted in the
  same halaqa: then it is a resubmission. A "(1)" filename means nothing by itself.
- Attendance is the number of student blocks, without «بدون اسم».
- A report with no student block is not a halaqa.
"""

import argparse
import csv
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ARABIC_MONTHS = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
]
EASTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
STUDENT_RE = re.compile(r"^(?:الطالب|الطالبة)\s*[:：]\s*(.+)$", re.M)
ACADEMY = "الأكاديمية"
CHILDREN = "أطفال"
ADULTS = "كبار"
HEADERS = [
    "الشهر",
    "المعلم",
    "عدد الحلقات",
    "الساعات",
    "الحضور الكلي",
    "متوسط الطلاب في الحلقة",
    "حلقات الأطفال",
    "ساعات الأطفال",
    "حلقات الكبار",
    "ساعات الكبار",
    "المعلمون النشطون",
]


def name_key(name):
    """Matching key of the registry (S-03), so both count a name the same way."""
    s = re.sub(r"[\u064B-\u0652\u0670\u0640\s]", "", name)
    s = re.sub("[أإآ]", "ا", s)
    return s.replace("ة", "ه").replace("ى", "ي")


def frontmatter(text, key):
    match = re.search(rf"^{key}:\s*(.+)$", text, re.M)
    return match.group(1).strip().strip('"') if match else ""


def parse_date(text):
    """Same formats as _parseReportDate in Code.js, including «7أكتوبر»."""
    t = text.translate(EASTERN)
    m = re.search(r"(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})", t)
    try:
        if m:
            return date(int(m[3]), int(m[2]), int(m[1]))
        m = re.search(r"(\d{1,2})\s*([^\s\d،,]+)\s+(\d{4})", t)
        if m and m[2] in ARABIC_MONTHS:
            return date(int(m[3]), ARABIC_MONTHS.index(m[2]) + 1, int(m[1]))
    except ValueError:
        return None
    return None


def report_body(text):
    match = re.search(r"## نص التقرير\s*\n(.*?)\n---\s*\n\s*## ملاحظات", text, re.S)
    return match.group(1) if match else ""


def read_report(path):
    text = path.read_text(encoding="utf-8-sig")
    when = parse_date(frontmatter(text, "report_date_text"))
    if when is None:
        when = date.fromisoformat(frontmatter(text, "submission_timestamp")[:10])
    names = [
        n.strip()
        for n in STUDENT_RE.findall(report_body(text))
        if n.strip() and n.strip() != "بدون اسم"
    ]
    return {
        "file": path.name,
        "date": when,
        "teacher": frontmatter(text, "teacher_id"),
        "slot": (
            when,
            frontmatter(text, "session_type"),
            frontmatter(text, "hala_num"),
        ),
        "category": frontmatter(text, "student_category"),
        "minutes": int(frontmatter(text, "duration_hours") or 0) * 60
        + int(frontmatter(text, "duration_minutes") or 0),
        "keys": [name_key(n) for n in names],
    }


def load_reports(year_dir, start, end):
    reports = []
    for path in sorted(year_dir.glob("*/*/*.md")):
        try:
            rep = read_report(path)
        except (OSError, ValueError) as err:
            print(f"skip {path}: {err}", file=sys.stderr)
            continue
        if start <= rep["date"] <= end:
            reports.append(rep)

    # The original before its "(1)" copy, so the copy is the one judged; plain name
    # order would put "x (1).md" first, because a space sorts before ".".
    def order(r):
        m = re.match(r"(.*?)(?: \((\d+)\))?\.md$", r["file"])
        return (r["date"], r["teacher"], m[1], int(m[2] or 0))

    return sorted(reports, key=order)


def counted_halaqat(reports):
    """Reports that count as a halaqa, after dropping resubmissions."""
    seen = defaultdict(set)
    kept = []
    for rep in reports:
        if not rep["keys"]:
            continue
        slot = (rep["teacher"],) + rep["slot"]
        if set(rep["keys"]) <= seen[slot]:
            continue
        seen[slot].update(rep["keys"])
        kept.append(rep)
    return kept


def stat_row(month, label, halaqat, active_teachers=""):
    def hours(items):
        return round(sum(h["minutes"] for h in items) / 60, 2)

    kids = [h for h in halaqat if h["category"] == CHILDREN]
    adults = [h for h in halaqat if h["category"] == ADULTS]
    attendance = sum(len(h["keys"]) for h in halaqat)
    average = round(attendance / len(halaqat), 1) if halaqat else 0
    return [
        month,
        label,
        len(halaqat),
        hours(halaqat),
        attendance,
        average,
        len(kids),
        hours(kids),
        len(adults),
        hours(adults),
        active_teachers,
    ]


def build_rows(halaqat):
    by_month = defaultdict(list)
    for h in halaqat:
        by_month[h["date"].strftime("%Y-%m")].append(h)
    rows = []
    for month in sorted(by_month):
        items = by_month[month]
        teachers = sorted({h["teacher"] for h in items})
        for code in teachers:
            rows.append(
                stat_row(month, code, [h for h in items if h["teacher"] == code])
            )
        rows.append(stat_row(month, ACADEMY, items, len(teachers)))
    return rows


def main():
    parser = argparse.ArgumentParser(
        description="Halaqa numbers before the students registry, "
        "as CSV for «قبل النظام»."
    )
    parser.add_argument("year_dir", type=Path, help="Synced Drive folder of the year")
    parser.add_argument(
        "--from",
        dest="start",
        default="2026-09-01",
        help="First day, YYYY-MM-DD (default 2026-09-01)",
    )
    parser.add_argument(
        "--to", dest="end", required=True, help="Day before install day, YYYY-MM-DD"
    )
    parser.add_argument(
        "--teacher", help="Print one teacher code's halaqat, for a hand count"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("legacy_stats.csv"),
        help="Output CSV (default legacy_stats.csv)",
    )
    args = parser.parse_args()

    try:
        start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    except ValueError as err:
        sys.exit(f"bad date: {err}")
    if not args.year_dir.is_dir():
        sys.exit(f"not a folder: {args.year_dir}")
    if end < start:
        sys.exit("--to is before --from")

    halaqat = counted_halaqat(load_reports(args.year_dir, start, end))
    rows = build_rows(halaqat)
    with args.out.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        writer.writerows(rows)

    if args.teacher:
        for h in (h for h in halaqat if h["teacher"] == args.teacher):
            print(
                f"{h['date']}  {h['slot'][1]}  {h['slot'][2] or '-'}  "
                f"{len(h['keys'])} طلاب  {h['file']}"
            )
    for row in rows:
        if row[1] == ACADEMY or row[1] == args.teacher:
            print(f"{row[0]}  {row[1]}: {row[2]} حلقة، {row[3]} ساعة، {row[4]} حضوراً")
    print(
        f"wrote {len(rows)} rows to {args.out} ({start} .. {end}; "
        f"{(end - start + timedelta(days=1)).days} days)"
    )


if __name__ == "__main__":
    main()
