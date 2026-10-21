import { readFile, stat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection as createSocket, isIP } from "node:net";

const MIGRATION_PATTERN = /^[0-9]{4}_.+\.sql$/;
const INITIAL_VERSION = "0001_initial";
const LEDGER = "_mysql_migrations";
const BACKTICK = String.fromCharCode(96);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class MigrationError extends Error {}

function fail(message) {
  throw new MigrationError(message);
}

// Never attach a driver error/cause: it can contain SQL, passwords or user data.
export function sanitizedError(error) {
  return error instanceof MigrationError
    ? error
    : new MigrationError(
        "MySQL migration failed; inspect the target securely before retrying.",
      );
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim())
    fail("Missing or invalid migration configuration: " + name + ".");
  return value;
}

export function validateConfig(
  config,
  { production = false, local = false } = {},
) {
  if (config === null || typeof config !== "object")
    fail("Invalid migration configuration.");
  if (
    config.database !== "dsh_fish" &&
    !(local && !production && config.database === "dsh_fish_validation")
  ) {
    fail(
      "Unexpected migration target; production requires dsh_fish and validation requires explicit local configuration.",
    );
  }
  const host = required(config.host, "host");
  const serverName = required(config.serverName, "TLS server name");
  if (
    isIP(serverName) ||
    !/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
      serverName,
    ) ||
    serverName
      .split(".")
      .some(
        (label) =>
          !label ||
          label.length > 63 ||
          label.startsWith("-") ||
          label.endsWith("-"),
      )
  ) {
    fail("TLS server name must be a DNS hostname.");
  }
  const port = Number(config.port);
  if (
    !/^[0-9]+$/.test(String(config.port)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    fail("Invalid migration port.");
  const ca = required(config.ca, "TLS CA");
  if (
    !ca.includes("-----BEGIN CERTIFICATE-----") ||
    !ca.includes("-----END CERTIFICATE-----")
  )
    fail("TLS CA must be inline PEM certificate data.");
  return {
    host,
    port,
    database: config.database,
    user: required(config.user, "migration user"),
    password: required(config.password, "migration password"),
    serverName,
    ca,
  };
}

export async function loadConfig({
  env = process.env,
  production = false,
  read = readFile,
  fileStat = stat,
  uid = process.getuid?.(),
} = {}) {
  try {
    if (env.MYSQL_MIGRATION_CONFIG) {
      const metadata = await fileStat(env.MYSQL_MIGRATION_CONFIG);
      if (
        !metadata.isFile() ||
        (metadata.mode & 0o077) !== 0 ||
        (uid !== undefined && metadata.uid !== uid)
      ) {
        fail(
          "Local migration configuration must be an owner-only file owned by the current user.",
        );
      }
      const local = JSON.parse(await read(env.MYSQL_MIGRATION_CONFIG, "utf8"));
      if (local === null || typeof local !== "object")
        fail("Invalid local migration configuration.");
      const ca = await read(required(local.ca, "local CA file"), "utf8");
      return validateConfig(
        {
          host: local.host,
          port: local.port,
          database: local.database,
          user: local.admin_user,
          password: local.admin_password,
          serverName: local.tls_server_name ?? local.host,
          ca,
        },
        { local: true, production },
      );
    }
    return validateConfig(
      {
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        database: env.MYSQL_DATABASE,
        user: env.MYSQL_MIGRATION_USER,
        password: env.MYSQL_MIGRATION_PASSWORD,
        serverName: env.MYSQL_TLS_SERVER_NAME,
        ca: env.MYSQL_SSL_CA,
      },
      { production },
    );
  } catch (error) {
    throw sanitizedError(error);
  }
}

export function connectionOptions(config, socket = createSocket) {
  return {
    // mysql2 uses host for SNI/identity. The socket still routes to the original gateway IP.
    host: config.serverName,
    port: config.port,
    database: config.database,
    stream: () => socket({ host: config.host, port: config.port }),
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    connectTimeout: 10000,
    multipleStatements: false,
    ssl: { ca: config.ca, rejectUnauthorized: true, verifyIdentity: true },
  };
}

// Parse the MySQL quote/comment grammar, not a semicolon-delimited text approximation.
// Executable comments and stored programs need a dedicated parser and are refused.
export function splitStatements(
  sql,
  { noBackslashEscapes = false, ansiQuotes = false } = {},
) {
  const statements = [];
  let text = "";
  let code = "";
  let quote = null;
  let comment = null;
  function finish() {
    if (!text.trim()) return;
    if (/\bDELIMITER\b/i.test(code))
      fail("DELIMITER directives are unsupported in MySQL migrations.");
    if (/\bCREATE\b[\s\S]*\b(PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i.test(code)) {
      fail(
        "Stored procedures, functions, triggers and events are unsupported in MySQL migrations.",
      );
    }
    if (/\bSQL_MODE\b/i.test(code))
      fail("Changing SQL_MODE inside migrations is unsupported.");
    statements.push(text.trim());
    text = "";
    code = "";
  }
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (comment === "line") {
      if (char === "\n" || char === "\r") {
        comment = null;
        text += "\n";
        code += "\n";
      }
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") {
        comment = null;
        i++;
        text += " ";
        code += " ";
      }
      continue;
    }
    if (quote) {
      text += char;
      if (
        char === "\\" &&
        !noBackslashEscapes &&
        quote !== BACKTICK &&
        !(ansiQuotes && quote === '"')
      ) {
        if (next !== undefined) {
          text += next;
          i++;
        }
      } else if (char === quote) {
        if (next === quote) {
          text += next;
          i++;
        } else {
          quote = null;
          code += " ";
        }
      }
      continue;
    }
    if (
      char === "#" ||
      (char === "-" &&
        next === "-" &&
        (sql[i + 2] === undefined || /\s/.test(sql[i + 2])))
    ) {
      comment = "line";
      if (char === "-") i++;
    } else if (char === "/" && next === "*") {
      if (sql[i + 2] === "!" || sql[i + 2] === "+")
        fail("Executable SQL comments are unsupported in MySQL migrations.");
      comment = "block";
      i++;
    } else if (char === "'" || char === '"' || char === BACKTICK) {
      quote = char;
      text += char;
      code += " ";
    } else if (char === ";") {
      finish();
    } else {
      text += char;
      code += char;
    }
  }
  if (quote || comment === "block")
    fail("Unterminated SQL literal or comment in migration.");
  finish();
  return statements;
}

