"""Copy all application tables from a frozen D1 snapshot over verified TLS."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import ssl

import pymysql

parser = argparse.ArgumentParser()
parser.add_argument("snapshot")
parser.add_argument("report")
parser.add_argument("--verify-only", action="store_true")
parser.add_argument("--baseline", help="Verified frozen baseline for a final delta; target must still match it exactly")
args = parser.parse_args()
config = json.loads(pathlib.Path(os.environ["MYSQL_MIGRATION_CONFIG"]).read_text())
if config["database"] not in ("dsh_fish", "dsh_fish_validation"):
    raise RuntimeError("Unexpected target")
source = sqlite3.connect("file:" + str(pathlib.Path(args.snapshot).resolve()) + "?mode=ro", uri=True)
baseline = None if args.baseline is None else sqlite3.connect("file:" + str(pathlib.Path(args.baseline).resolve()) + "?mode=ro", uri=True)
if baseline is not None and args.verify_only:
    raise RuntimeError("Choose verification or baseline delta, not both")
ddl = (pathlib.Path(__file__).parents[1] / "mysql-migrations/0001_initial.sql").read_text()
tables = re.findall(r"CREATE TABLE `([a-z_]+)`", ddl)
# Parents first, then every remaining table; foreign keys stay enabled.
tables = ["users", "artifacts"] + [t for t in tables if t not in ("users", "artifacts")]
def ident(value):
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
        raise ValueError("Unexpected identifier")
    return chr(96) + value + chr(96)

def normalized(row, json_indexes):
    values = list(row)
    for i in json_indexes:
        if values[i] is not None:
            values[i] = json.loads(values[i]) if isinstance(values[i], str) else values[i]
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n"

def digest(rows, json_indexes):
    h = hashlib.sha256()
    count = 0
    for row in rows:
        h.update(normalized(row, json_indexes))
        count += 1
    return count, h.hexdigest()

target = pymysql.connect(host=config["host"], port=config["port"],
    user=config["admin_user"], password=config["admin_password"], database=config["database"],
    charset="utf8mb4", ssl=ssl.create_default_context(cafile=config["ca"]),
    connect_timeout=10, read_timeout=120, write_timeout=120)
report = {"database": config["database"], "transport": "TLS: CA and endpoint identity verified", "tables": {}}
try:
    with target.cursor() as q:
        q.execute("SELECT completed, sha256 FROM _mysql_migrations WHERE version='0001_initial'")
        if q.fetchone() != (1, hashlib.sha256(ddl.encode()).hexdigest()):
            raise RuntimeError("Target schema migration is incomplete")
        if not args.verify_only and baseline is None:
            for table in tables:
                q.execute("SELECT COUNT(*) FROM " + ident(table))
                if q.fetchone()[0]:
                    raise RuntimeError("Refusing to overwrite existing application data: " + table)
        if baseline is not None:
            plans = {}
            # Verify EVERY target table matches the baseline before the first mutation.
            for table in tables:
                info = source.execute("PRAGMA table_info(" + ident(table) + ")").fetchall()
                columns = [c[1] for c in info]
                primary = [c[1] for c in sorted(info, key=lambda c: c[5]) if c[5]]
                if not primary:
                    raise RuntimeError("Missing primary key: " + table)
                baseline_info = baseline.execute("PRAGMA table_info(" + ident(table) + ")").fetchall()
                baseline_primary = [c[1] for c in sorted(baseline_info, key=lambda c: c[5]) if c[5]]
                if columns != [c[1] for c in baseline_info] or primary != baseline_primary:
                    raise RuntimeError("Baseline schema mismatch: " + table)
                q.execute("SHOW INDEX FROM " + ident(table) + " WHERE Key_name='PRIMARY'")
                target_primary = [r[4] for r in sorted(q.fetchall(), key=lambda r: r[3])]
                if target_primary != primary:
                    raise RuntimeError("Target primary key mismatch: " + table)
                q.execute("SHOW COLUMNS FROM " + ident(table))
                target_columns = q.fetchall()
                if set(columns) != {c[0] for c in target_columns}:
                    raise RuntimeError("Column mismatch before delta: " + table)
                json_names = {c[0] for c in target_columns if c[1] == "json"}
                json_indexes = [columns.index(n) for n in json_names]
                ordered = "SELECT " + ",".join(map(ident, columns)) + " FROM " + ident(table) + " ORDER BY " + ",".join(map(ident, primary))
                q.execute(ordered)
                if digest(q, json_indexes) != digest(baseline.execute(ordered), json_indexes):
                    raise RuntimeError("Target diverged from baseline; refusing delta: " + table)
                key_indexes = [columns.index(n) for n in primary]
                old_rows = iter(baseline.execute(ordered))
                new_rows = iter(source.execute(ordered))
                old = next(old_rows, None)
                new = next(new_rows, None)
                deletes = []
                inserts = []
                updates = []
                while old is not None or new is not None:
                    old_key = None if old is None else tuple(old[i] for i in key_indexes)
                    new_key = None if new is None else tuple(new[i] for i in key_indexes)
                    if new is None or (old is not None and old_key < new_key):
                        deletes.append(old_key)
                        old = next(old_rows, None)
                    elif old is None or new_key < old_key:
                        inserts.append(new)
                        new = next(new_rows, None)
                    else:
                        if normalized(old, json_indexes) != normalized(new, json_indexes):
                            updates.append(new)
                        old = next(old_rows, None)
                        new = next(new_rows, None)
                plans[table] = (columns, primary, deletes, inserts, updates)
            for table in reversed(tables):
                columns, primary, deletes, inserts, updates = plans[table]
                if deletes:
                    statement = "DELETE FROM " + ident(table) + " WHERE " + " AND ".join(ident(n) + "=%s" for n in primary)
                    q.executemany(statement, deletes)
            for table in tables:
                columns, primary, deletes, inserts, updates = plans[table]
                # Updates target the primary key only. A secondary UNIQUE collision
                # must fail and roll back, never mutate a different logical row.
                non_primary = [n for n in columns if n not in primary]
                update_order = [columns.index(n) for n in non_primary + primary]
                if updates:
                    statement = "UPDATE " + ident(table) + " SET " + ",".join(ident(n) + "=%s" for n in non_primary) + " WHERE " + " AND ".join(ident(n) + "=%s" for n in primary)
                    values = [tuple(row[i] for i in update_order) for row in updates]
                    for start in range(0, len(values), 100):
                        q.executemany(statement, values[start:start + 100])
                if inserts:
                    statement = "INSERT INTO " + ident(table) + " (" + ",".join(map(ident, columns)) + ") VALUES (" + ",".join(["%s"] * len(columns)) + ")"
                    for start in range(0, len(inserts), 100):
                        q.executemany(statement, inserts[start:start + 100])
                print(table, "delta deletes", len(deletes), "inserts", len(inserts), "updates", len(updates), flush=True)
        for table in tables:
            info = source.execute("PRAGMA table_info(" + ident(table) + ")").fetchall()
            if not info:
                raise RuntimeError("Snapshot is missing table: " + table)
            columns = [c[1] for c in info]
            primary = [c[1] for c in sorted(info, key=lambda c: c[5]) if c[5]]
            if not primary:
                raise RuntimeError("Expected a stable primary key: " + table)
            q.execute("SHOW COLUMNS FROM " + ident(table))
            target_columns = q.fetchall()
            if set(columns) != {c[0] for c in target_columns}:
                raise RuntimeError("Column mismatch: " + table)
            json_names = {c[0] for c in target_columns if c[1] == "json"}
            json_indexes = [columns.index(name) for name in json_names]
            select = "SELECT " + ",".join(map(ident, columns)) + " FROM " + ident(table)
            ordered = select + " ORDER BY " + ",".join(map(ident, primary))
            if not args.verify_only and baseline is None:
                insert = "INSERT INTO " + ident(table) + " (" + ",".join(map(ident, columns)) + ") VALUES (" + ",".join(["%s"] * len(columns)) + ")"
                batch = []
                size = 0
                for row in source.execute(ordered):
                    # Validate all JSON fields before sending unchanged source values.
                    normalized(row, json_indexes)
                    batch.append(row)
                    size += sum(len(v.encode()) for v in row if isinstance(v, str))
                    if len(batch) >= 100 or size >= 2_000_000:
                        q.executemany(insert, batch)
                        target.commit()
                        batch = []
                        size = 0
                if batch:
                    q.executemany(insert, batch)
                    target.commit()
            expected = digest(source.execute(ordered), json_indexes)
            q.execute(ordered)
            actual = digest(q, json_indexes)
            if actual != expected:
                raise RuntimeError("Content verification failed: " + table)
            report["tables"][table] = {"rows": actual[0], "sha256": actual[1]}
            print(table, "rows", actual[0], "verified", flush=True)
    if baseline is not None:
        # Final delta is atomic, including the complete content verification.
        target.commit()
    pathlib.Path(args.report).write_text(json.dumps(report, indent=2))
    pathlib.Path(args.report).chmod(0o600)
except Exception:
    target.rollback()
    raise
finally:
    target.close()
    source.close()
    if baseline is not None:
        baseline.close()
