"use strict";

// tests/validate.test.js — unit tests for lib/validate.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { validate } = require("../lib/validate");

// Minimal mock Express objects.
function makeReq(body) {
  return { body };
}
function makeRes() {
  const res = {};
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._json = body; return res; };
  return res;
}
function noop() {}

// --- validate() basic contract ---

test("validate: passes when schema is satisfied, replaces req.body with parsed output", () => {
  const schema = z.object({ name: z.string().min(1) });
  const middleware = validate(schema);
  const req = makeReq({ name: "  Alice  " });
  let called = false;
  middleware(req, makeRes(), () => { called = true; });
  assert.ok(called, "next() should be called on success");
  assert.equal(req.body.name, "  Alice  "); // no trimming unless schema trims
});

test("validate: strips unknown keys via .strip() default on z.object", () => {
  const schema = z.object({ name: z.string() });
  const middleware = validate(schema);
  const req = makeReq({ name: "Alice", injected: "evil" });
  middleware(req, makeRes(), noop);
  assert.ok(!("injected" in req.body), "unknown keys should be stripped");
});

test("validate: coerces values per schema (preprocess trim)", () => {
  const schema = z.object({ name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1)) });
  const middleware = validate(schema);
  const req = makeReq({ name: "  Bob  " });
  middleware(req, makeRes(), noop);
  assert.equal(req.body.name, "Bob");
});

test("validate: calls next(err) with status 400 + fields when invalid and no onInvalid", () => {
  const schema = z.object({ name: z.string().min(1) });
  const middleware = validate(schema);
  const req = makeReq({ name: "" });
  let errPassed;
  middleware(req, makeRes(), (err) => { errPassed = err; });
  assert.ok(errPassed, "next should be called with an error");
  assert.equal(errPassed.status, 400);
  assert.ok(errPassed.fields, "err.fields should be set");
  assert.ok(Array.isArray(errPassed.fields.name), "fields.name should be an array of messages");
});

test("validate: calls onInvalid(req, res, zodError) when provided", () => {
  const schema = z.object({ name: z.string().min(1) });
  let calledWith = null;
  const onInvalid = (req, res, zodError) => { calledWith = { req, res, zodError }; };
  const middleware = validate(schema, { onInvalid });
  const req = makeReq({ name: "" });
  const res = makeRes();
  middleware(req, res, noop);
  assert.ok(calledWith !== null, "onInvalid should be called");
  assert.strictEqual(calledWith.req, req);
  assert.strictEqual(calledWith.res, res);
  assert.ok(calledWith.zodError.flatten, "zodError should be a ZodError");
});

test("validate: source option reads from req.params instead of req.body", () => {
  const schema = z.object({ id: z.string().min(1) });
  const middleware = validate(schema, { source: "params" });
  const req = { params: { id: "abc" }, body: {} };
  let called = false;
  middleware(req, makeRes(), () => { called = true; });
  assert.ok(called);
  assert.equal(req.params.id, "abc");
});

test("validate: missing body does not throw (gracefully fails)", () => {
  const schema = z.object({ name: z.string() });
  const middleware = validate(schema);
  const req = { body: undefined };
  let errPassed;
  middleware(req, makeRes(), (err) => { errPassed = err; });
  assert.ok(errPassed, "should pass error to next when body is undefined");
  assert.equal(errPassed.status, 400);
});
