/* 5K6Learn MathBot — self-contained maths engine.
 * Runs entirely in the browser using a locally bundled math.js plus a small
 * exact-arithmetic layer for polynomial algebra. No server is required.
 */
(function (global) {
  "use strict";
  const math = global.math;
  const MathBot = (global.MathBot = global.MathBot || {});
  const M = {};

  /* ------------------------------------------------------------------ *
   * Exact rational numbers
   * ------------------------------------------------------------------ */
  function gcd(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }

  function makeFrac(n, d) {
    n = Math.round(n); d = Math.round(d);
    if (d === 0) throw new Error("Division by zero.");
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d);
    return { n: n / g, d: d / g };
  }
  function fracFromNumber(x) {
    if (!Number.isFinite(x)) throw new Error("A non-finite number was used.");
    let k = 0;
    while (k < 9 && Math.abs(x * Math.pow(10, k) - Math.round(x * Math.pow(10, k))) > 1e-9) k++;
    return makeFrac(Math.round(x * Math.pow(10, k)), Math.pow(10, k));
  }
  const fAdd = (a, b) => makeFrac(a.n * b.d + b.n * a.d, a.d * b.d);
  const fSub = (a, b) => makeFrac(a.n * b.d - b.n * a.d, a.d * b.d);
  const fMul = (a, b) => makeFrac(a.n * b.n, a.d * b.d);
  const fDiv = (a, b) => { if (b.n === 0) throw new Error("Division by zero."); return makeFrac(a.n * b.d, a.d * b.n); };
  const fNeg = (a) => ({ n: -a.n, d: a.d });
  const fAbs = (a) => ({ n: Math.abs(a.n), d: a.d });
  const fZero = (a) => a.n === 0;
  const fVal = (a) => a.n / a.d;
  const fOne = { n: 1, d: 1 };

  function fStr(a) {
    if (a.d === 1) return String(a.n);
    return a.n + "/" + a.d;
  }
  function isPerfectSquare(a) {
    if (a.n < 0) return false;
    const rn = Math.sqrt(a.n), rd = Math.sqrt(a.d);
    return Math.abs(rn - Math.round(rn)) < 1e-9 && Math.abs(rd - Math.round(rd)) < 1e-9;
  }

  /* ------------------------------------------------------------------ *
   * Input preparation and parsing
   * ------------------------------------------------------------------ */
  const FUNCTION_NAMES = new Set([
    "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "sqrt", "cbrt", "log", "log10", "log2", "ln", "exp", "abs", "floor", "ceil",
    "round", "factorial", "gcd", "lcm", "binomial", "root", "atan2", "min", "max",
  ]);

  function tokenize(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const c = source[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === "." && /\d/.test(source[i + 1] || ""))) {
        let j = i;
        while (j < source.length) {
          const ch = source[j];
          if (/[0-9.eE]/.test(ch)) { j++; continue; }
          if ((ch === "+" || ch === "-") && /[eE]/.test(source[j - 1] || "")) { j++; continue; }
          break;
        }
        tokens.push({ type: "num", value: source.slice(i, j) });
        i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
        tokens.push({ type: "name", value: source.slice(i, j) });
        i = j; continue;
      }
      if (c === "*" && source[i + 1] === "*") { tokens.push({ type: "op", value: "**" }); i += 2; continue; }
      if ("+-*/()^,;=%[]".indexOf(c) !== -1) { tokens.push({ type: "op", value: c }); i++; continue; }
      throw new Error("Unsupported character: " + c);
    }
    return tokens;
  }

  function prepare(source) {
    let src = String(source || "").trim();
    src = src.replace(/π/g, "pi").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/–/g, "-");
    if (!src) throw new Error("Enter an expression first.");
    if (src.length > 1000) throw new Error("Expressions must be at most 1000 characters.");
    const tokens = tokenize(src);
    let out = "";
    let prev = null;
    tokens.forEach((token) => {
      const multiply =
        prev && (
          (prev.type === "num" && (token.type === "name" || token.value === "(")) ||
          (prev.type === "name" && token.type === "name") ||
          (prev.type === "name" && token.value === "(" && !FUNCTION_NAMES.has(prev.value)) ||
          ((prev.value === ")" || prev.value === "]") && token.value === "(") ||
          (prev.value === ")" && (token.type === "num" || token.type === "name"))
        );
      if (multiply) out += "*";
      out += token.value;
      prev = token;
    });
    return out;
  }

  const ALLOWED_SYMBOLS = new Set(["x", "y", "z", "t", "a", "b", "c", "n"]);
  const ALLOWED_CONSTANTS = new Set(["pi", "e", "tau", "i", "Infinity", "inf"]);

  function parse(source, variable) {
    const src = prepare(source);
    const node = math.parse(src);
    // Only allow known symbols, constants and functions; nothing is executed.
    node.traverse((child) => {
      if (child.type === "SymbolNode" &&
          !ALLOWED_SYMBOLS.has(child.name) &&
          !FUNCTION_NAMES.has(child.name) &&
          !ALLOWED_CONSTANTS.has(child.name)) {
        throw new Error("Unknown symbol '" + child.name + "'. Use " + variable + " or pi.");
      }
      if (child.type === "FunctionNode" && !FUNCTION_NAMES.has(child.fn.name)) {
        throw new Error("Unknown function '" + child.fn.name + "'.");
      }
    });
    return node;
  }

  function compile(source, variable) {
    return parse(source, variable).compile();
  }

  function safeEval(compiled, variable, value) {
    const scope = {};
    scope[variable] = value;
    return compiled.evaluate(scope);
  }

  /* ------------------------------------------------------------------ *
   * Polynomial layer (one variable, rational coefficients)
   * ------------------------------------------------------------------ */
  const poly = () => new Map();
  function pSet(p, exp, coeff) {
    const sum = fAdd(p.get(exp) || { n: 0, d: 1 }, coeff);
    if (fZero(sum)) p.delete(exp); else p.set(exp, sum);
    return p;
  }
  function pAdd(a, b) {
    const out = new Map(a);
    b.forEach((coeff, exp) => pSet(out, exp, coeff));
    return out;
  }
  function pNeg(a) {
    const out = poly();
    a.forEach((c, e) => out.set(e, fNeg(c)));
    return out;
  }
  function pSub(a, b) { return pAdd(a, pNeg(b)); }
  function pMul(a, b) {
    const out = poly();
    a.forEach((ca, ea) => b.forEach((cb, eb) => pSet(out, ea + eb, fMul(ca, cb))));
    return out;
  }
  function pScale(a, c) {
    const out = poly();
    a.forEach((v, e) => out.set(e, fMul(v, c)));
    return out;
  }
  function pDivConst(a, c) {
    if (fZero(c)) throw new Error("Division by zero.");
    return pScale(a, { n: c.d, d: c.n });
  }
  function pPow(a, exponent) {
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 40) throw new Error("Unsupported power.");
    let result = new Map([[0, fOne]]);
    let base = a;
    let n = exponent;
    while (n > 0) {
      if (n % 2) result = pMul(result, base);
      base = pMul(base, base);
      n = Math.floor(n / 2);
    }
    return result;
  }
  function degree(p) { return p.size ? Math.max(...p.keys()) : 0; }
  function pEval(p, x) {
    let sum = { n: 0, d: 1 };
    const xf = fracFromNumber(x);
    p.forEach((coeff, exp) => { sum = fAdd(sum, fMul(coeff, pPow(new Map([[1, xf]]), exp).get(exp) || fOne)); });
    return fVal(sum);
  }
  function pEvalFrac(p, xf) {
    let sum = { n: 0, d: 1 };
    let power = fOne;
    for (let e = 0; e <= degree(p); e++) {
      const coeff = p.get(e);
      if (coeff) sum = fAdd(sum, fMul(coeff, power));
      power = fMul(power, xf);
    }
    return sum;
  }

  function nodeToPoly(node, variable) {
    if (!node) return null;
    if (node.type === "ParenthesisNode") return nodeToPoly(node.content, variable);
    if (node.type === "ConstantNode") {
      const value = Number(node.value);
      if (!Number.isFinite(value)) return null;
      return new Map([[0, fracFromNumber(value)]]);
    }
    if (node.type === "SymbolNode") {
      if (node.name === variable) return new Map([[1, fOne]]);
      return null;
    }
    if (node.type === "OperatorNode") {
      const args = node.args;
      if (node.op === "-" && args.length === 1) {
        const inner = nodeToPoly(args[0], variable);
        return inner ? pNeg(inner) : null;
      }
      if (node.op === "+" && args.length === 2) {
        const a = nodeToPoly(args[0], variable), b = nodeToPoly(args[1], variable);
        return a && b ? pAdd(a, b) : null;
      }
      if (node.op === "-" && args.length === 2) {
        const a = nodeToPoly(args[0], variable), b = nodeToPoly(args[1], variable);
        return a && b ? pSub(a, b) : null;
      }
      if (node.op === "*" && args.length === 2) {
        const a = nodeToPoly(args[0], variable), b = nodeToPoly(args[1], variable);
        return a && b ? pMul(a, b) : null;
      }
      if (node.op === "/" && args.length === 2) {
        const a = nodeToPoly(args[0], variable), b = nodeToPoly(args[1], variable);
        if (!a || !b || degree(b) !== 0) return null;
        return pDivConst(a, b.get(0));
      }
      if ((node.op === "^" || node.op === "**") && args.length === 2) {
        const base = nodeToPoly(args[0], variable);
        const exponentNode = args[1];
        if (!base || exponentNode.type !== "ConstantNode") return null;
        const exponent = Number(exponentNode.value);
        if (!Number.isInteger(exponent) || exponent < 0) return null;
        return pPow(base, exponent);
      }
      return null;
    }
    return null;
  }

  function polyTerms(p) {
    return Array.from(p.entries()).filter(([, c]) => !fZero(c)).sort((a, b) => b[0] - a[0]);
  }

  function polyString(p, variable) {
    const terms = polyTerms(p);
    if (!terms.length) return "0";
    let out = "";
    terms.forEach(([exp, coeff], index) => {
      let piece;
      const abs = fAbs(coeff);
      if (exp === 0) {
        piece = fStr(coeff);
      } else if (fVal(abs) === 1) {
        piece = variable + (exp === 1 ? "" : "^" + exp);
      } else {
        piece = fStr(coeff) + "*" + variable + (exp === 1 ? "" : "^" + exp);
      }
      if (index === 0) out += piece;
      else out += (coeff.n < 0 ? " - " : " + ") + (coeff.n < 0 ? piece.replace(/^-/, "") : piece);
    });
    return out;
  }

  function polyDerivative(p, variable) {
    const out = poly();
    p.forEach((coeff, exp) => { if (exp > 0) pSet(out, exp - 1, fMul(coeff, { n: exp, d: 1 })); });
    return out;
  }

  function polyIntegral(p, variable) {
    const out = poly();
    p.forEach((coeff, exp) => pSet(out, exp + 1, fDiv(coeff, { n: exp + 1, d: 1 })));
    return polyString(out, variable);
  }

  function divisorsOf(n) {
    n = Math.abs(Math.round(n));
    if (n === 0) return [];
    const small = [], large = [];
    for (let i = 1; i * i <= n; i++) {
      if (n % i === 0) { small.push(i); if (i !== n / i) large.push(n / i); }
    }
    return small.concat(large.reverse());
  }

  function divideByLinear(p, root) {
    // Synthetic division by (x - root); returns quotient or null.
    const n = degree(p);
    if (n < 1) return null;
    const quotient = poly();
    let carry = { n: 0, d: 1 };
    for (let exp = n; exp >= 0; exp--) {
      const coeff = p.get(exp) || { n: 0, d: 1 };
      carry = fAdd(coeff, fMul(carry, root));
      if (exp > 0) quotient.set(exp - 1, carry);
    }
    return fZero(carry) ? quotient : null;
  }

  function factorPoly(p, variable) {
    const n = degree(p);
    if (n === 0) return fStr(p.get(0) || { n: 0, d: 1 });
    // Rational content
    let gn = 0, gd = 1;
    p.forEach((c) => { gn = gcd(gn, c.n); gd = lcm(gd, c.d); });
    if (gn === 0) gn = 1;
    const content = makeFrac(gn, gd);
    let work = pDivConst(p, content);
    const factors = [];
    if (!fZero(content) && (content.n !== 1 || content.d !== 1)) factors.push(fStr(content));

    // Rational roots via rational root theorem.
    let changed = true;
    let guard = 0;
    while (changed && degree(work) > 0 && guard++ < 12) {
      changed = false;
      const constant = work.get(0);
      const leading = work.get(degree(work));
      if (!constant || fZero(constant)) {
        factors.push(variable);
        const shifted = poly();
        work.forEach((c, e) => { if (e > 0) shifted.set(e - 1, c); });
        work = shifted;
        changed = true;
        continue;
      }
      const numerators = divisorsOf(constant.n);
      const denominators = divisorsOf(leading.n);
      const candidates = [];
      numerators.forEach((a) => denominators.forEach((b) => {
        candidates.push(makeFrac(a, b), makeFrac(-a, b));
      }));
      candidates.sort((a, b) => Math.abs(fVal(a)) - Math.abs(fVal(b)));
      for (const root of candidates) {
        if (Math.abs(fVal(root)) > 10000) continue;
        const quotient = divideByLinear(work, root);
        if (quotient) {
          factors.push(fVal(root) === 0 ? variable : "(" + variable + (root.n < 0 ? " + " + fStr(fNeg(root)) : " - " + fStr(root)) + ")");
          work = quotient;
          changed = true;
          break;
        }
      }
    }

    if (degree(work) === 1) {
      const c1 = work.get(1), c0 = work.get(0) || { n: 0, d: 1 };
      const root = fNeg(fDiv(c0, c1));
      factors.push(fVal(root) === 0 ? variable : "(" + variable + (root.n < 0 ? " + " + fStr(fNeg(root)) : " - " + fStr(root)) + ")");
      work = poly();
    } else if (degree(work) === 2) {
      const a = work.get(2), b = work.get(1) || { n: 0, d: 1 }, c = work.get(0) || { n: 0, d: 1 };
      const disc = fSub(fMul(b, b), fMul(fMul({ n: 4, d: 1 }, a), c));
      if (isPerfectSquare(disc)) {
        const s = { n: Math.round(Math.sqrt(disc.n)), d: Math.round(Math.sqrt(disc.d)) };
        const twoA = fMul({ n: 2, d: 1 }, a);
        const r1 = fDiv(fAdd(fNeg(b), s), twoA);
        const r2 = fDiv(fSub(fNeg(b), s), twoA);
        factors.push("(" + variable + (r1.n < 0 ? " + " + fStr(fNeg(r1)) : " - " + fStr(r1)) + ")");
        factors.push("(" + variable + (r2.n < 0 ? " + " + fStr(fNeg(r2)) : " - " + fStr(r2)) + ")");
        work = poly();
      }
    }
    if (degree(work) > 0) factors.push("(" + polyString(work, variable) + ")");
    return factors.length ? factors.join("*") : "1";
  }

  function cleanMathString(value) {
    return String(value)
      .replace(/\s*\*\s*/g, "*")
      .replace(/\s*\^\s*/g, "^")
      .replace(/\s*\+\s*/g, "+")
      .replace(/\s*-\s*/g, "-");
  }

  function formatNumber(x, digits) {
    if (!Number.isFinite(x)) return x > 0 ? "infinity" : "-infinity";
    if (Math.abs(x - Math.round(x)) < 1e-10) return String(Math.round(x));
    return Number(x.toPrecision(digits || 8)).toString();
  }

  function numericRoots(node, variable, from, to) {
    let fn;
    try { fn = node.compile(); } catch (e) { return []; }
    const roots = [];
    const steps = 800;
    let prevX = from, prevY;
    try { prevY = Number(safeEval(fn, variable, from)); } catch (e) { return []; }
    for (let i = 1; i <= steps; i++) {
      const x = from + (to - from) * i / steps;
      let y;
      try { y = Number(safeEval(fn, variable, x)); } catch (e) { prevX = x; prevY = undefined; continue; }
      if (!Number.isFinite(y) || !Number.isFinite(prevY)) { prevX = x; prevY = y; continue; }
      if (Math.abs(y) < 1e-10) roots.push(x);
      if (prevY * y < 0) {
        let lo = prevX, hi = x;
        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2;
          let mv;
          try { mv = Number(safeEval(fn, variable, mid)); } catch (e) { break; }
          if (mv * prevY <= 0) hi = mid; else { lo = mid; prevY = mv; }
        }
        roots.push((lo + hi) / 2);
      }
      prevX = x; prevY = y;
    }
    const unique = [];
    roots.sort((a, b) => a - b);
    roots.forEach((r) => { if (!unique.some((u) => Math.abs(u - r) < 1e-4)) unique.push(r); });
    return unique.slice(0, 12).map((r) => formatNumber(r, 8));
  }

  /* ------------------------------------------------------------------ *
   * Symbolic helpers for calculus
   * ------------------------------------------------------------------ */
  function constantValue(node) {
    if (!node) return null;
    if (node.type === "ConstantNode") return Number(node.value);
    if (node.type === "ParenthesisNode") return constantValue(node.content);
    if (node.type === "OperatorNode" && node.op === "-" && node.args.length === 1) {
      const v = constantValue(node.args[0]); return v === null ? null : -v;
    }
    return null;
  }

  function integrateNode(node, variable) {
    if (!node) throw new Error("Nothing to integrate.");
    if (node.type === "ParenthesisNode") return integrateNode(node.content, variable);
    if (node.type === "ConstantNode") return "(" + node.value + ")*" + variable;
    if (node.type === "SymbolNode") {
      if (node.name === variable) return variable + "^2/2";
      throw new Error("Integrate with respect to " + variable + " or use a constant.");
    }
    if (node.type === "OperatorNode") {
      const args = node.args;
      if (node.op === "-" && args.length === 1) return "-(" + integrateNode(args[0], variable) + ")";
      if ((node.op === "+" || node.op === "-") && args.length === 2) {
        return "(" + integrateNode(args[0], variable) + ") " + node.op + " (" + integrateNode(args[1], variable) + ")";
      }
      if (node.op === "*" && args.length === 2) {
        const c0 = constantValue(args[0]), c1 = constantValue(args[1]);
        if (c0 !== null) return "(" + c0 + ")*(" + integrateNode(args[1], variable) + ")";
        if (c1 !== null) return "(" + c1 + ")*(" + integrateNode(args[0], variable) + ")";
      }
      if (node.op === "/" && args.length === 2) {
        const c = constantValue(args[1]);
        if (c !== null) return "(" + integrateNode(args[0], variable) + ")/(" + c + ")";
        if (args[0].type === "ConstantNode" && Number(args[0].value) === 1) return "ln(abs(" + variable + "))";
      }
      if ((node.op === "^" || node.op === "**") && args.length === 2) {
        const exp = constantValue(args[1]);
        if (args[0].type === "SymbolNode" && args[0].name === variable && exp !== null && exp !== -1) {
          return variable + "^" + formatNumber(exp + 1, 8) + "/" + formatNumber(exp + 1, 8);
        }
      }
    }
    if (node.type === "FunctionNode") {
      const fn = node.fn.name;
      const arg = node.args[0];
      const inner = arg.type === "OperatorNode" && arg.op === "-" && arg.args.length === 1;
      const a = inner ? -1 : 1;
      const coeff = 1;
      if (fn === "sin") return "(" + (a < 0 ? "-" : "") + "cos(" + arg.toString() + "))";
      if (fn === "cos") return "(" + (a < 0 ? "-" : "") + "sin(" + arg.toString() + "))";
      if (fn === "exp") return "exp(" + arg.toString() + ")";
      if (fn === "sqrt" && arg.type === "SymbolNode" && arg.name === variable) return "(2/3)*" + variable + "*sqrt(" + variable + ")";
    }
    throw new Error("This integral needs a numerical bound; try the definite form.");
  }

  function evaluateLimit(node, variable, approach, direction) {
    const point = Number(approach);
    if (!Number.isFinite(point)) throw new Error("Enter a numeric approach value.");
    const direct = safeEval(node.compile(), variable, point);
    if (typeof direct === "number" && Number.isFinite(direct)) return formatNumber(direct, 8);
    // L'Hopital for quotients
    if (node.type === "OperatorNode" && node.op === "/" && node.args.length === 2) {
      let numerator = node.args[0], denominator = node.args[1];
      for (let i = 0; i < 4; i++) {
        try {
          const dNum = math.derivative(numerator, variable);
          const dDen = math.derivative(denominator, variable);
          const value = safeEval(dNum.compile(), variable, point) / safeEval(dDen.compile(), variable, point);
          if (Number.isFinite(value)) return formatNumber(value, 8);
          numerator = dNum; denominator = dDen;
        } catch (e) { break; }
      }
    }
    // Numeric convergence
    const sides = direction === "left" ? [-1] : direction === "right" ? [1] : [-1, 1];
    const estimates = [];
    sides.forEach((side) => {
      for (const h of [1e-3, 1e-4, 1e-5, 1e-6]) {
        try {
          const value = Number(safeEval(node.compile(), variable, point + side * h));
          if (Number.isFinite(value)) { estimates.push(value); break; }
        } catch (e) { /* skip */ }
      }
    });
    if (estimates.length && estimates.every((v) => Math.abs(v - estimates[0]) < 1e-3)) return formatNumber(estimates[0], 8);
    if (estimates.length) return formatNumber(estimates[estimates.length - 1], 8);
    throw new Error("The limit could not be determined numerically.");
  }

  /* ------------------------------------------------------------------ *
   * Non-symbolic tools
   * ------------------------------------------------------------------ */
  function parseNumberList(text) {
    const parts = String(text || "").split(/[\s,;]+/).filter(Boolean);
    const values = parts.map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new Error("Enter numbers separated by commas or spaces.");
    if (!values.length) throw new Error("Enter at least one number.");
    if (values.length > 2000) throw new Error("At most 2000 numbers can be analysed.");
    return values;
  }

  function statistics(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / n;
    const counts = {};
    sorted.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const maxCount = Math.max.apply(null, Object.values(counts));
    const modes = Object.keys(counts).filter((k) => counts[k] === maxCount).map(Number);
    const variancePop = sorted.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / n;
    const varianceSample = n > 1 ? sorted.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / (n - 1) : NaN;
    function q(p) {
      if (n === 1) return sorted[0];
      const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }
    return {
      count: String(n), sum: formatNumber(sum, 10), mean: formatNumber(avg, 10),
      median: formatNumber(n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, 10),
      mode: modes.length === n ? "no repeating value" : modes.map((v) => formatNumber(v, 10)).join(", "),
      minimum: formatNumber(sorted[0], 10), maximum: formatNumber(sorted[n - 1], 10),
      range: formatNumber(sorted[n - 1] - sorted[0], 10),
      "variance (population)": formatNumber(variancePop, 10),
      "std dev (population)": formatNumber(Math.sqrt(variancePop), 10),
      "variance (sample)": n > 1 ? formatNumber(varianceSample, 10) : "not defined",
      "std dev (sample)": n > 1 ? formatNumber(Math.sqrt(varianceSample), 10) : "not defined",
      Q1: formatNumber(q(0.25), 10), Q3: formatNumber(q(0.75), 10), IQR: formatNumber(q(0.75) - q(0.25), 10),
    };
  }

  function isPrime(n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
  }
  function primeFactorization(n) {
    const factors = {};
    let remaining = n;
    for (let p = 2; p * p <= remaining; p += (p === 2 ? 1 : 2)) {
      while (remaining % p === 0) { factors[p] = (factors[p] || 0) + 1; remaining /= p; }
    }
    if (remaining > 1) factors[remaining] = (factors[remaining] || 0) + 1;
    return Object.keys(factors).map((k) => Number(k) + (factors[k] > 1 ? "^" + factors[k] : "")).join(" × ") || "1";
  }
  function numberTheory(value, operation, second) {
    const n = Math.abs(Math.round(Number(value)));
    if (!Number.isFinite(n) || n > 1e12) throw new Error("Enter a whole number below 10^12.");
    const result = { number: String(Math.round(Number(value))), sign: Number(value) < 0 ? "negative" : "positive" };
    if (["overview", "prime", "factors", "divisors"].indexOf(operation) !== -1) {
      result.prime = n > 1 && isPrime(n) ? "yes" : "no";
      result["prime factorisation"] = n > 1 ? primeFactorization(n) : "not defined";
      const divs = n > 0 ? divisorsOf(n) : [];
      result.divisors = n > 0 ? divs.join(", ") : "not defined";
      result["number of divisors"] = n > 0 ? String(divs.length) : "not defined";
      result["Euler phi(n)"] = n > 0 ? String(phi(n)) : "not defined";
      result["sum of divisors"] = n > 0 ? String(divs.reduce((a, b) => a + b, 0)) : "not defined";
      result["digit sum"] = String(String(n).split("").reduce((a, b) => a + Number(b), 0));
    } else if (operation === "gcd") {
      const m = Math.abs(Math.round(Number(second)));
      if (!Number.isFinite(m)) throw new Error("Enter the second number.");
      result["second number"] = String(Math.round(Number(second)));
      result.gcd = String(gcd(n, m));
      result.lcm = String(n && m ? Math.abs(n * m) / gcd(n, m) : 0);
    } else if (operation === "base") {
      const base = Math.round(Number(second || 2));
      if (base < 2 || base > 36) throw new Error("Base must be between 2 and 36.");
      const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let x = n, out = "";
      if (x === 0) out = "0";
      while (x > 0) { out = digits[x % base] + out; x = Math.floor(x / base); }
      result["base " + base] = out;
    } else throw new Error("Choose overview, prime, factors, divisors, gcd or base.");
    return result;
  }
  function phi(n) {
    let result = n, x = n;
    for (let p = 2; p * p <= x; p++) {
      if (x % p === 0) { while (x % p === 0) x /= p; result -= result / p; }
    }
    if (x > 1) result -= result / x;
    return result;
  }

  function matrixFromJSON(text, label) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(label + " must be valid JSON, e.g. [[1,2],[3,4]]."); }
    if (!Array.isArray(data) || !data.length || data.some((row) => !Array.isArray(row))) {
      throw new Error(label + " must be an array of rows.");
    }
    const rows = data.length, cols = data[0].length;
    if (data.some((row) => row.length !== cols)) throw new Error("All rows of " + label + " must have the same length.");
    return data;
  }

  function matrixRank(rows) {
    const a = rows.map((r) => r.slice());
    const m = a.length, n = a[0].length;
    let rank = 0;
    for (let col = 0; col < n && rank < m; col++) {
      let pivot = -1;
      for (let r = rank; r < m; r++) if (Math.abs(a[r][col]) > 1e-10) { pivot = r; break; }
      if (pivot === -1) continue;
      [a[rank], a[pivot]] = [a[pivot], a[rank]];
      for (let r = rank + 1; r < m; r++) {
        const factor = a[r][col] / a[rank][col];
        for (let c = col; c < n; c++) a[r][c] -= factor * a[rank][c];
      }
      rank++;
    }
    return rank;
  }

  function matrixToString(matrix) {
    const rows = Array.isArray(matrix) ? matrix : matrix.toArray();
    return rows.map((row) => row.map((v) => formatNumber(Number(v), 8)).join("  ")).join("\n");
  }

  function matrixOperation(payload) {
    const A = matrixFromJSON(payload.expression, "Matrix A");
    const B = payload.second_expression && payload.second_expression.trim()
      ? matrixFromJSON(payload.second_expression, "Matrix B") : null;
    const op = (payload.matrix_op || "properties").toLowerCase();
    const order = Number(payload.order) || 2;
    const result = {};
    let title = "Matrix result";
    const steps = ["Read the entries of matrix A.", "Apply the selected matrix operation."];
    if (["add", "subtract", "multiply"].indexOf(op) !== -1) {
      if (!B) throw new Error("Matrix B is required for this operation.");
      let out;
      if (op === "add") { if (A.length !== B.length || A[0].length !== B[0].length) throw new Error("A and B must have the same dimensions."); out = math.add(math.matrix(A), math.matrix(B)); }
      if (op === "subtract") { if (A.length !== B.length || A[0].length !== B[0].length) throw new Error("A and B must have the same dimensions."); out = math.subtract(math.matrix(A), math.matrix(B)); }
      if (op === "multiply") { if (A[0].length !== B.length) throw new Error("A's column count must equal B's row count."); out = math.multiply(math.matrix(A), math.matrix(B)); }
      result.result = matrixToString(out);
      title = op === "add" ? "A + B" : op === "subtract" ? "A − B" : "A × B";
    } else if (op === "power") {
      if (A.length !== A[0].length) throw new Error("Only square matrices can be raised to a power.");
      result.result = matrixToString(math.pow(math.matrix(A), order));
      title = "A^" + order;
    } else if (op === "solve") {
      if (!B) throw new Error("Matrix B is required to solve A·X = B.");
      if (A.length !== A[0].length) throw new Error("A must be square.");
      if (B.length !== A.length) throw new Error("B must have one row per row of A.");
      result["solution X"] = matrixToString(math.lusolve(math.matrix(A), math.matrix(B)));
      title = "Solve A·X = B";
    } else {
      const square = A.length === A[0].length;
      result.shape = A.length + " × " + A[0].length;
      result.rank = String(matrixRank(A));
      result.transpose = matrixToString(math.transpose(math.matrix(A)));
      if (square) {
        const det = math.det(math.matrix(A));
        result.determinant = formatNumber(Number(det), 8);
        result.trace = String(A.reduce((acc, row, i) => acc + row[i], 0));
        result.inverse = Math.abs(Number(det)) < 1e-12 ? "singular — no inverse" : matrixToString(math.inv(math.matrix(A)));
        if (A.length === 2) {
          const a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1];
          const disc = Math.sqrt((a - d) * (a - d) + 4 * b * c);
          result.eigenvalues = formatNumber((a + d + disc) / 2, 8) + ", " + formatNumber((a + d - disc) / 2, 8);
        } else if (A.length === 3) {
          try { result.eigenvalues = math.eigs(math.matrix(A)).values.map((v) => formatNumber(Number(v), 6)).join(", "); }
          catch (e) { result.eigenvalues = "not available"; }
        }
      }
      title = "Matrix properties";
    }
    return { ok: true, title: title, result: result, steps: steps };
  }

  function wordProblem(text) {
    const lower = String(text || "").toLowerCase();
    const numbers = (lower.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    let answer = null, equation = "";
    const plus = /number\s+(?:plus|increased by|added to|and|more than)\s*(-?\d+(?:\.\d+)?)\s+(?:is|equals|=|gives|was|is equal to)\s*(-?\d+(?:\.\d+)?)/;
    const minus = /number\s+(?:minus|decreased by|less than|reduced by)\s*(-?\d+(?:\.\d+)?)\s+(?:is|equals|=|gives|was|is equal to)\s*(-?\d+(?:\.\d+)?)/;
    const times = /(-?\d+(?:\.\d+)?)\s*times\s+(?:a\s+)?number\s+(?:is|equals|=|gives|was)\s*(-?\d+(?:\.\d+)?)/;
    const divided = /number\s+divided\s+by\s*(-?\d+(?:\.\d+)?)\s+(?:is|equals|=|gives|was)\s*(-?\d+(?:\.\d+)?)/;
    let match;
    if ((match = lower.match(plus))) { answer = Number(match[2]) - Number(match[1]); equation = "x + " + match[1] + " = " + match[2]; }
    else if ((match = lower.match(minus))) { answer = Number(match[2]) + Number(match[1]); equation = "x − " + match[1] + " = " + match[2]; }
    else if ((match = lower.match(times))) { answer = Number(match[2]) / Number(match[1]); equation = match[1] + "x = " + match[2]; }
    else if ((match = lower.match(divided))) { answer = Number(match[2]) * Number(match[1]); equation = "x / " + match[1] + " = " + match[2]; }
    if (answer === null || !Number.isFinite(answer)) {
      return {
        ok: false,
        error: "I could not turn that wording into an equation. Rewrite it as something like 'a number plus 5 equals 12' and try again — or use the Solve tool.",
      };
    }
    return {
      ok: true, title: "Word problem", result: "x = " + formatNumber(answer, 8),
      steps: ["Let the unknown number be x.", "Translate the wording into: " + equation, "Solve the equation: x = " + formatNumber(answer, 8)],
    };
  }

  /* ------------------------------------------------------------------ *
   * Public dispatcher
   * ------------------------------------------------------------------ */
  M.solve = function (payload) {
    const mode = (payload.mode || "simplify").toLowerCase();
    const variable = (payload.variable || "x").trim().toLowerCase();
    if (!ALLOWED_SYMBOLS.has(variable)) throw new Error("Variable must be x, y, z, t, a, b, c or n.");

    if (mode === "matrix") return matrixOperation(payload);
    if (mode === "statistics" || mode === "number" || mode === "word") {
      if (mode === "statistics") {
        const values = payload.data && payload.data.length ? payload.data : parseNumberList(payload.expression);
        return {
          ok: true, title: "Descriptive statistics", result: statistics(values),
          steps: ["Sort the values from smallest to largest.", "Compute the centre with mean and median.", "Measure spread with variance, standard deviation and quartiles."],
        };
      }
      if (mode === "number") {
        return {
          ok: true, title: "Number theory", result: numberTheory(payload.expression, (payload.second_expression || "overview").toLowerCase(), payload.third_expression),
          steps: ["Write the number in the requested form.", "Use divisibility rules and Euclid's algorithm as needed.", "Verify by multiplying factors back together."],
        };
      }
      return wordProblem(payload.word_problem || payload.expression);
    }

    const raw = String(payload.expression || "").trim();
    if (!raw) throw new Error("Enter an expression first.");
    // An equation contains '='; parse its left side here, the right side in solve().
    const source = mode === "solve" && raw.indexOf("=") !== -1 ? raw.slice(0, raw.indexOf("=")).trim() : raw;
    const node = parse(source, variable);
    const polynomial = nodeToPoly(node, variable);
    const compiled = node.compile();
    let result, title, steps, extra = {};

    switch (mode) {
      case "simplify":
        result = cleanMathString(polynomial ? polyString(polynomial, variable) : math.simplify(node).toString());
        title = "Simplified expression";
        steps = ["Read the original expression.", "Apply algebraic rules and combine like terms.", "Simplified form: " + result];
        break;
      case "expand":
        if (!polynomial) throw new Error("Expansion works on polynomial expressions in " + variable + ".");
        result = polyString(polynomial, variable);
        title = "Expanded expression";
        steps = ["Multiply out every bracket.", "Collect like terms by power of " + variable + ".", "Expanded form: " + result];
        break;
      case "factor":
        if (!polynomial) throw new Error("Factoring works on polynomial expressions in " + variable + ".");
        result = factorPoly(polynomial, variable);
        title = "Factored expression";
        steps = ["Look for a common factor.", "Find roots and divide by the matching linear factors.", "Factored form: " + result];
        break;
      case "differentiate": {
        const order = Math.max(1, Math.min(12, Number(payload.order) || 1));
        let derivative = node;
        for (let i = 0; i < order; i++) derivative = math.derivative(derivative, variable);
        try { result = cleanMathString(math.simplify(derivative).toString()); } catch (e) { result = cleanMathString(derivative.toString()); }
        title = order === 1 ? "Derivative" : "Derivative (order " + order + ")";
        steps = ["Apply the sum, product and chain rules.", "Differentiate " + order + " time(s) with respect to " + variable + ".", "Derivative: " + result];
        break;
      }
      case "integrate": {
        const lower = payload.second_expression && String(payload.second_expression).trim();
        const upper = payload.third_expression && String(payload.third_expression).trim();
        if (lower) {
          const a = Number(safeEval(compile(lower, variable), variable, 0));
          const b = Number(safeEval(compile(upper || lower, variable), variable, 0));
          if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Enter numeric integration bounds.");
          if (b === a) throw new Error("Upper bound must differ from lower bound.");
          const fn = compiled;
          const n = 2000, h = (b - a) / n;
          let sum = Number(safeEval(fn, variable, a)) + Number(safeEval(fn, variable, b));
          for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * Number(safeEval(fn, variable, a + i * h));
          result = formatNumber(sum * h / 3, 10);
          title = "Definite integral";
          steps = ["Partition the interval [" + a + ", " + b + "] into 2000 strips.", "Apply Simpson's rule to approximate the area.", "Integral ≈ " + result];
        } else {
          let antiderivative = polynomial ? polyIntegral(polynomial, variable) : integrateNode(node, variable);
          try { antiderivative = cleanMathString(math.simplify(antiderivative).toString()); } catch (e) { /* keep form */ }
          result = antiderivative + " + C";
          title = "Indefinite integral";
          steps = ["Find an antiderivative term by term.", "Add the constant of integration C.", "Integral: " + result];
        }
        break;
      }
      case "limit":
        result = evaluateLimit(node, variable, payload.second_expression || "0", (payload.third_expression || "both").toLowerCase());
        title = "Limit";
        steps = ["Try direct substitution.", "If undefined, simplify or apply L'Hôpital's rule.", "Limit: " + result];
        break;
      case "evaluate":
      case "calculator":
        try {
          const value = compiled.evaluate({});
          result = typeof value === "number" ? formatNumber(value, Number(payload.precision) || 8) : String(value);
        } catch (e) {
          result = String(safeEval(compiled, variable, Number(payload.variable_value || 0)));
        }
        title = mode === "calculator" ? "Result" : "Value";
        steps = mode === "calculator"
          ? ["Read the calculation from left to right, respecting brackets and operator precedence.", "Apply multiplication and division before addition and subtraction.", "Result: " + result]
          : ["Parse the expression.", "Evaluate with exact arithmetic where possible.", "Value: " + result];
        break;
      case "solve": {
        const equationNode = node;
        const rightNode = raw.indexOf("=") !== -1 ? parse(raw.slice(raw.indexOf("=") + 1), variable) : null;
        const equationPoly = rightNode ? pSub(nodeToPoly(equationNode, variable) || poly(), nodeToPoly(rightNode, variable) || poly()) : nodeToPoly(equationNode, variable);
        const solutions = [];
        if (equationPoly && equationPoly.size) {
          const d = degree(equationPoly);
          if (d === 1) {
            solutions.push(fStr(fDiv(fNeg(equationPoly.get(0) || { n: 0, d: 1 }), equationPoly.get(1))));
          } else {
            const factored = factorPoly(equationPoly, variable);
            factored.split("*").forEach((factor) => {
              const fm = factor.match(/^\(([^)]+)\)$/);
              if (!fm) return;
              const body = fm[1].replace(/ /g, "");
              const linear = body.match(/^x([+-]\d+(?:\/\d+)?)$/);
              if (linear) {
                const c = linear[1];
                solutions.push(c.charAt(0) === "+" ? fStr(makeFrac(-Number(c.slice(1)), 1)) : c.slice(1));
              }
            });
            if (!solutions.length && d === 2) {
              const a = fVal(equationPoly.get(2)), b = fVal(equationPoly.get(1) || { n: 0, d: 1 }), c = fVal(equationPoly.get(0) || { n: 0, d: 1 });
              const disc = b * b - 4 * a * c;
              solutions.push(formatNumber((-b + Math.sqrt(Math.max(disc, 0))) / (2 * a), 8));
              if (disc !== 0) solutions.push(formatNumber((-b - Math.sqrt(Math.max(disc, 0))) / (2 * a), 8));
            }
          }
        }
        if (!solutions.length) {
          const target = rightNode ? parse(raw.slice(0, raw.indexOf("=")).trim() + "-(" + raw.slice(raw.indexOf("=") + 1).trim() + ")", variable).compile() : compiled;
          numericRoots(target, variable, -25, 25).forEach((r) => solutions.push(r));
        }
        if (!solutions.length) throw new Error("No real solution found in the range −25 to 25.");
        result = solutions.length === 1 ? solutions[0] : "[" + solutions.join(", ") + "]";
        title = "Solution";
        steps = ["Move every term to one side of the equation.", "Factor or apply the appropriate formula.", "Solution: " + result];
        break;
      }
      case "graph": {
        const pieces = raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
        if (!pieces.length) throw new Error("Enter at least one function.");
        const colours = ["#1f6f78", "#c2642c", "#3f6fae", "#6f8a3f", "#a34555", "#8a7a6a", "#4f6b75", "#b08a3e"];
        const series = pieces.map((piece, index) => {
          const fn = compile(piece, variable);
          const points = [];
          const samples = Math.max(20, Math.min(1200, Number(payload.samples) || 240));
          const xmin = Number(payload.xmin); const xmax = Number(payload.xmax);
          for (let i = 0; i < samples; i++) {
            const x = Number.isFinite(xmin) ? xmin + (xmax - xmin) * i / (samples - 1) : -10 + 20 * i / (samples - 1);
            try {
              const y = Number(safeEval(fn, variable, x));
              if (Number.isFinite(y) && Math.abs(y) < 1e8) points.push({ x: Number(x.toFixed(8)), y: Number(y.toFixed(8)) });
            } catch (e) { /* skip undefined points */ }
          }
          return { label: "f" + (index + 1) + "(" + variable + ") = " + piece, colour: colours[index % colours.length], points: points };
        });
        const xmin = Number(payload.xmin); const xmax = Number(payload.xmax);
        return {
          ok: true, title: "Function graph", mode: mode,
          result: series.length + " function(s) plotted",
          series: series, xmin: Number.isFinite(xmin) ? xmin : -10, xmax: Number.isFinite(xmax) ? xmax : 10,
          steps: ["Sample the function across the chosen x-range.", "Skip points where the function is undefined.", "Connect the remaining points."],
        };
      }
      default:
        throw new Error("Unknown tool. Choose one from the sidebar.");
    }
    extra.exact = cleanMathString(polynomial ? polyString(polynomial, variable) : node.toString());
    return Object.assign({ ok: true, mode: mode, title: title, result: result, steps: steps }, extra);
  };

  MathBot.engine = M;
})(window);
