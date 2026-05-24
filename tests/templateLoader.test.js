"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const db = require("../lib/db");
const { loadTemplatesFromDisk } = require("../lib/templateLoader");

function freshDb() {
  return db.initDb(":memory:");
}

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-tpl-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(dir, name, contents) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
  return full;
}

const VALID = {
  id: "test-template-v1",
  name: "Test Template",
  version: 1,
  axes: [
    {
      name: "Axis A",
      description: "First axis.",
      questions: [
        { text: "Q1", reverse: false },
        { text: "Q2", reverse: true }
      ]
    },
    {
      name: "Axis B",
      description: "Second axis.",
      questions: [{ text: "Q3", reverse: false }]
    }
  ]
};

test("loader inserts a valid template, axes, and questions", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "valid.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);

  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0], "test-template-v1");
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);

  const tpl = db.getTemplateById(conn, "test-template-v1");
  assert.ok(tpl);
  assert.equal(tpl.name, "Test Template");
  assert.equal(tpl.version, 1);

  const axes = db.getAxesForTemplate(conn, "test-template-v1");
  assert.equal(axes.length, 2);
  assert.equal(axes[0].name, "Axis A");

  const qs = db.getQuestionsForTemplate(conn, "test-template-v1");
  assert.equal(qs.length, 3);
  assert.equal(qs[0].text, "Q1");
  assert.equal(qs[1].is_reverse_scored, 1);

  conn.close();
});

test("loader is idempotent — running twice does not duplicate", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "valid.json", VALID);

  loadTemplatesFromDisk(conn, dir);
  const second = loadTemplatesFromDisk(conn, dir);

  assert.equal(second.imported.length, 0);
  assert.equal(second.skipped.length, 1);
  assert.equal(second.skipped[0], "test-template-v1");

  const all = db.listTemplates(conn).filter((t) => t.id === "test-template-v1");
  assert.equal(all.length, 1);
  conn.close();
});

test("loader treats a missing directory as empty (no error)", (t) => {
  const conn = freshDb();
  const result = loadTemplatesFromDisk(conn, "/tmp/does-not-exist-signal-xyz");
  assert.equal(result.imported.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);
  conn.close();
});

test("loader treats an empty directory as empty (no error)", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  conn.close();
});

test("loader skips a file with bad JSON and continues", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "bad.json", "{ not json");
  writeFile(dir, "good.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);

  assert.equal(result.imported.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].file, /bad\.json$/);
  assert.match(result.errors[0].reason, /JSON|parse/i);
  conn.close();
});

test("loader rejects a file with no id", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  const noId = { ...VALID };
  delete noId.id;
  writeFile(dir, "no-id.json", noId);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /id/i);
  conn.close();
});

test("loader rejects a file with an empty axes array", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "no-axes.json", { ...VALID, axes: [] });

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /axes/i);
  conn.close();
});

test("loader rejects a question missing the reverse field", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  const noReverse = JSON.parse(JSON.stringify(VALID));
  delete noReverse.axes[0].questions[0].reverse;
  writeFile(dir, "no-reverse.json", noReverse);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /reverse/i);
  conn.close();
});

test("loader rejects two files with the same id (second is skipped)", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "a.json", VALID);
  writeFile(dir, "b.json", VALID);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /duplicate/i);
  conn.close();
});

test("loader rejects a file whose root is a JSON array", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "array.json", [1, 2, 3]);

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /JSON object/i);
  conn.close();
});

test("loader rejects a file whose root is a JSON string", (t) => {
  const conn = freshDb();
  const dir = makeTempDir(t);
  writeFile(dir, "string.json", '"hello"');

  const result = loadTemplatesFromDisk(conn, dir);
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /JSON object/i);
  conn.close();
});
