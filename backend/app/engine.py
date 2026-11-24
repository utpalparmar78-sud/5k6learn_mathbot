"""The maths engine.

A deliberately small, AST-based expression language keeps user input away
from Python's ``eval``. Everything is evaluated with SymPy so results are
symbolic, exact where possible, and deterministic.
"""

from __future__ import annotations

import ast
import math
import re
from collections import Counter
from statistics import mean, median, pstdev, stdev, variance, pvariance
from typing import Any

import sympy as sp

from .models import SolveRequest

# ---------------------------------------------------------------------------
# Safe expression language
# ---------------------------------------------------------------------------

SYMBOL_NAMES = ("x", "y", "z", "t", "a", "b", "c", "n")
SYMBOLS = {name: sp.Symbol(name) for name in SYMBOL_NAMES}

CONSTANTS: dict[str, Any] = {
    **SYMBOLS,
    "pi": sp.pi,
    "π": sp.pi,
    "e": sp.E,
    "E": sp.E,
    "tau": sp.pi * 2,
    "oo": sp.oo,
    "inf": sp.oo,
    "I": sp.I,
    "i": sp.I,
}

FUNCTIONS: dict[str, Any] = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "asinh": sp.asinh, "acosh": sp.acosh, "atanh": sp.atanh,
    "sqrt": sp.sqrt, "cbrt": sp.real_root,
    "log": sp.log, "ln": sp.log, "log10": lambda v: sp.log(v, 10),
    "log2": lambda v: sp.log(v, 2),
    "exp": sp.exp,
    "abs": sp.Abs, "Abs": sp.Abs,
    "floor": sp.floor, "ceil": sp.ceiling,
    "round": lambda v: sp.floor(v + sp.Rational(1, 2)),
    "factorial": sp.factorial,
    "sign": sp.sign,
    "re": sp.re, "im": sp.im, "conjugate": sp.conjugate,
    "min": sp.Min, "max": sp.Max,
    "gcd": sp.gcd, "lcm": sp.lcm,
    "binomial": sp.binomial,
    "root": sp.root,
    "atan2": sp.atan2,
    "deg": lambda v: v * 180 / sp.pi,
    "rad": lambda v: v * sp.pi / 180,
}

MULTI_ARG = {"log", "ln", "min", "max", "gcd", "lcm", "binomial", "root", "atan2"}

BINOPS = {
    ast.Add: lambda l, r: l + r,
    ast.Sub: lambda l, r: l - r,
    ast.Mult: lambda l, r: l * r,
    ast.Div: lambda l, r: l / r,
    ast.Pow: lambda l, r: l ** r,
    ast.Mod: lambda l, r: sp.Mod(l, r),
}
UNARYOPS = {ast.UAdd: lambda v: v, ast.USub: lambda v: -v}


def prepare_source(source: str) -> str:
    """Normalise notation and add implicit multiplication using tokenization.

    Tokenizing (instead of using regular expressions) is important: Python's
    tokenizer already understands scientific notation such as ``1e-3`` and
    function names such as ``atan2``, so neither is accidentally split apart.
    """
    import io
    import tokenize

    src = (source or "").strip()
    src = (src.replace("^", "**").replace("π", "pi")
              .replace("×", "*").replace("÷", "/")
              .replace("−", "-").replace("–", "-"))
    if not src:
        raise ValueError("Enter an expression first.")
    if len(src) > 1000:
        raise ValueError("Expressions must be at most 1000 characters.")

    skip = {
        tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT,
        tokenize.COMMENT, tokenize.ENDMARKER, tokenize.ENCODING,
    }
    try:
        tokens = [tok for tok in tokenize.generate_tokens(io.StringIO(src).readline) if tok.type not in skip]
    except (tokenize.TokenError, IndentationError) as exc:
        raise ValueError("I couldn't read that expression. Check your brackets.") from exc
    if not tokens:
        raise ValueError("Enter an expression first.")

    def needs_multiply(previous: tokenize.TokenInfo, current: tokenize.TokenInfo) -> bool:
        p, c = previous.string, current.string
        pt, ct = previous.type, current.type
        if pt == tokenize.NUMBER and (ct == tokenize.NAME or c == "("):
            return True
        if pt == tokenize.NAME and c == "(" and p not in FUNCTIONS:
            return True
        if pt == tokenize.NAME and ct == tokenize.NAME:
            return True
        if p in {")", "]"} and c == "(":
            return True
        if p == ")" and ct in (tokenize.NUMBER, tokenize.NAME):
            return True
        return False

    parts: list[str] = []
    previous: tokenize.TokenInfo | None = None
    for token in tokens:
        if previous is not None and needs_multiply(previous, token):
            parts.append("*")
        parts.append(token.string)
        previous = token
    return "".join(parts)


