import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  loadConfig,
  validateConfig,
  connectionOptions,
  discoverMigrations,
  splitStatements,
  validateHistory,
  runMigrations,
  main,
  MigrationError,
} from "./migrate-mysql.mjs";

const CA =
  "-----BEGIN CERTIFICATE-----\nmock-public-ca\n-----END CERTIFICATE-----";
const ENV = {
  MYSQL_HOST: "192.0.2.5",
  MYSQL_PORT: "13306",
  MYSQL_DATABASE: "dsh_fish",
  MYSQL_MIGRATION_USER: "mock-migrator",
  MYSQL_MIGRATION_PASSWORD: "mock-secret",
  MYSQL_TLS_SERVER_NAME: "gateway.example.test",
  MYSQL_SSL_CA: CA,
};
const CONFIG = {
  host: ENV.MYSQL_HOST,
  port: 13306,
  database: "dsh_fish",
  user: ENV.MYSQL_MIGRATION_USER,
  password: ENV.MYSQL_MIGRATION_PASSWORD,
  serverName: ENV.MYSQL_TLS_SERVER_NAME,
  ca: CA,
};
function migration(version, sql = "CREATE TABLE example (id int);") {
  return {
    version,
    sql,
    sha256: createHash("sha256").update(sql).digest("hex"),
  };
}
const INITIAL = migration("0001_initial");
const SECOND = migration(
  "0002_add_column",
  "ALTER TABLE example ADD name varchar(255);",
);
const THIRD = migration(
  "0003_add_index",
  "CREATE INDEX example_name ON example (name);",
);
function applied(file, overrides = {}) {
  return {
    version: file.version,
    sha256: file.sha256,
    completed: 1,
    ...overrides,
  };
}
function mockClient({
  tables = ["_mysql_migrations", "example"],
  rows = [applied(INITIAL)],
  failSql,
  acquire = 1,
  release = 1,
  database = CONFIG.database,
  sqlMode = "",
} = {}) {
  const calls = [];
  let ended = false;
  return {
    calls,
    rows,
    get ended() {
      return ended;
    },
    async end() {
      ended = true;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      if (failSql?.(sql))
        throw new Error(
          "raw SQL user=mock-migrator password=mock-secret token=private-value",
        );
      if (sql.startsWith("SELECT DATABASE()"))
        return [[{ database_name: database, sql_mode: sqlMode }]];
      if (sql.startsWith("SELECT GET_LOCK")) return [[{ acquired: acquire }]];
      if (sql.startsWith("SELECT RELEASE_LOCK"))
        return [[{ released: release }]];
      if (sql === "SHOW TABLES")
        return [tables.map((name) => ({ table_name: name }))];
      if (sql.startsWith("SELECT version"))
        return [rows.map((row) => ({ ...row }))];
      if (sql.startsWith("CREATE TABLE IF NOT EXISTS _mysql_migrations"))
        tables.push("_mysql_migrations");
      if (sql.startsWith("INSERT INTO _mysql_migrations"))
        rows.push({ version: params[0], sha256: params[1], completed: 0 });
      if (sql.startsWith("UPDATE _mysql_migrations"))
        rows.find((row) => row.version === params[0]).completed = 1;
      return [{ affectedRows: 1 }];
    },
  };
}
function run(client, overrides = {}) {
  return runMigrations(client, {
    config: CONFIG,
    migrations: [INITIAL],
    log() {},
    ...overrides,
  });
}
function mutations(client) {
  return client.calls.filter((call) => !/^(SELECT|SHOW)\b/.test(call.sql));
}
function released(client) {
  return client.calls.some((call) =>
    call.sql.startsWith("SELECT RELEASE_LOCK"),
  );
}

// Configuration, connection and database access below is injected or mocked.
test("CI environment configuration is production-only and complete without credential file reads", async () => {
  assert.deepEqual(
    await loadConfig({
      env: ENV,
      read() {
        assert.fail("CI must not read credentials files");
      },
    }),
    CONFIG,
  );
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV };
    delete env[key];
    await assert.rejects(loadConfig({ env }), MigrationError);
  }
  await assert.rejects(
    loadConfig({ env: { ...ENV, MYSQL_DATABASE: "dsh_fish_validation" } }),
    /explicit local/,
  );
  await assert.rejects(
    loadConfig({ env: { ...ENV, MYSQL_DATABASE: "other" }, production: true }),
    /production requires/,
  );
});

