"use strict";

/**
 * lib/templateLoader.js — load extra question templates from JSON files.
 *
 * On server boot we look in `templates/` for `*.json` files. Each valid
 * file becomes one template in the DB. If a template with the same `id`
 * already exists, we skip the file (import-once contract). A broken file
 * never aborts boot: it is logged and skipped.
 *
 * The hardcoded "Agile Health Check" seed in lib/db.js is independent —
 * file-based templates are purely additive.
 */

const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const { logger } = require("./logger.js");

function validateBundle(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "file must contain a JSON object";
  }
  if (typeof parsed.id !== "string" || !parsed.id.trim()) {
    return "missing or empty 'id'";
  }
  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    return "missing or empty 'name'";
  }
  if (!Number.isInteger(parsed.version) || parsed.version < 1) {
    return "'version' must be a positive integer";
  }
  if (!Array.isArray(parsed.axes) || parsed.axes.length === 0) {
    return "'axes' must be a non-empty array";
  }
  for (let i = 0; i < parsed.axes.length; i += 1) {
    const axis = parsed.axes[i];
    if (!axis || typeof axis !== "object") {
      return `axis #${i} is not an object`;
    }
    if (typeof axis.name !== "string" || !axis.name.trim()) {
      return `axis #${i} is missing 'name'`;
    }
    if (typeof axis.description !== "string" || !axis.description.trim()) {
      return `axis '${axis.name}' is missing 'description'`;
    }
    if (!Array.isArray(axis.questions) || axis.questions.length === 0) {
      return `axis '${axis.name}' has no questions`;
    }
    for (let j = 0; j < axis.questions.length; j += 1) {
      const q = axis.questions[j];
      if (!q || typeof q !== "object") {
        return `question #${j} in '${axis.name}' is not an object`;
      }
      if (typeof q.text !== "string" || !q.text.trim()) {
        return `question #${j} in '${axis.name}' is missing 'text'`;
      }
      if (typeof q.reverse !== "boolean") {
        return `question #${j} in '${axis.name}' is missing boolean 'reverse'`;
      }
    }
  }
  return null;
}

/**
 * Scan `templatesDir` for *.json files, validate each, insert any that
 * are not already present in the DB.
 *
 * Returns { imported: string[], skipped: string[], errors: [{file, reason}] }
 * — the ids that were inserted, the ids that were already present, and
 * any files that failed validation.
 */
function loadTemplatesFromDisk(conn, templatesDir) {
  const result = { imported: [], skipped: [], errors: [] };

  let entries;
  try {
    entries = fs.readdirSync(templatesDir);
  } catch (err) {
    if (err.code === "ENOENT") return result; // dir missing = no templates
    result.errors.push({ file: templatesDir, reason: `cannot read directory: ${err.message}` });
    logger.error({ err, templatesDir }, "templateLoader: cannot read directory");
    return result;
  }

  const files = entries.filter((f) => f.endsWith(".json")).sort();
  const seenIds = new Set();

  for (const file of files) {
    const full = path.join(templatesDir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (err) {
      result.errors.push({ file: full, reason: `JSON parse error: ${err.message}` });
      logger.error({ err, file }, "templateLoader: JSON parse error");
      continue;
    }

    const problem = validateBundle(parsed);
    if (problem) {
      result.errors.push({ file: full, reason: problem });
      logger.error({ file, problem }, "templateLoader: validation failed");
      continue;
    }

    if (seenIds.has(parsed.id)) {
      const reason = `duplicate id '${parsed.id}' across files`;
      result.errors.push({ file: full, reason });
      logger.error({ file, reason }, "templateLoader: duplicate id across files");
      continue;
    }
    seenIds.add(parsed.id);

    if (db.getTemplateById(conn, parsed.id)) {
      result.skipped.push(parsed.id);
      logger.info({ templateId: parsed.id }, "templateLoader: already imported, skipping");
      continue;
    }

    try {
      db.insertTemplateBundle(conn, parsed);
      result.imported.push(parsed.id);
      logger.info({ templateId: parsed.id, name: parsed.name, version: parsed.version }, "templateLoader: imported");
    } catch (err) {
      result.errors.push({ file: full, reason: `DB insert failed: ${err.message}` });
      logger.error({ err, file }, "templateLoader: DB insert failed");
    }
  }

  return result;
}

module.exports = { loadTemplatesFromDisk };