class _Parser:
    """AST visitor that only allows numbers, symbols and known functions."""

    def parse(self, source: str) -> sp.Expr:
        src = prepare_source(source)
        try:
            tree = ast.parse(src, mode="eval")
        except SyntaxError as exc:
            raise ValueError("I couldn't read that. Try something like 2*x + 3 or sin(pi/2).") from exc
        result = self._visit(tree.body)
        return result if isinstance(result, sp.Basic) else sp.sympify(result)

    def _visit(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float, complex)):
                raise ValueError("Only numeric constants are allowed.")
            return sp.sympify(node.value)

        if isinstance(node, ast.Name):
            if node.id in FUNCTIONS:
                raise ValueError(f"Use {node.id}(...) to call that function.")
            if node.id in CONSTANTS:
                return CONSTANTS[node.id]
            raise ValueError(f"Unknown symbol '{node.id}'. Try x, y, z, pi or e.")

        if isinstance(node, ast.BinOp):
            op = BINOPS.get(type(node.op))
            if op is None:
                raise ValueError("That operator isn't supported. Use + - * / ^ or %.")
            return op(self._visit(node.left), self._visit(node.right))

        if isinstance(node, ast.UnaryOp):
            op = UNARYOPS.get(type(node.op))
            if op is None:
                raise ValueError("That unary operator isn't supported.")
            return op(self._visit(node.operand))

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
                raise ValueError("Only the built-in maths functions can be called.")
            name = node.func.id
            if node.keywords:
                raise ValueError("Functions don't take named arguments.")
            args = [self._visit(arg) for arg in node.args]
            if len(args) == 1 or (len(args) > 1 and name in MULTI_ARG):
                try:
                    return FUNCTIONS[name](*args)
                except Exception as exc:  # pragma: no cover - defensive
                    raise ValueError(f"{name}(...) could not be evaluated: {exc}") from exc
            if name not in MULTI_ARG:
                raise ValueError(f"{name}(...) takes exactly one argument.")
            raise ValueError(f"{name}(...) needs at least one argument.")

        raise ValueError("Unsupported syntax. Use numbers, variables, + - * / ^, brackets and functions.")


_PARSER = _Parser()


def parse(source: str) -> sp.Expr:
    return _PARSER.parse(source)


def symbol(name: str) -> sp.Symbol:
    key = (name or "x").strip().lower()
    if key not in SYMBOLS:
        raise ValueError("Variable must be one of x, y, z, t, a, b, c or n.")
    return SYMBOLS[key]


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, sp.Basic):
        return sp.sstr(value)
    if isinstance(value, float):
        if math.isfinite(value) and abs(value - round(value)) < 1e-12:
            return str(int(round(value)))
        return f"{value:.12g}"
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k}: {fmt(v)}" for k, v in value.items()) + " }"
    if isinstance(value, (list, tuple, set)):
        return "[" + ", ".join(fmt(v) for v in value) + "]"
    return str(value)