test("local config preserves owner-only JSON/admin keys and validation opt-in", async () => {
  const local = {
    host: CONFIG.host,
    port: CONFIG.port,
    database: "dsh_fish_validation",
    admin_user: CONFIG.user,
    admin_password: CONFIG.password,
    tls_server_name: CONFIG.serverName,
    ca: "/mock/ca.pem",
  };
  const reads = [];
  const options = {
    env: { ...ENV, MYSQL_MIGRATION_CONFIG: "/mock/owner.json" },
    uid: 42,
    fileStat: async () => ({ isFile: () => true, mode: 0o100600, uid: 42 }),
    read: async (path) => {
      reads.push(path);
      return path === "/mock/owner.json" ? JSON.stringify(local) : CA;
    },
  };
  assert.deepEqual(await loadConfig(options), {
    ...CONFIG,
    database: "dsh_fish_validation",
  });
  assert.deepEqual(reads, ["/mock/owner.json", "/mock/ca.pem"]);
  await assert.rejects(
    loadConfig({ ...options, production: true }),
    /production requires/,
  );
  for (const metadata of [
    { isFile: () => true, mode: 0o100640, uid: 42 },
    { isFile: () => true, mode: 0o100600, uid: 43 },
    { isFile: () => false, mode: 0o100600, uid: 42 },
  ]) {
    await assert.rejects(
      loadConfig({ ...options, fileStat: async () => metadata }),
      /owner-only/,
    );
  }
  delete local.tls_server_name;
  local.host = CONFIG.serverName;
  assert.equal((await loadConfig(options)).serverName, CONFIG.serverName);
  await assert.rejects(
    loadConfig({ ...options, read: async () => "{mock-secret invalid json" }),
    (error) => {
      assert.doesNotMatch(error.message, /mock-secret/);
      return true;
    },
  );
});

test("TLS requires CA and DNS identity and socket retains original gateway IP", () => {
  const routes = [];
  const options = connectionOptions(CONFIG, (route) => {
    routes.push(route);
    return "mock-socket";
  });
  assert.equal(options.host, CONFIG.serverName);
  assert.equal(options.stream(), "mock-socket");
  assert.deepEqual(routes, [{ host: CONFIG.host, port: CONFIG.port }]);
  assert.deepEqual(options.ssl, {
    ca: CA,
    rejectUnauthorized: true,
    verifyIdentity: true,
  });
  assert.equal(options.multipleStatements, false);
  for (const override of [
    { ca: "" },
    { ca: "/path/not-inline" },
    { serverName: "" },
    { serverName: "192.0.2.5" },
    { serverName: "bad..name" },
    { serverName: "-bad.test" },
    { port: "1.5" },
    { port: 0 },
    { port: 65536 },
    { password: "" },
  ]) {
    assert.throws(
      () => validateConfig({ ...CONFIG, ...override }),
      MigrationError,
    );
  }
});

test("discovers numbered files in sorted order with exact-content SHA256", async () => {
  const files = {
    "0010_later.sql": "SELECT 10;",
    "0001_initial.sql": INITIAL.sql,
    "0002_add.sql": "SELECT 2;\n",
  };
  const result = await discoverMigrations({
    directory: "/mock/migrations",
    list: async () => [
      "notes.txt",
      "bad.sql",
      "0002_add.sql",
      "0010_later.sql",
      "0001_initial.sql",
      "10000_bad.sql",
    ],
    read: async (path) => files[basename(path)],
  });
  assert.deepEqual(
    result.map((file) => file.version),
    ["0001_initial", "0002_add", "0010_later"],
  );
  assert.equal(
    result[1].sha256,
    createHash("sha256").update(files["0002_add.sql"]).digest("hex"),
  );
  await assert.rejects(
    discoverMigrations({ list: async () => ["0002_only.sql"] }),
    /initial/,
  );
  await assert.rejects(
    discoverMigrations({
      list: async () => ["0001_initial.sql", "0002_a.sql", "0002_b.sql"],
      read: async () => "",
    }),
    /Duplicate/,
  );
});

