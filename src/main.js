import { CalcError, complete, evaluate, format, preview, pretty } from "./engine.js";

const MAX_LENGTH = 80;
const HISTORY_SIZE = 25;

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const calc = $("calc");
const display = $("display");
const keypad = $("keypad");
const panel = $("history");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(`calc:${key}`));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`calc:${key}`, JSON.stringify(value));
    } catch {
      // Storage can be blocked; history then lasts for this visit only.
    }
  },
};

const savedHistory = store.get("history");
const state = {
  expr: "", // what has been typed, in plain ASCII: 12*(3+4)%
  evaluated: false, // true right after "=", when `expr` holds the result
  equation: "", // the sum that produced the result, shown above it
  error: "",
  history: Array.isArray(savedHistory)
    ? savedHistory.filter((item) => typeof item?.expr === "string" && Number.isFinite(item?.result))
    : [],
};

/* ---------- input rules ---------- */

const endsWithValue = () => /[\d.%)]$/.test(state.expr);
const openBrackets = () => (state.expr.match(/\(/g)?.length ?? 0) - (state.expr.match(/\)/g)?.length ?? 0);

/** After "=", digits start a new sum while operators carry on from the result. */
function leaveResult({ keep }) {
  if (!state.evaluated) return;
  state.evaluated = false;
  state.equation = "";
  if (!keep) state.expr = "";
}

const actions = {
  digit(digit) {
    leaveResult({ keep: false });
    if (/[)%]$/.test(state.expr)) state.expr += "*";
    if (/(^|[^\d.])0$/.test(state.expr)) state.expr = state.expr.slice(0, -1); // no leading zeros
    state.expr += digit;
  },
  point() {
    leaveResult({ keep: false });
    const number = state.expr.match(/[\d.]*$/)[0];
    if (number.includes(".")) return;
    if (/[)%]$/.test(state.expr)) state.expr += "*";
    state.expr += number ? "." : "0.";
  },
  operator(operator) {
    leaveResult({ keep: true });
    if (state.expr === "" || state.expr.endsWith("(")) {
      if (operator === "-") state.expr += "-";
      else if (state.expr === "") state.expr = `0${operator}`;
      return;
    }
    if (/[+\-*/]$/.test(state.expr)) {
      // "× −" starts a negative number; otherwise the new operator replaces the last one.
      if (operator === "-" && /[*/]$/.test(state.expr)) {
        state.expr += "-";
        return;
      }
      const trimmed = state.expr.replace(/[+\-*/]+$/, "");
      if (trimmed && !trimmed.endsWith("(")) state.expr = trimmed + operator;
      return;
    }
    state.expr += operator;
  },
  percent() {
    leaveResult({ keep: true });
    if (endsWithValue()) state.expr += "%";
  },
  brackets() {
    // One key for both: close a bracket when one is open and a value is waiting, else open one.
    if (openBrackets() > 0 && endsWithValue()) state.expr += ")";
    else actions.open();
  },
  open() {
    leaveResult({ keep: false }); // like a digit, "(" after a result starts a new sum
    state.expr += endsWithValue() ? "*(" : "(";
  },
  close() {
    if (openBrackets() <= 0 || !endsWithValue()) return;
    leaveResult({ keep: true });
    state.expr += ")";
  },
  back() {
    leaveResult({ keep: true });
    state.expr = state.expr.slice(0, -1);
  },
  clear() {
    Object.assign(state, { expr: "", evaluated: false, equation: "" });
  },
  equals() {
    if (!state.expr || state.evaluated) return;
    const sum = complete(state.expr);
    try {
      const result = evaluate(sum);
      if (sum === String(result)) return; // a lone number: nothing to work out
      state.equation = `${pretty(sum)} =`;
      state.expr = String(result);
      state.evaluated = true;
      state.history.unshift({ expr: pretty(sum), result });
      state.history.length = Math.min(state.history.length, HISTORY_SIZE);
      store.set("history", state.history);
      $("announce").textContent = `${pretty(sum)} equals ${format(result)}`;
      play("commit");
    } catch (error) {
      if (!(error instanceof CalcError)) throw error;
      state.error = error.message;
      $("announce").textContent = error.message;
      play("shake");
    }
  },
};

