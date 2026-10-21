"""Seed the unopened production target from the already verified validation baseline."""
import json
import os
import pathlib
import re
import ssl
import pymysql

c = json.loads(pathlib.Path(os.environ["MYSQL_MIGRATION_CONFIG"]).read_text())
if c["database"] != "dsh_fish":
    raise RuntimeError("Baseline seed is restricted to the unopened production target")
ddl = (pathlib.Path(__file__).parents[1] / "mysql-migrations/0001_initial.sql").read_text()
tables = re.findall("CREATE TABLE " + chr(96) + "([a-z_]+)" + chr(96), ddl)
tables = ["users", "artifacts"] + [t for t in tables if t not in ("users", "artifacts")]
def quote(value):
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
        raise RuntimeError("Unexpected identifier")
    return chr(96) + value + chr(96)
db = pymysql.connect(host=c["host"], port=c["port"], user=c["admin_user"],
    password=c["admin_password"], database=c["database"], charset="utf8mb4",
    ssl=ssl.create_default_context(cafile=c["ca"]), connect_timeout=10,
    read_timeout=180, write_timeout=180)
try:
    with db.cursor() as q:
        for schema in ("dsh_fish", "dsh_fish_validation"):
            q.execute("SELECT completed,sha256 FROM " + quote(schema) + "._mysql_migrations WHERE version='0001_initial'")
            row = q.fetchone()
            if row is None or row[0] != 1:
                raise RuntimeError("Incomplete schema migration")
            if schema == "dsh_fish":
                expected_sha = row[1]
            elif row[1] != expected_sha:
                raise RuntimeError("Schema migration checksums differ")
        for table in tables:
            q.execute("SELECT COUNT(*) FROM " + quote(table))
            if q.fetchone()[0]:
                raise RuntimeError("Refusing to seed an existing production table: " + table)
        db.begin()
        for table in tables:
            q.execute("SHOW COLUMNS FROM " + quote(table))
            columns = ",".join(quote(row[0]) for row in q.fetchall())
            q.execute("INSERT INTO " + quote(table) + " (" + columns + ") SELECT " + columns + " FROM dsh_fish_validation." + quote(table))
            print(table, "baseline rows", q.rowcount, flush=True)
        db.commit()
except Exception:
    db.rollback()
    raise
finally:
    db.close()