export async function discoverMigrations({
  directory = resolve(ROOT, "mysql-migrations"),
  list = readdir,
  read = readFile,
} = {}) {
  try {
    const names = (await list(directory))
      .filter((name) => MIGRATION_PATTERN.test(name))
      .sort();
    if (!names.length || names[0] !== INITIAL_VERSION + ".sql")
      fail("The initial MySQL migration file is required.");
    const versions = new Set();
    const migrations = [];
    for (const name of names) {
      const number = name.slice(0, 4);
      if (versions.has(number))
        fail("Duplicate MySQL migration version number.");
      versions.add(number);
      const sql = await read(resolve(directory, name), "utf8");
      migrations.push({
        version: name.slice(0, -4),
        sha256: createHash("sha256").update(sql).digest("hex"),
        sql,
      });
    }
    return migrations;
  } catch (error) {
    throw sanitizedError(error);
  }
}

export function validateHistory(migrations, rows) {
  const files = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  const applied = new Set();
  for (const row of rows) {
    const file = files.get(row.version);
    if (!file)
      fail(
        "Applied migration file is missing; restore the original migration before deploying.",
      );
    if (row.completed !== 1 && row.completed !== true)
      fail(
        "Interrupted MySQL migration; inspect and reconcile the target before retrying.",
      );
    if (row.sha256 !== file.sha256)
      fail(
        "Applied migration checksum changed; restore the original migration before deploying.",
      );
    if (applied.has(row.version)) fail("Duplicate applied MySQL migration.");
    applied.add(row.version);
  }
  let pendingSeen = false;
  for (const migration of migrations) {
    if (!applied.has(migration.version)) pendingSeen = true;
    else if (pendingSeen)
      fail("Applied MySQL migration history is out of order.");
  }
  return migrations.filter((migration) => !applied.has(migration.version));
}

