from __future__ import annotations

import json
import random
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable


DATE_FMT = "%Y-%m-%d %H:%M:%S"


def now_str() -> str:
    return datetime.now().strftime(DATE_FMT)


@dataclass
class Record:
    record_id: int
    category: str
    value: float
    created_at: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, object]) -> "Record":
        return Record(
            record_id=int(data["record_id"]),
            category=str(data["category"]),
            value=float(data["value"]),
            created_at=str(data["created_at"]),
        )


class RecordStore:
    def __init__(self, path: str = "records.json") -> None:
        self.path = Path(path)
        self.records: list[Record] = []
        self._next_id = 1

    def load(self) -> None:
        if not self.path.exists():
            self.records = []
            self._next_id = 1
            return

        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.records = [Record.from_dict(item) for item in raw]
            self._next_id = max((r.record_id for r in self.records), default=0) + 1
        except (json.JSONDecodeError, OSError, KeyError, TypeError, ValueError):
            self.records = []
            self._next_id = 1

    def save(self) -> None:
        payload = [record.to_dict() for record in self.records]
        self.path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def add(self, category: str, value: float) -> Record:
        if not category.strip():
            raise ValueError("category must not be empty")
        record = Record(
            record_id=self._next_id,
            category=category.strip(),
            value=float(value),
            created_at=now_str(),
        )
        self.records.append(record)
        self._next_id += 1
        return record

    def remove(self, record_id: int) -> bool:
        for index, record in enumerate(self.records):
            if record.record_id == record_id:
                del self.records[index]
                return True
        return False

    def all(self) -> list[Record]:
        return list(self.records)

    def by_category(self, category: str) -> list[Record]:
        key = category.strip().lower()
        return [r for r in self.records if r.category.lower() == key]

    def categories(self) -> list[str]:
        names = sorted({r.category for r in self.records})
        return names


class ReportBuilder:
    def __init__(self, records: Iterable[Record]) -> None:
        self.records = list(records)

    def total(self) -> float:
        return sum(record.value for record in self.records)

    def average(self) -> float:
        if not self.records:
            return 0.0
        return statistics.mean(record.value for record in self.records)

    def median(self) -> float:
        if not self.records:
            return 0.0
        return statistics.median(record.value for record in self.records)

    def minimum(self) -> float:
        if not self.records:
            return 0.0
        return min(record.value for record in self.records)

    def maximum(self) -> float:
        if not self.records:
            return 0.0
        return max(record.value for record in self.records)

    def grouped_totals(self) -> dict[str, float]:
        result: dict[str, float] = {}
        for record in self.records:
            result.setdefault(record.category, 0.0)
            result[record.category] += record.value
        return dict(sorted(result.items()))

    def grouped_counts(self) -> dict[str, int]:
        result: dict[str, int] = {}
        for record in self.records:
            result.setdefault(record.category, 0)
            result[record.category] += 1
        return dict(sorted(result.items()))

    def summary(self) -> dict[str, object]:
        return {
            "count": len(self.records),
            "total": round(self.total(), 2),
            "average": round(self.average(), 2),
            "median": round(self.median(), 2),
            "minimum": round(self.minimum(), 2),
            "maximum": round(self.maximum(), 2),
            "grouped_totals": {k: round(v, 2) for k, v in self.grouped_totals().items()},
            "grouped_counts": self.grouped_counts(),
        }


def generate_sample_data(store: RecordStore, size: int = 30) -> None:
    categories = ["books", "food", "tools", "games", "music"]
    random.seed(7)
    for _ in range(size):
        category = random.choice(categories)
        value = round(random.uniform(5, 200), 2)
        store.add(category, value)


def print_record(record: Record) -> None:
    print(
        f"#{record.record_id:03d} | "
        f"{record.category:<8} | "
        f"{record.value:>7.2f} | "
        f"{record.created_at}"
    )


def print_records(records: list[Record], title: str) -> None:
    print(f"\n== {title} ({len(records)}) ==")
    if not records:
        print("(empty)")
        return
    for record in records:
        print_record(record)


def print_summary(summary: dict[str, object]) -> None:
    print("\n== Summary ==")
    print(f"count:   {summary['count']}")
    print(f"total:   {summary['total']}")
    print(f"average: {summary['average']}")
    print(f"median:  {summary['median']}")
    print(f"min:     {summary['minimum']}")
    print(f"max:     {summary['maximum']}")
    print("grouped_totals:")
    grouped_totals = summary["grouped_totals"]
    if isinstance(grouped_totals, dict):
        for key, value in grouped_totals.items():
            print(f"  - {key}: {value}")
    print("grouped_counts:")
    grouped_counts = summary["grouped_counts"]
    if isinstance(grouped_counts, dict):
        for key, value in grouped_counts.items():
            print(f"  - {key}: {value}")


def demo_flow() -> None:
    store = RecordStore("python_edit_test_data.json")
    store.load()

    if not store.records:
        print("No saved records found. Generating sample data.")
        generate_sample_data(store, 40)
        store.save()
    else:
        print("Loaded existing records.")

    all_records = store.all()
    print_records(all_records[:10], "First 10 records")

    categories = store.categories()
    print(f"\nCategories: {', '.join(categories)}")

    for category in categories[:3]:
        records = store.by_category(category)
        report = ReportBuilder(records)
        print_records(records[:5], f"Sample records for {category}")
        print_summary(report.summary())

    overall_report = ReportBuilder(store.all())
    print_summary(overall_report.summary())

    new_record = store.add("books", 88.88)
    print("\nAdded a new record:")
    print_record(new_record)

    removed = store.remove(2)
    print(f"\nRemoved record #2: {removed}")

    store.save()

    final_report = ReportBuilder(store.all())
    print_summary(final_report.summary())


def interactive() -> None:
    store = RecordStore("python_edit_test_data.json")
    store.load()

    help_text = """
commands:
  add <category> <value>
  list
  list <category>
  summary
  categories
  remove <id>
  save
  help
  exit
""".strip()

    print("Simple record manager v2")
    print(help_text)

    while True:
        try:
            raw = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nbye")
            break

        if not raw:
            continue

        parts = raw.split()

        if parts[0] == "help":
            print(help_text)
        elif parts[0] == "add" and len(parts) == 3:
            category = parts[1]
            try:
                value = float(parts[2])
            except ValueError:
                print("value must be numeric")
                continue
            try:
                record = store.add(category, value)
            except ValueError as exc:
                print(exc)
                continue
            print("added:")
            print_record(record)
        elif parts[0] == "list" and len(parts) == 1:
            print_records(store.all(), "All records")
        elif parts[0] == "list" and len(parts) == 2:
            print_records(store.by_category(parts[1]), f"Category {parts[1]}")
        elif parts[0] == "summary":
            summary = ReportBuilder(store.all()).summary()
            print_summary(summary)
        elif parts[0] == "categories":
            print(", ".join(store.categories()) or "(empty)")
        elif parts[0] == "remove" and len(parts) == 2:
            try:
                record_id = int(parts[1])
            except ValueError:
                print("id must be an integer")
                continue
            print("removed" if store.remove(record_id) else "not found")
        elif parts[0] == "save":
            store.save()
            print("saved successfully")
        elif parts[0] == "exit":
            print("bye")
            break
        else:
            print("unknown command")


if __name__ == "__main__":
    print("1) demo")
    print("2) interactive")
    mode = input("select mode: ").strip()
    if mode == "1":
        demo_flow()
    elif mode == "2":
        interactive()
    else:
        print("invalid mode")