test("parser preserves literals and identifiers while removing comments", () => {
  const tick = String.fromCharCode(96);
  const identifiers =
    "SELECT " +
    tick +
    "a;b" +
    tick +
    ", " +
    tick +
    "a" +
    tick +
    tick +
    ";b" +
    tick;
  const insert =
    "INSERT INTO t VALUES ('a;b', 'it''s;fine', \"double;quoted\", 'escape\\';inside')";
  const sql =
    "-- lead; comment\n" +
    insert +
    "; /* ; */\n" +
    identifiers +
    "; # tail;\nSELECT 1--2;";
  assert.deepEqual(splitStatements(sql), [insert, identifiers, "SELECT 1--2"]);
  assert.deepEqual(splitStatements("SELECT 'DELIMITER; PROCEDURE'; -- tail"), [
    "SELECT 'DELIMITER; PROCEDURE'",
  ]);
  assert.equal(
    splitStatements("SELECT 'a\\'; SELECT 2;", { noBackslashEscapes: true })
      .length,
    2,
  );
  assert.equal(splitStatements("/* only comment; */ -- comment").length, 0);
});

test("parser refuses delimiter, stored programs, executable comments and malformed SQL", () => {
  for (const sql of [
    "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$",
    "CREATE PROCEDURE p() BEGIN SELECT 1; END;",
    "CREATE DEFINER=user@host TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @x=1;",
    "CREATE FUNCTION f() RETURNS INT RETURN 1;",
    "CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO SELECT 1;",
    "/*! SET @x=1 */;",
    "/*+ hint */ SELECT 1;",
    "SELECT 'unfinished",
    "SELECT 1 /* unfinished",
    'SET sql_mode="";',
  ]) {
    assert.throws(() => splitStatements(sql), MigrationError);
  }
});

test("real initial migration parses to documented 52 statements without a database", async () => {
  const files = await discoverMigrations();
  assert.equal(files[0].version, INITIAL.version);
  assert.equal(splitStatements(files[0].sql).length, 52);
});

test("completed ledger is no-op and history reads occur under advisory lock", async () => {
  const client = mockClient();
  assert.deepEqual(await run(client), { pending: [], applied: [] });
  assert.deepEqual(mutations(client), []);
  assert.ok(
    client.calls.findIndex((call) => call.sql.includes("GET_LOCK")) <
      client.calls.findIndex((call) => call.sql === "SHOW TABLES"),
  );
  assert.ok(released(client));
});

for (const [name, rows, expected] of [
  [
    "checksum drift",
    [applied(INITIAL, { sha256: "changed" })],
    /checksum changed/,
  ],
  ["incomplete history", [applied(INITIAL, { completed: 0 })], /Interrupted/],
  [
    "missing applied file",
    [applied(migration("0009_missing"))],
    /file is missing/,
  ],
  ["out-of-order history", [applied(SECOND)], /out of order/],
]) {
  test("rejects " + name + " without mutations and releases lock", async () => {
    for (const check of [false, true]) {
      const client = mockClient({ rows });
      await assert.rejects(
        run(client, { migrations: [INITIAL, SECOND], check }),
        expected,
      );
      assert.deepEqual(mutations(client), []);
      assert.ok(released(client));
    }
  });
}

test("pending migrations execute sequentially with incomplete-before-DDL and completed-after-all", async () => {
  const client = mockClient();
  assert.deepEqual(
    await run(client, { migrations: [INITIAL, SECOND, THIRD] }),
    { pending: [], applied: [SECOND.version, THIRD.version] },
  );
  assert.deepEqual(
    mutations(client).map((call) => call.sql),
    [
      "INSERT INTO _mysql_migrations VALUES (?, ?, false)",
      SECOND.sql.slice(0, -1),
      "UPDATE _mysql_migrations SET completed=true WHERE version=?",
      "INSERT INTO _mysql_migrations VALUES (?, ?, false)",
      THIRD.sql.slice(0, -1),
      "UPDATE _mysql_migrations SET completed=true WHERE version=?",
    ],
  );
  assert.ok(client.rows.every((row) => row.completed === 1));
});