const KEY_ACTIONS = {
  ".": () => actions.point(),
  "%": () => actions.percent(),
  "()": () => actions.brackets(),
  "(": () => actions.open(),
  ")": () => actions.close(),
  "=": () => actions.equals(),
  back: () => actions.back(),
  clear: () => actions.clear(),
};

function press(key) {
  const before = state.expr;
  state.error = "";
  if (/^\d$/.test(key)) actions.digit(key);
  else if (/^[+\-*/]$/.test(key)) actions.operator(key);
  else KEY_ACTIONS[key]?.();
  if (state.expr.length > MAX_LENGTH) {
    state.expr = before;
    state.error = "That's as long as a sum can get";
  }
  render();
}

/* ---------- rendering ---------- */

function render() {
  const main = $("main");
  main.textContent = state.evaluated ? format(Number(state.expr)) : pretty(state.expr) || "0";
  fit(main);
  $("equation").textContent = state.equation;

  const line = $("preview");
  line.classList.toggle("error", Boolean(state.error));
  if (state.error) {
    line.textContent = state.error;
  } else {
    const value = state.evaluated ? null : preview(state.expr);
    line.textContent = value === null ? "" : `= ${format(value)}`;
  }
}

/** Shrink long sums to fit, then keep the newest digits in view. */
function fit(element) {
  let size = 60;
  element.style.setProperty("--size", `${size}px`);
  while (element.scrollWidth > element.clientWidth && size > 28) {
    size -= 4;
    element.style.setProperty("--size", `${size}px`);
  }
  element.scrollLeft = element.scrollWidth;
}

/** Replay a one-shot display animation ("commit" or "shake"). */
function play(name) {
  if (reduceMotion.matches) return;
  display.classList.remove(name);
  void display.offsetWidth;
  display.classList.add(name);
}

function renderHistory() {
  $("history-list").replaceChildren(
    ...state.history.map((item, i) => {
      const entry = document.createElement("li");
      entry.style.setProperty("--i", i);
      const button = document.createElement("button");
      button.type = "button";
      const sum = document.createElement("span");
      sum.className = "h-sum";
      sum.textContent = `${item.expr} =`;
      const result = document.createElement("span");
      result.className = "h-result";
      result.textContent = format(item.result);
      button.append(sum, result);
      button.addEventListener("click", () => {
        Object.assign(state, { expr: String(item.result), evaluated: true, equation: `${item.expr} =`, error: "" });
        toggleHistory(false);
        render();
        play("commit");
      });
      entry.append(button);
      return entry;
    }),
  );
  $("history-empty").hidden = state.history.length > 0;
  $("history-clear").disabled = state.history.length === 0;
}

function toggleHistory(open = !panel.classList.contains("open")) {
  panel.classList.toggle("open", open);
  panel.inert = !open;
  $("history-toggle").setAttribute("aria-expanded", String(open));
  if (open) renderHistory(); // rebuilt each time so the entries stagger in
  (open ? (panel.querySelector("#history-list button") ?? $("history-close")) : $("history-toggle")).focus({
    preventScroll: true,
  });
}

/* ---------- pointer, keyboard and clipboard ---------- */

// Keep focus off the keys on mouse clicks, so Enter means "=" rather than "press the last key again".
keypad.addEventListener("mousedown", (event) => event.preventDefault());

keypad.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button[data-key]");
  if (!button || reduceMotion.matches) return;
  const box = button.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.setProperty("--x", `${event.clientX - box.left}px`);
  ripple.style.setProperty("--y", `${event.clientY - box.top}px`);
  ripple.addEventListener("animationend", () => ripple.remove());
  button.append(ripple);
});

keypad.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-key]");
  if (button) press(button.dataset.key);
});