def _steps_basic(mode: str, expr: sp.Expr, variable: sp.Symbol, result: Any, req: SolveRequest) -> list[str]:
    source = sp.sstr(expr)
    if mode == "simplify":
        return [
            f"Start with: {source}",
            "Expand brackets, combine like terms and cancel common factors.",
            f"Simplified form: {fmt(result)}",
        ]
    if mode == "factor":
        try:
            factors = sp.factor_list(expr)[1]
            detail = " × ".join(f"({fmt(base)})^{power}" if power != 1 else f"({fmt(base)})"
                                for base, power in factors)
            factor_line = f"Recognise the irreducible factors: {detail}"
        except Exception:
            factor_line = "Rewrite the expression as a product of simpler factors."
        return [f"Start with: {source}", factor_line, f"Factored form: {fmt(result)}"]
    if mode == "expand":
        return [f"Start with: {source}", "Multiply out every bracket and collect like terms.", f"Expanded form: {fmt(result)}"]
    if mode == "differentiate":
        return [
            f"Function: f({variable}) = {source}",
            f"Apply the sum, product/quotient and chain rules {fmt(req.order)} time(s).",
            f"Derivative: {fmt(result)}",
        ]
    if mode == "integrate":
        if req.second_expression.strip():
            return [
                f"Integrand: {source}",
                f"Find an antiderivative, then evaluate from {req.second_expression} to {req.third_expression or '?'}.",
                f"Definite integral: {fmt(result)}",
            ]
        return [
            f"Integrand: {source}",
            "Find an antiderivative using standard integral rules.",
            f"Indefinite integral: {fmt(result)} + C",
        ]
    if mode == "solve":
        return [
            f"Equation (moved to one side): {source} = 0",
            f"Solve for {variable}.",
            f"Solution: {fmt(result)}",
        ]
    if mode == "limit":
        direction = req.third_expression.strip() or "both sides"
        return [
            f"Function: {source}",
            f"Let {variable} approach {req.second_expression or '0'} from {direction}.",
            f"Limit: {fmt(result)}",
        ]
    if mode == "evaluate":
        return [
            f"Expression: {source}",
            f"Evaluate numerically to {req.precision} significant figures.",
            f"Value: {fmt(result)}",
        ]
    return [f"Input: {source}", f"Result: {fmt(result)}"]


def _check_range(req: SolveRequest) -> None:
    if req.xmax <= req.xmin:
        raise ValueError("The maximum x must be greater than the minimum x.")


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def _graph(req: SolveRequest, variable: sp.Symbol) -> dict:
    _check_range(req)
    pieces = [p.strip() for p in re.split(r"[;\n]+", req.expression) if p.strip()]
    if not pieces:
        raise ValueError("Enter one or more functions, separated by semicolons.")
    if len(pieces) > 8:
        raise ValueError("Graph at most 8 functions at once.")

    series = []
    for index, piece in enumerate(pieces):
        expr = parse(piece)
        try:
            func = sp.lambdify(variable, expr, modules=["math"])
        except Exception:
            func = sp.lambdify(variable, expr, modules=["sympy"])
        points = []
        span = req.xmax - req.xmin
        for i in range(req.samples):
            xv = req.xmin + span * i / (req.samples - 1)
            try:
                yv = float(func(xv))
            except Exception:
                continue
            if math.isfinite(yv) and abs(yv) < 1e8:
                points.append({"x": round(xv, 8), "y": round(yv, 8)})
        colours = ["#9b8cff", "#5ce1d6", "#ff85c8", "#ffd166", "#7dd3fc", "#a7f3a0", "#fca5a5", "#c4b5fd"]
        series.append({
            "label": f"f{index + 1}({variable}) = {fmt(expr)}",
            "colour": colours[index % len(colours)],
            "points": points,
        })
    return {
        "ok": True, "mode": "graph", "title": "Function graph",
        "result": f"{len(series)} function(s) plotted over [{fmt(req.xmin)}, {fmt(req.xmax)}]",
        "series": series,
        "xmin": req.xmin, "xmax": req.xmax,
        "steps": [
            f"Sampled {req.samples} x-values from {fmt(req.xmin)} to {fmt(req.xmax)}.",
            "Points where the function is undefined or too large were skipped.",
            "The lines connect the remaining valid points.",
        ],
    }


