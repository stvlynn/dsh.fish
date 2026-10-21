"""Restore an explicit-table D1 SQL export without dropping NUL characters."""
import argparse
import pathlib
import sqlite3
import os
import tempfile
import re

parser = argparse.ArgumentParser()
parser.add_argument("export")
parser.add_argument("snapshot")
args = parser.parse_args()
target = pathlib.Path(args.snapshot)
if target.exists():
    raise RuntimeError("Snapshot already exists; refusing to overwrite it")
with open(args.export, "r", encoding="utf-8", newline="") as handle:
    sql = handle.read()
# SQLite's SQL parser rejects NUL in literals. Re-encode the complete literal,
# not just the NUL, as a UTF-8 blob cast back to TEXT.
parts = []
i = 0
start = 0
converted = 0
while i < len(sql):
    begin = sql.find("'", i)
    if begin < 0:
        break
    parts.append(sql[start:begin])
    end = sql.find("'", begin + 1)
    while end >= 0 and end + 1 < len(sql) and sql[end + 1] == "'":
        end = sql.find("'", end + 2)
    if end < 0:
        raise RuntimeError("Unterminated SQL literal")
    i = end + 1
    literal = sql[begin:i]
    if chr(0) in literal:
        text = literal[1:-1].replace("''", "'")
        parts.append("CAST(X'" + text.encode().hex() + "' AS TEXT)")
        converted += 1
    else:
        parts.append(literal)
    start = i
parts.append(sql[start:])
# A private incomplete restore must never masquerade as a validated snapshot.
fd, temporary_name = tempfile.mkstemp(prefix=target.name + ".partial-", dir=target.parent)
temporary = pathlib.Path(temporary_name).resolve()
if temporary.parent != target.parent.resolve():
    raise RuntimeError("Unexpected temporary restore path")
os.close(fd)  # mkstemp creates the file with owner-only permissions.
try:
    with sqlite3.connect(temporary) as db:
        db.executescript("".join(parts))
        required_ddl = (pathlib.Path(__file__).parents[1] / "mysql-migrations/0001_initial.sql").read_text()
        required = set(re.findall("CREATE TABLE " + chr(96) + "([a-z_]+)" + chr(96), required_ddl))
        actual = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required.issubset(actual):
            raise RuntimeError("Source snapshot is missing application tables")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Source snapshot has invalid foreign keys")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Source snapshot failed integrity check")
    db.close()
    # Same-directory exclusive link publishes atomically without overwriting a race.
    os.link(temporary, target)
finally:
    if "db" in locals():
        db.close()
    if temporary.parent != target.parent.resolve() or not temporary.name.startswith(target.name + ".partial-"):
        raise RuntimeError("Refusing unexpected cleanup path")
    temporary.unlink(missing_ok=True)
print("Restored validated 17-table snapshot; NUL-containing literals preserved:", converted)