function flash(key) {
  const button = keypad.querySelector(`[data-key="${CSS.escape(key === "(" || key === ")" ? "()" : key)}"]`);
  if (!button) return;
  button.classList.add("pressed");
  setTimeout(() => button.classList.remove("pressed"), 130);
}

const KEYBOARD = { Enter: "=", "=": "=", Backspace: "back", Delete: "clear", x: "*", X: "*", "×": "*", "÷": "/" };

document.addEventListener("keydown", (event) => {
  if (event.altKey) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "c" && !getSelection()?.toString()) copy();
    return;
  }
  if (event.key === "Escape") {
    if (panel.classList.contains("open")) toggleHistory(false);
    else press("clear");
    return;
  }
  // A focused key or history entry keeps its own Enter and Space.
  if ((event.key === "Enter" || event.key === " ") && event.target.closest?.("button")) return;
  const key = KEYBOARD[event.key] ?? event.key;
  if (!/^[\d.+\-*/%()=]$/.test(key) && key !== "back" && key !== "clear") return;
  event.preventDefault();
  flash(key);
  press(key);
});

document.addEventListener("paste", (event) => {
  const text = (event.clipboardData?.getData("text") ?? "")
    .replace(/[\s,]/g, "")
    .replace(/[×xX]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-");
  if (!text || text.length > MAX_LENGTH || !/^[\d.+\-*/%()eE]+$/.test(text)) return;
  event.preventDefault();
  Object.assign(state, { expr: text, evaluated: false, equation: "", error: "" });
  render();
});

let copiedTimer = 0;
async function copy() {
  const text = $("main").textContent.replaceAll(",", "");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // clipboard blocked: nothing to confirm
  }
  const note = $("copied");
  note.classList.remove("show");
  void note.offsetWidth;
  note.classList.add("show");
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => note.classList.remove("show"), 1400);
}

$("main").addEventListener("click", copy);
$("history-toggle").addEventListener("click", () => toggleHistory());
$("history-close").addEventListener("click", () => toggleHistory(false));
$("history-clear").addEventListener("click", () => {
  state.history = [];
  store.set("history", []);
  renderHistory();
  $("history-close").focus();
});

/* ---------- theme ---------- */

function paintThemeButton() {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  $("theme").setAttribute("aria-label", `Switch to ${next} theme`);
}

$("theme").addEventListener("click", (event) => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  const apply = () => {
    root.dataset.theme = next;
    store.set("theme", next);
    paintThemeButton();
  };
  if (!document.startViewTransition || reduceMotion.matches) return apply();
  // The new theme spreads out in a circle from the button.
  const box = event.currentTarget.getBoundingClientRect();
  root.style.setProperty("--reveal-x", `${box.left + box.width / 2}px`);
  root.style.setProperty("--reveal-y", `${box.top + box.height / 2}px`);
  document.startViewTransition(apply);
});

/* ---------- 3D tilt ---------- */

let tiltFrame = 0;
addEventListener("pointermove", (event) => {
  if (!finePointer.matches || reduceMotion.matches) return;
  cancelAnimationFrame(tiltFrame);
  tiltFrame = requestAnimationFrame(() => {
    const box = calc.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    const clamp = (value) => Math.max(-0.6, Math.min(0.6, value));
    calc.style.setProperty("--ry", `${(clamp(x) * 9).toFixed(2)}deg`);
    calc.style.setProperty("--rx", `${(clamp(-y) * 9).toFixed(2)}deg`);
    calc.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
    calc.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
    calc.classList.add("lit");
  });
});
document.documentElement.addEventListener("pointerleave", () => {
  cancelAnimationFrame(tiltFrame);
  calc.style.setProperty("--rx", "0deg");
  calc.style.setProperty("--ry", "0deg");
  calc.classList.remove("lit");
});

/* ---------- start ---------- */

for (const [i, button] of [...keypad.children].entries()) button.style.setProperty("--i", i);
panel.inert = true;
paintThemeButton();
render();