def _matrix(req: SolveRequest) -> dict:
    matrix_a = req.matrix_a
    if not matrix_a and req.expression.strip():
        # Accept a JSON matrix typed straight into the main input box.
        import json

        try:
            matrix_a = json.loads(req.expression)
        except (ValueError, TypeError) as exc:
            raise ValueError("Enter matrix A as rows of numbers, e.g. [[1,2],[3,4]].") from exc
    if not matrix_a or not isinstance(matrix_a, list) or not all(isinstance(row, list) for row in matrix_a):
        raise ValueError("Enter matrix A as rows of numbers, e.g. [[1,2],[3,4]].")
    rows = len(matrix_a)
    if rows == 0 or any(len(row) != len(matrix_a[0]) for row in matrix_a):
        raise ValueError("Every row of matrix A must have the same length.")
    A = sp.Matrix(matrix_a)
    op = (req.matrix_op or "properties").strip().lower()
    matrix_b = req.matrix_b
    if not matrix_b and req.second_expression.strip():
        import json

        try:
            matrix_b = json.loads(req.second_expression)
        except (ValueError, TypeError) as exc:
            raise ValueError("Enter matrix B as valid JSON, e.g. [[5,6],[7,8]].") from exc
    B = sp.Matrix(matrix_b) if matrix_b else None

    if op in {"add", "subtract", "multiply", "solve"} and B is None:
        raise ValueError("Matrix B is required for this operation.")

    if op == "add":
        if A.shape != B.shape:
            raise ValueError("A and B must have the same dimensions for addition.")
        result = {"result": str(A + B).replace("\n", "  "), "shape": fmt(A.shape)}
        title, steps = "A + B", ["Check that both matrices have the same size.", "Add entries in matching positions."]
    elif op == "subtract":
        if A.shape != B.shape:
            raise ValueError("A and B must have the same dimensions for subtraction.")
        result = {"result": str(A - B).replace("\n", "  "), "shape": fmt(A.shape)}
        title, steps = "A − B", ["Check that both matrices have the same size.", "Subtract entries in matching positions."]
    elif op == "multiply":
        if A.cols != B.rows:
            raise ValueError(f"A is {A.rows}×{A.cols} and B is {B.rows}×{B.cols}; A.cols must equal B.rows.")
        result = {"result": str(A * B).replace("\n", "  "), "shape": fmt((A.rows, B.cols))}
        title, steps = "A × B", ["Check the inner dimensions match.", "Take row-by-column dot products."]
    elif op == "power":
        result = {"result": str(A ** req.order).replace("\n", "  "), "shape": fmt(A.shape)}
        title, steps = f"A^{req.order}", ["A square matrix is required for powers.", "Repeatedly multiply A by itself."]
        if A.rows != A.cols:
            raise ValueError("Only square matrices can be raised to a power.")
    elif op == "solve":
        if B.rows != A.rows:
            raise ValueError(f"A has {A.rows} rows but B has {B.rows}; they must match.")
        solution = A.LUsolve(B)
        result = {"solution X": str(solution).replace("\n", "  "), "shape": fmt(solution.shape)}
        title, steps = "Solve A·X = B", ["Check A is square and B has one column per right-hand side.", "Use LU decomposition to solve for X."]
        if A.rows != A.cols:
            raise ValueError("A must be square to solve A·X = B.")
    elif op in {"det", "inverse", "eigen", "transpose", "rank"} or op == "properties":
        if A.rows != A.cols:
            if op in {"det", "inverse", "eigen", "properties"}:
                raise ValueError("This operation needs a square matrix.")
        det = A.det() if A.rows == A.cols else None
        result: dict[str, str] = {"shape": fmt(A.shape), "transpose": str(A.T).replace("\n", "  "), "rank": fmt(A.rank())}
        if det is not None:
            result["determinant"] = fmt(det)
            result["trace"] = fmt(A.trace())
            result["inverse"] = str(A.inv()).replace("\n", "  ") if det != 0 else "Not available (singular matrix)."
            if A.rows <= 4:
                result["eigenvalues"] = fmt([sp.sstr(v) for v in A.eigenvals().keys()])
        title, steps = "Matrix properties", ["Read the entries of A.", "Compute determinant, transpose, rank and inverse where they exist."]
    else:
        raise ValueError("Unknown matrix operation. Choose properties, add, subtract, multiply, power, solve, det, inverse or eigen.")

    return {"ok": True, "mode": "matrix", "title": title, "result": result, "steps": steps}