test("initial only applies on empty target and creates unchanged ledger definition", async () => {
  const client = mockClient({ tables: [], rows: [] });
  await run(client);
  assert.match(
    mutations(client)[0].sql,
    /version varchar\(255\) PRIMARY KEY, sha256 varchar\(64\) NOT NULL, completed boolean NOT NULL/,
  );
  assert.equal(client.rows[0].completed, 1);
  for (const check of [true, false]) {
    const nonempty = mockClient({ tables: ["existing"], rows: [] });
    await assert.rejects(run(nonempty, { check }), /empty target/);
    assert.deepEqual(mutations(nonempty), []);
  }
});

test("--check reports pending without creating ledger or applying SQL", async () => {
  for (const client of [mockClient({ tables: [], rows: [] }), mockClient()]) {
    const logs = [];
    const result = await run(client, {
      migrations: [INITIAL, SECOND],
      check: true,
      log: (line) => logs.push(line),
    });
    assert.ok(result.pending.includes(SECOND.version));
    assert.match(logs[0], /pending: .*0002_add_column/);
    assert.deepEqual(mutations(client), []);
    assert.ok(released(client));
  }
});

test("SQL failure sanitized, leaves incomplete marker and next deploy refuses partial work", async () => {
  const file = migration(
    SECOND.version,
    "ALTER TABLE example ADD first int; ALTER TABLE example ADD second int;",
  );
  const client = mockClient({ failSql: (sql) => sql.includes("ADD second") });
  const logs = [];
  await assert.rejects(
    run(client, {
      migrations: [INITIAL, file, THIRD],
      log: (line) => logs.push(line),
    }),
    (error) => {
      assert.ok(error instanceof MigrationError);
      assert.doesNotMatch(
        error.message + error.stack,
        /mock-secret|private-value|raw SQL/,
      );
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.equal(client.rows[1].completed, 0);
  assert.equal(client.rows.length, 2);
  assert.deepEqual(logs, []);
  assert.ok(released(client));
  const retry = mockClient({ rows: client.rows });
  await assert.rejects(
    run(retry, { migrations: [INITIAL, file, THIRD] }),
    /Interrupted/,
  );
  assert.deepEqual(mutations(retry), []);
});

test("unsupported pending SQL preflighted before any migration mutation", async () => {
  const client = mockClient();
  await assert.rejects(
    run(client, {
      migrations: [INITIAL, SECOND, migration(THIRD.version, "DELIMITER $$")],
    }),
    /DELIMITER/,
  );
  assert.deepEqual(mutations(client), []);
  assert.ok(released(client));
});

test("lock denial stops deployment without reading history or releasing unowned lock", async () => {
  const client = mockClient({ acquire: 0 });
  await assert.rejects(run(client), /advisory lock/);
  assert.equal(client.calls.length, 2);
  assert.equal(released(client), false);
});

test("release failure stops deployment and wrong connected database rejected", async () => {
  await assert.rejects(run(mockClient({ release: 0 })), /lock release failed/);
  const other = mockClient({ database: "other" });
  await assert.rejects(run(other), /does not match/);
  assert.equal(other.calls.length, 1);
});

test("concurrent deployment checks wait for lock and see completed predecessor", async () => {
  const rows = [applied(INITIAL)];
  let held = false;
  const waiters = [];
  function client() {
    const db = mockClient({ rows });
    const query = db.query.bind(db);
    db.query = async (sql, params) => {
      if (sql.startsWith("SELECT GET_LOCK")) {
        if (held) await new Promise((resolve) => waiters.push(resolve));
        held = true;
      }
      const result = await query(sql, params);
      if (sql.startsWith("SELECT RELEASE_LOCK")) {
        held = false;
        waiters.shift()?.();
      }
      return result;
    };
    return db;
  }
  const first = client(),
    second = client();
  const results = await Promise.all([
    run(first, { migrations: [INITIAL, SECOND] }),
    run(second, { migrations: [INITIAL, SECOND] }),
  ]);
  assert.deepEqual(
    results.map((result) => result.applied),
    [[SECOND.version], []],
  );
  assert.equal(rows.length, 2);
  assert.ok(released(first) && released(second));
});

test("CLI mock --check closes connection and emits only sanitized failures", async () => {
  const files = await discoverMigrations();
  const client = mockClient({ rows: files.map((file) => applied(file)) });
  const logs = [],
    errors = [];
  const options = {
    env: ENV,
    args: ["--production", "--check"],
    log: (line) => logs.push(line),
    errorLog: (line) => errors.push(line),
  };
  assert.equal(await main({ ...options, connect: async () => client }), 0);
  assert.equal(client.ended, true);
  assert.deepEqual(mutations(client), []);
  assert.deepEqual(errors, []);
  assert.match(logs[0], /pending: none/);
  const failing = mockClient({ failSql: (sql) => sql === "SHOW TABLES" });
  assert.equal(await main({ ...options, connect: async () => failing }), 1);
  assert.equal(failing.ended, true);
  assert.ok(released(failing));
  assert.doesNotMatch(
    errors.join(" "),
    /mock-secret|raw SQL|private-value|mock-migrator/,
  );
  assert.equal(
    await main({
      ...options,
      args: ["--unsafe"],
      connect: async () => assert.fail("must not connect"),
    }),
    1,
  );
});

test("ANSI_QUOTES identifiers do not interpret backslash as quote escaping", async () => {
  const sql = 'SELECT "identifier\\"; SELECT 2;';
  assert.equal(splitStatements(sql, { ansiQuotes: true }).length, 2);
  const file = migration(SECOND.version, sql);
  const client = mockClient({ sqlMode: "ANSI_QUOTES,NO_BACKSLASH_ESCAPES" });
  await run(client, { migrations: [INITIAL, file] });
  assert.equal(client.rows[1].completed, 1);
});

test("failed completion update leaves incomplete record and releases lock", async () => {
  const client = mockClient({
    failSql: (sql) => sql.startsWith("UPDATE _mysql_migrations"),
  });
  await assert.rejects(
    run(client, { migrations: [INITIAL, SECOND] }),
    MigrationError,
  );
  assert.equal(client.rows[1].completed, 0);
  assert.ok(released(client));
});

test("raw lock and release errors cannot expose SQL or credentials", async () => {
  for (const failSql of [
    (sql) => sql.includes("GET_LOCK"),
    (sql) => sql.includes("RELEASE_LOCK"),
  ]) {
    const client = mockClient({ failSql });
    await assert.rejects(run(client), (error) => {
      assert.doesNotMatch(error.message, /mock-secret|raw SQL|private-value/);
      return true;
    });
  }
});

test("CLI connection failure and cleanup failure stop deployment with safe messages", async () => {
  const errors = [];
  const options = {
    env: ENV,
    args: ["--check"],
    log() {},
    errorLog: (line) => errors.push(line),
  };
  assert.equal(
    await main({
      ...options,
      connect: async () => {
        throw new Error("password=mock-secret");
      },
    }),
    1,
  );
  const files = await discoverMigrations();
  const client = mockClient({ rows: files.map(applied) });
  client.end = async () => {
    throw new Error("raw SQL private-value");
  };
  assert.equal(await main({ ...options, connect: async () => client }), 1);
  assert.doesNotMatch(errors.join(" "), /mock-secret|raw SQL|private-value/);
});

test("history validates every applied file and identifies only new pending versions", () => {
  assert.deepEqual(
    validateHistory(
      [INITIAL, SECOND, THIRD],
      [applied(INITIAL), applied(SECOND)],
    ),
    [THIRD],
  );
  assert.throws(
    () => validateHistory([INITIAL], [applied(INITIAL), applied(INITIAL)]),
    /Duplicate/,
  );
});
