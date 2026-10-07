import { test } from "node:test";
import assert from "node:assert/strict";
import { CalcError, complete, evaluate, format, preview, pretty, tokenize } from "../src/engine.js";

test("follows operator precedence and brackets", () => {
  assert.equal(evaluate("2+3*4"), 14);
  assert.equal(evaluate("(2+3)*4"), 20);
  assert.equal(evaluate("2(3+4)"), 14);
  assert.equal(evaluate("10-4-3"), 3);
  assert.equal(evaluate("48/4/2"), 6);
});

test("handles negative numbers", () => {
  assert.equal(evaluate("-5+2"), -3);
  assert.equal(evaluate("5*-2"), -10);
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("-(2+3)"), -5);
});

test("hides floating point noise", () => {
  assert.equal(evaluate("0.1+0.2"), 0.3);
  assert.equal(evaluate("1/3*3"), 1);
  assert.equal(Object.is(evaluate("-0*5"), -0), false);
});

test("percent works like a phone calculator", () => {
  assert.equal(evaluate("10%"), 0.1);
  assert.equal(evaluate("200+10%"), 220);
  assert.equal(evaluate("200-10%"), 180);
  assert.equal(evaluate("50*10%"), 5);
  assert.equal(evaluate("50%*2"), 1);
});

test("accepts display symbols and e-notation results", () => {
  assert.equal(evaluate("6×7"), 42);
  assert.equal(evaluate("9÷3−1"), 2);
  assert.equal(evaluate("1e+21*2"), 2e21);
});

test("reports mistakes instead of running arbitrary code", () => {
  assert.throws(() => evaluate("5/0"), (error) => error instanceof CalcError && /divide by zero/.test(error.message));
  assert.throws(() => evaluate("5+"), CalcError);
  assert.throws(() => evaluate("(5"), /Missing \)/);
  assert.throws(() => evaluate("5)"), /Unexpected "\)"/);
  assert.throws(() => evaluate("alert(1)"), CalcError);
  assert.throws(() => evaluate(""), /Nothing to calculate/);
  assert.throws(() => tokenize("2+a"), CalcError);
});

test("complete drops trailing operators and closes brackets", () => {
  assert.equal(complete("5*(2+"), "5*(2)");
  assert.equal(complete("((1+2"), "((1+2))");
  assert.equal(complete("("), "");
});

test("preview shows a live answer only once there is a sum", () => {
  assert.equal(preview("5"), null);
  assert.equal(preview("-5"), null);
  assert.equal(preview("5+"), null);
  assert.equal(preview("2*(3+4"), 14);
  assert.equal(preview("5/0"), null);
});

test("format groups digits and switches to e-notation at the extremes", () => {
  assert.equal(format(1234567.891), "1,234,567.891");
  assert.equal(format(0.25), "0.25");
  assert.equal(format(2e21), "2e21");
  assert.equal(format(1.23e-10), "1.23e-10");
  assert.equal(format(0), "0");
});

test("pretty shows the typed sum with real signs", () => {
  assert.equal(pretty("1234*-5/2"), "1,234×−5÷2");
  assert.equal(pretty("1000.5+0."), "1,000.5+0.");
});