def _statistics(req: SolveRequest) -> dict:
    values = req.data or []
    if not values and req.expression.strip():
        chunks = re.split(r"[\s,;]+", req.expression.strip())
        try:
            values = [float(c) for c in chunks if c]
        except ValueError as exc:
            raise ValueError("Enter numbers separated by commas or spaces.") from exc
    if not values:
        raise ValueError("Enter at least one number.")
    if len(values) > 2000:
        raise ValueError("At most 2000 numbers can be analysed.")
    ordered = sorted(values)
    n = len(ordered)
    counts = Counter(ordered)
    modes = [v for v, count in counts.items() if count == max(counts.values())]

    def q(fraction: float) -> float:
        if n == 1:
            return ordered[0]
        pos = (n - 1) * fraction
        low = math.floor(pos)
        high = math.ceil(pos)
        if low == high:
            return ordered[low]
        return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)

    result = {
        "count": str(n),
        "sum": fmt(sum(ordered)),
        "mean": fmt(mean(ordered)),
        "median": fmt(median(ordered)),
        "mode": fmt(modes) if len(modes) != n else "No repeating value",
        "minimum": fmt(ordered[0]),
        "maximum": fmt(ordered[-1]),
        "range": fmt(ordered[-1] - ordered[0]),
        "variance (population)": fmt(pvariance(ordered)) if n > 1 else "0",
        "std. dev. (population)": fmt(pstdev(ordered)) if n > 1 else "0",
        "variance (sample)": fmt(variance(ordered)) if n > 1 else "Not defined",
        "std. dev. (sample)": fmt(stdev(ordered)) if n > 1 else "Not defined",
        "Q1": fmt(q(0.25)),
        "Q3": fmt(q(0.75)),
        "IQR": fmt(q(0.75) - q(0.25)),
    }
    return {
        "ok": True, "mode": "statistics", "title": "Descriptive statistics", "result": result,
        "steps": [
            f"Sort the {n} value(s) from smallest to largest.",
            "Mean = sum ÷ count; median = middle value (average of the two middle values for an even count).",
            "Spread is measured with variance and standard deviation (population and sample).",
            "Quartiles split the ordered data into four equal parts.",
        ],
    }