export async function runMigrations(
  client,
  {
    config,
    migrations,
    check = false,
    lockTimeout = 60,
    log = console.log,
  } = {},
) {
  let locked = false;
  let result;
  let failure;
  const lockName = "dsh-fish:mysql-migrations:" + config.database;
  try {
    result = await (async () => {
      const [identity] = await client.query(
        "SELECT DATABASE() AS database_name, @@SESSION.sql_mode AS sql_mode",
      );
      if (identity[0]?.database_name !== config.database)
        fail("Connected MySQL database does not match the migration target.");
      const [lock] = await client.query("SELECT GET_LOCK(?, ?) AS acquired", [
        lockName,
        lockTimeout,
      ]);
      if (lock[0]?.acquired !== 1)
        fail(
          "Could not acquire MySQL migration advisory lock; deployment stopped.",
        );
      locked = true;
      const [tables] = await client.query("SHOW TABLES");
      const tableNames = tables.map((row) => Object.values(row)[0]);
      const hasLedger = tableNames.includes(LEDGER);
      const [rows] = hasLedger
        ? await client.query(
            "SELECT version, sha256, completed FROM _mysql_migrations ORDER BY version",
          )
        : [[]];
      const pending = validateHistory(migrations, rows);
      if (
        pending.some((migration) => migration.version === INITIAL_VERSION) &&
        tableNames.some((name) => name !== LEDGER)
      ) {
        fail(
          "Initial migration requires an empty target; refusing to overwrite existing data.",
        );
      }
      // Preflight every pending file before any ledger mutation or DDL.
      const plans = pending.map((migration) => ({
        ...migration,
        statements: splitStatements(migration.sql, {
          noBackslashEscapes: (identity[0].sql_mode ?? "")
            .split(",")
            .includes("NO_BACKSLASH_ESCAPES"),
          ansiQuotes: (identity[0].sql_mode ?? "")
            .split(",")
            .includes("ANSI_QUOTES"),
        }),
      }));
      if (plans.some((plan) => plan.statements.length === 0))
        fail("Empty MySQL migration is unsupported.");
      if (check) {
        log(
          "MySQL migration history verified; pending: " +
            (pending.map((migration) => migration.version).join(", ") ||
              "none") +
            ".",
        );
        return {
          pending: pending.map((migration) => migration.version),
          applied: [],
        };
      }
      if (plans.length && !hasLedger) {
        await client.query(
          "CREATE TABLE IF NOT EXISTS _mysql_migrations (version varchar(255) PRIMARY KEY, sha256 varchar(64) NOT NULL, completed boolean NOT NULL) ENGINE=InnoDB",
        );
      }
      for (const migration of plans) {
        await client.query(
          "INSERT INTO _mysql_migrations VALUES (?, ?, false)",
          [migration.version, migration.sha256],
        );
        for (const statement of migration.statements)
          await client.query(statement);
        await client.query(
          "UPDATE _mysql_migrations SET completed=true WHERE version=?",
          [migration.version],
        );
        log(
          "Applied MySQL migration: " +
            migration.version +
            "; statements: " +
            migration.statements.length +
            ".",
        );
      }
      if (!plans.length)
        log("MySQL migration history verified; no pending migrations.");
      return {
        pending: [],
        applied: plans.map((migration) => migration.version),
      };
    })();
  } catch (error) {
    failure = sanitizedError(error);
  }
  if (locked) {
    try {
      const [release] = await client.query(
        "SELECT RELEASE_LOCK(?) AS released",
        [lockName],
      );
      if (release[0]?.released !== 1)
        fail(
          "MySQL migration advisory lock release failed; deployment stopped.",
        );
    } catch (error) {
      // Cleanup must stop deployment, but must not replace an earlier migration failure.
      failure ??= sanitizedError(error);
    }
  }
  if (failure) throw failure;
  return result;
}

export async function main({
  args = process.argv.slice(2),
  env = process.env,
  connect,
  log = console.log,
  errorLog = console.error,
} = {}) {
  let client;
  let exitCode = 0;
  try {
    if (args.some((arg) => arg !== "--production" && arg !== "--check"))
      fail("Unsupported MySQL migration argument.");
    const config = await loadConfig({
      env,
      production: args.includes("--production"),
    });
    const migrations = await discoverMigrations();
    const create = connect ?? (await import("mysql2/promise")).createConnection;
    client = await create(connectionOptions(config));
    await runMigrations(client, {
      config,
      migrations,
      check: args.includes("--check"),
      log,
    });
  } catch (error) {
    errorLog(sanitizedError(error).message);
    exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        errorLog("MySQL migration connection cleanup failed.");
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
