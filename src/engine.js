// Safe arithmetic for the calculator: a small tokenizer and recursive-descent parser instead of eval(),
// so typed or pasted text can only ever be maths. Pure functions, covered by tests/engine.test.js.

export class CalcError extends Error {
  name = "CalcError";
}

const OPERATORS = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", x: "*", X: "*", "/": "/", "÷": "/" };
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const number = NUMBER.exec(input.slice(i));
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]), text: number[0] });
      i += number[0].length;
      continue;
    }
    if (OPERATORS[char]) tokens.push({ type: "operator", value: OPERATORS[char], text: char });
    else if (char === "%" || char === "(" || char === ")") tokens.push({ type: char, text: char });
    else throw new CalcError(`"${char}" isn't something I can calculate`);
    i++;
  }
  return tokens;
}

/** Round away float noise (0.1 + 0.2) and negative zero. */
export function tidy(value) {
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Evaluate an arithmetic expression: + − × ÷, parentheses, unary minus, implicit multiplication
 * before "(", and % like a phone calculator ("200 + 10%" is 220, "50 × 10%" is 5, "10%" is 0.1).
 */
export function evaluate(input) {
  const tokens = tokenize(input);
  if (!tokens.length) throw new CalcError("Nothing to calculate");
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isOperator = (token, ...values) => token?.type === "operator" && values.includes(token.value);

  // Each level returns { value, percent }: `percent` marks a bare "n%" so + and − can treat it
  // as a share of the left-hand side.
  function sum() {
    let left = product().value;
    while (isOperator(peek(), "+", "-")) {
      const operator = next().value;
      const right = product();
      const amount = right.percent ? left * right.value : right.value;
      left = operator === "+" ? left + amount : left - amount;
    }
    return { value: left, percent: false };
  }

  function product() {
    let left = signed();
    for (;;) {
      if (isOperator(peek(), "*", "/")) {
        const operator = next().value;
        const right = signed().value;
        if (operator === "/" && right === 0) throw new CalcError("Can't divide by zero");
        left = { value: operator === "*" ? left.value * right : left.value / right, percent: false };
      } else if (peek()?.type === "(") {
        left = { value: left.value * signed().value, percent: false }; // 2(3 + 4)
      } else {
        return left;
      }
    }
  }

  function signed() {
    if (isOperator(peek(), "+", "-")) {
      const negative = next().value === "-";
      const inner = signed();
      return { value: negative ? -inner.value : inner.value, percent: inner.percent };
    }
    let value = primary();
    let percent = false;
    while (peek()?.type === "%") {
      next();
      value /= 100;
      percent = true;
    }
    return { value, percent };
  }

  function primary() {
    const token = next();
    if (token?.type === "number") return token.value;
    if (token?.type === "(") {
      const { value } = sum();
      if (next()?.type !== ")") throw new CalcError("Missing )");
      return value;
    }
    throw new CalcError("The sum isn't finished");
  }

  const { value } = sum();
  if (position < tokens.length) throw new CalcError(`Unexpected "${tokens[position].text}"`);
  if (!Number.isFinite(value)) throw new CalcError("That number is too large");
  return tidy(value);
}

/** What "=" should work out from a half-typed sum: drop trailing operators, close open brackets. */
export function complete(expression) {
  const text = expression.replace(/[+\-*/(]+$/, "");
  const open = (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0);
  return text + ")".repeat(Math.max(open, 0));
}

/** The live answer shown while typing, or null when there is nothing worth showing yet. */
export function preview(expression) {
  const text = complete(expression);
  if (!/[+\-*/%(]/.test(text.replace(/^-/, "").replace(/e[+-]/gi, ""))) return null;
  try {
    return evaluate(text);
  } catch {
    return null;
  }
}

/** A result for display: thousands separators, or e-notation when very large or small. */
export function format(value) {
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1e15 || size < 1e-9) return value.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "e");
  return value.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/** The typed expression for display: grouped digits and proper × ÷ − signs. */
export function pretty(expression) {
  return expression
    .replace(/\d+(?:\.\d*)?/g, (number) => {
      const [whole, fraction] = number.split(".");
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
    })
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−");
}
