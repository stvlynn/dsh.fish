import { describe, expect, it } from "vitest";

import {
  builtDeploySteps,
  productionDeploySteps,
  mysqlDeploySteps,
  runProductionDeploy,
} from "./deploy-production.mjs";

describe("production deployment", () => {
  it("builds, migrates production D1, and only then deploys the Worker", () => {
    expect(productionDeploySteps).toEqual([
      { id: "build", command: "pnpm", args: ["run", "build"] },
      {
        id: "migrate",
        command: "pnpm",
        args: ["run", "db:migrate:remote"],
      },
      { id: "deploy", command: "wrangler", args: ["deploy"] },
    ]);
  });

  it("does not rebuild artifacts already produced by Workers Builds", () => {
    expect(builtDeploySteps).toEqual([
      {
        id: "migrate",
        command: "pnpm",
        args: ["run", "db:migrate:remote"],
      },
      { id: "deploy", command: "wrangler", args: ["deploy"] },
    ]);
  });

  it("migrates only the production MySQL target before upload", () => {
    expect(mysqlDeploySteps.map(step => step.id)).toEqual(["build", "migrate-mysql", "deploy"]);
    expect(mysqlDeploySteps[1].args).toEqual(["../backend/scripts/migrate-mysql.mjs", "--production"]);
  });

  it("does not deploy when a MySQL migration fails", async () => {
    const attempted = [];
    await expect(runProductionDeploy({ steps: mysqlDeploySteps, run: async step => {
      attempted.push(step.id);
      if (step.id === "migrate-mysql") throw new Error("mysql migration failed");
    }})).rejects.toThrow("mysql migration failed");
    expect(attempted).toEqual(["build", "migrate-mysql"]);
  });

  it("does not deploy when a migration fails", async () => {
    const attempted = [];
    const migrationError = new Error("migration failed");

    await expect(
      runProductionDeploy({
        run: async (step) => {
          attempted.push(step.id);
          if (step.id === "migrate") throw migrationError;
        },
      }),
    ).rejects.toBe(migrationError);

    expect(attempted).toEqual(["build", "migrate"]);
  });
});
