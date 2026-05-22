"use strict";

/**
 * lib/buildInfo.js — version + git commit for the /health endpoint.
 *
 * Copied from the suite house pattern. Reads the package version and the
 * current git commit; env overrides (SIGNAL_VERSION / SIGNAL_COMMIT, or the
 * CI-supplied GITHUB_SHA) take precedence so a deployed build with no .git
 * directory still reports a commit.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function normalizeCommit(value) {
  const commit = String(value || "").trim();
  return commit ? commit.slice(0, 12) : null;
}

function readPackageVersion(baseDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(baseDir, "package.json"), "utf8")
    );
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function readGitCommit(baseDir) {
  try {
    return normalizeCommit(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: baseDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
    );
  } catch {
    return null;
  }
}

function getBuildInfo(baseDir, env = process.env) {
  return {
    version: env.SIGNAL_VERSION || readPackageVersion(baseDir) || "unknown",
    commit:
      normalizeCommit(env.SIGNAL_COMMIT || env.GITHUB_SHA) ||
      readGitCommit(baseDir) ||
      "unknown"
  };
}

module.exports = {
  getBuildInfo,
  normalizeCommit,
  readGitCommit,
  readPackageVersion
};