def _number_theory(req: SolveRequest) -> dict:
    try:
        value = int(float(req.expression.strip()))
    except (TypeError, ValueError) as exc:
        raise ValueError("Enter a whole number for number theory.") from exc
    if abs(value) > 10**12:
        raise ValueError("Please use an integer smaller than 10^12.")
    op = (req.second_expression or "overview").strip().lower()
    n = abs(value)
    result: dict[str, str] = {"number": str(value), "sign": "positive" if value >= 0 else "negative"}

    if op in {"overview", "prime", "factors", "divisors"}:
        result["prime"] = "yes" if n > 1 and sp.isprime(n) else "no"
        result["prime factorisation"] = fmt({k: v for k, v in sp.factorint(n).items()}) if n > 1 else "not defined"
        result["divisors"] = fmt(sp.divisors(n)) if n > 0 else "not defined"
        result["number of divisors"] = str(sp.divisor_count(n)) if n > 0 else "not defined"
        result["Euler φ(n)"] = str(sp.totient(n)) if n > 0 else "not defined"
        result["sum of divisors σ(n)"] = str(sp.divisor_sigma(n)) if n > 0 else "not defined"
        result["digit sum"] = str(sum(int(d) for d in str(n)))
    elif op in {"gcd", "lcm"}:
        try:
            other = int(float(req.third_expression.strip()))
        except (TypeError, ValueError) as exc:
            raise ValueError("Enter the second integer in the 'Second number' field.") from exc
        result["second number"] = str(other)
        result["greatest common divisor"] = str(math.gcd(n, abs(other)))
        result["least common multiple"] = str(abs(n * other) // math.gcd(n, abs(other))) if n and other else "0"
    elif op == "base":
        try:
            base = int(float(req.third_expression.strip() or "2"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Enter a base between 2 and 36.") from exc
        if not 2 <= base <= 36:
            raise ValueError("Base must be between 2 and 36.")
        digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if n == 0:
            converted = "0"
        else:
            converted = ""
            while n:
                n, rem = divmod(n, base)
                converted = digits[rem] + converted
        result[f"base {base}"] = converted
    else:
        raise ValueError("Choose overview, prime, factors, divisors, gcd, lcm or base.")

    return {
        "ok": True, "mode": "number", "title": f"Number theory: {value}", "result": result,
        "steps": [
            f"Write {value} in the requested form.",
            "Use trial division / Euclid's algorithm as appropriate.",
            "Check the result by multiplying the factors back together.",
        ],
    }


def _word(req: SolveRequest, ai_explain) -> dict:
    problem = (req.word_problem or req.expression).strip()
    if not problem:
        raise ValueError("Describe the word problem first.")
    explanation = ai_explain("Solve this word problem and explain the mathematical setup in clear, numbered steps:\n" + problem)
    if explanation is None:
        return {
            "ok": False,
            "error": "The AI tutor needs an OPENAI_API_KEY. You can still use the equation solver with the algebra from the problem.",
        }
    return {
        "ok": True, "mode": "word", "title": "Word problem explanation", "result": explanation,
        "steps": [explanation], "ai_used": True,
    }


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def compute(req: SolveRequest, ai_explain) -> dict:
    """Run the requested operation and return an API-ready dictionary."""
    mode = (req.mode or "simplify").strip().lower()
    var = symbol(req.variable)

    if mode == "matrix":
        return _matrix(req)
    if mode == "word":
        return _word(req, ai_explain)
    if mode == "statistics":
        return _statistics(req)
    if mode == "number":
        return _number_theory(req)
    if mode == "graph":
        return _graph(req, var)

    raw = req.expression.strip()
    if not raw:
        raise ValueError("Enter an expression first.")

    if mode == "solve" and ";" in raw:
        pieces = [p for p in (part.strip() for part in raw.split(";")) if p]
        equations = []
        for piece in pieces:
            left, _, right = piece.partition("=")
            equations.append(parse(left) - parse(right) if right else parse(left))
        unknowns = sorted({s for eq in equations for s in eq.free_symbols}, key=lambda s: s.name)
        if not unknowns:
            raise ValueError("No variable found in the system of equations.")
        solved = sp.solve(equations, unknowns, dict=True)
        result = solved if solved else []
        steps = [
            f"System of {len(equations)} equation(s) with unknowns {', '.join(str(s) for s in unknowns)}.",
            "Rewrite each equation so one side is zero, then solve the system simultaneously.",
            f"Solution: {fmt(result)}",
        ]
        return {"ok": True, "mode": mode, "title": "Solution", "result": fmt(result), "steps": steps}

    if mode == "solve":
        left, separator, right = raw.partition("=")
        expr = parse(left) - parse(right) if separator else parse(left)
        result = sp.solve(expr, var)
        title = "Solution"
    elif mode == "limit":
        expr = parse(raw)
        point = parse(req.second_expression or "0")
        direction = (req.third_expression or "both").strip().lower()
        direction = {"left": "-", "right": "+", "both": "+-", "+-": "+-", "-": "-", "+": "+"}.get(direction, "+-")
        result = sp.limit(expr, var, point, dir=direction)
        title = "Limit"
    elif mode in {"simplify", "factor", "expand", "differentiate", "integrate", "evaluate"}:
        expr = parse(raw)
        if mode == "simplify":
            result = sp.simplify(expr)
        elif mode == "factor":
            result = sp.factor(expr)
        elif mode == "expand":
            result = sp.expand(expr)
        elif mode == "differentiate":
            result = sp.diff(expr, var, req.order)
        elif mode == "integrate":
            if req.second_expression.strip():
                lower = parse(req.second_expression)
                upper = parse(req.third_expression) if req.third_expression.strip() else sp.oo
                result = sp.integrate(expr, (var, lower, upper))
            else:
                result = sp.integrate(expr, var)
        else:  # evaluate
            value = sp.N(expr, req.precision)
            # Drop meaningless trailing zeros: 25.000000 -> 25.
            if value.is_Float and value.is_finite and abs(value - sp.Integer(round(float(value)))) < 1e-12:
                result = sp.Integer(round(float(value)))
            else:
                result = value
        title = {
            "simplify": "Simplified expression", "factor": "Factored expression",
            "expand": "Expanded expression", "differentiate": "Derivative",
            "integrate": "Integral", "evaluate": "Value",
        }[mode]
    else:
        raise ValueError("Unknown mode. Choose one of the tools in the sidebar.")

    result_text = fmt(result)
    if mode == "integrate" and not req.second_expression.strip():
        result_text += " + C"
    if mode == "evaluate":
        try:
            exact = sp.simplify(parse(raw))
        except Exception:
            exact = expr
        if sp.sstr(exact) != sp.sstr(result):
            steps = [f"Exact form: {fmt(exact)}", f"Round to {req.precision} significant figures.", f"Value: {result_text}"]
        else:
            steps = _steps_basic(mode, expr, var, result, req)
    else:
        steps = _steps_basic(mode, expr, var, result, req)

    response: dict[str, Any] = {
        "ok": True, "mode": mode, "title": title,
        "result": result_text, "steps": steps,
    }
    if mode in {"simplify", "factor", "expand", "differentiate", "integrate", "solve", "limit"}:
        response["exact"] = sp.sstr(expr)
    return response


CAPABILITIES = [
    {"id": "simplify", "label": "Simplify", "description": "Simplify an algebraic expression"},
    {"id": "solve", "label": "Solve", "description": "Solve an equation or a system"},
    {"id": "factor", "label": "Factor", "description": "Factor an expression"},
    {"id": "expand", "label": "Expand", "description": "Expand brackets"},
    {"id": "differentiate", "label": "Derivative", "description": "Differentiate, with optional order"},
    {"id": "integrate", "label": "Integral", "description": "Indefinite or definite integral"},
    {"id": "limit", "label": "Limit", "description": "Limit from either side"},
    {"id": "evaluate", "label": "Calculate", "description": "Numeric evaluation to chosen precision"},
    {"id": "graph", "label": "Graph", "description": "Plot up to eight functions"},
    {"id": "matrix", "label": "Matrix", "description": "Determinant, inverse, eigen, solve systems"},
    {"id": "statistics", "label": "Statistics", "description": "Mean, spread and quartiles"},
    {"id": "number", "label": "Number theory", "description": "Primes, factors, gcd/lcm, bases"},
    {"id": "word", "label": "AI tutor", "description": "Explain a word problem (needs API key)"},
]
