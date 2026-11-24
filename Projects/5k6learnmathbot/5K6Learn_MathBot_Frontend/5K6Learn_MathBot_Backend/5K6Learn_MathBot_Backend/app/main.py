
from __future__ import annotations

import ast
import math
import os
from typing import Any

import sympy as sp
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()
app = FastAPI(title="5K6Learn MathBot API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this to your deployed frontend domain before production.
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

x, y, z, t, a, b, c, n = sp.symbols("x y z t a b c n")
SAFE_NAMES = {
    "x": x, "y": y, "z": z, "t": t, "a": a, "b": b, "c": c, "n": n,
    "pi": sp.pi, "e": sp.E, "E": sp.E,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "sqrt": sp.sqrt, "log": sp.log, "ln": sp.log,
    "exp": sp.exp, "abs": sp.Abs, "Abs": sp.Abs,
    "floor": sp.floor, "ceil": sp.ceiling,
    "factorial": sp.factorial,
}
BINOPS = {
    ast.Add: lambda l, r: l + r,
    ast.Sub: lambda l, r: l - r,
    ast.Mult: lambda l, r: l * r,
    ast.Div: lambda l, r: l / r,
    ast.Pow: lambda l, r: l ** r,
    ast.Mod: lambda l, r: sp.Mod(l, r),
}
UNARYOPS = {ast.UAdd: lambda v: v, ast.USub: lambda v: -v}

class SolveRequest(BaseModel):
    expression: str = Field(default="", max_length=500)
    mode: str = Field(default="simplify", max_length=30)
    variable: str = Field(default="x", max_length=10)
    second_expression: str = Field(default="", max_length=500)
    matrix_a: list[list[float]] | None = None
    matrix_b: list[list[float]] | None = None
    word_problem: str = Field(default="", max_length=2000)

def safe_expr(source: str) -> sp.Expr:
    """Parse a deliberately small mathematical grammar; never eval user input."""
    source = source.strip().replace("^", "**").replace("π", "pi")
    if not source or len(source) > 500:
        raise ValueError("Enter a mathematical expression (up to 500 characters).")
    # Permit implicit multiplication like 2x and 2(x+1) in a safe way.
    import re
    source = re.sub(r"(?<=\d)\s*(?=[a-zA-Z(])", "*", source)
    source = re.sub(r"(?<=\))\s*(?=[a-zA-Z(0-9])", "*", source)
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError as exc:
        raise ValueError("I couldn't read that expression. Try 2*x + 3 or sin(pi/2).") from exc

    def visit(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return sp.Integer(node.value) if isinstance(node.value, int) else sp.Float(node.value)
        if isinstance(node, ast.Name):
            if node.id in SAFE_NAMES and not callable(SAFE_NAMES[node.id]):
                return SAFE_NAMES[node.id]
            if node.id in SAFE_NAMES and node.id not in {"sin","cos","tan","asin","acos","atan","sinh","cosh","tanh","sqrt","log","ln","exp","abs","Abs","floor","ceil","factorial"}:
                return SAFE_NAMES[node.id]
            if node.id in {"sin","cos","tan","asin","acos","atan","sinh","cosh","tanh","sqrt","log","ln","exp","abs","Abs","floor","ceil","factorial"}:
                raise ValueError(f"Use {node.id}(...) as a function.")
            raise ValueError(f"Unknown symbol or function: {node.id}")
        if isinstance(node, ast.BinOp) and type(node.op) in BINOPS:
            return BINOPS[type(node.op)](visit(node.left), visit(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in UNARYOPS:
            return UNARYOPS[type(node.op)](visit(node.operand))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SAFE_NAMES:
            fn = SAFE_NAMES[node.func.id]
            if not callable(fn):
                raise ValueError(f"{node.func.id} is a constant, not a function.")
            if node.keywords or len(node.args) != 1:
                raise ValueError("Functions must have exactly one argument, e.g. sin(x).")
            return fn(visit(node.args[0]))
        raise ValueError("Unsupported syntax. Use numbers, x/y/z, + - * / ^, parentheses, and supported functions.")
    result = visit(tree)
    if not isinstance(result, sp.Basic):
        result = sp.sympify(result)
    return result

def fmt(value: Any) -> str:
    return str(value)

def make_steps(mode: str, expr: sp.Expr, variable: sp.Symbol, result: Any) -> list[str]:
    steps = [f"Input: {sp.sstr(expr)}"]
    if mode == "simplify":
        steps += [f"Combine like terms and simplify: {sp.sstr(result)}"]
    elif mode == "factor":
        steps += [f"Rewrite as a product of factors: {sp.sstr(result)}"]
    elif mode == "expand":
        steps += [f"Multiply out brackets: {sp.sstr(result)}"]
    elif mode == "differentiate":
        steps += [f"Differentiate with respect to {variable}: apply the power, sum, and chain rules as needed."]
        steps += [f"Derivative: {sp.sstr(result)}"]
    elif mode == "integrate":
        steps += [f"Integrate with respect to {variable}: find an antiderivative."]
        steps += [f"Integral: {sp.sstr(result)} + C"]
    elif mode == "solve":
        steps += ["Move all terms to one side and find values that make the equation equal to zero."]
        steps += [f"Solution: {sp.sstr(result)}"]
    elif mode == "limit":
        steps += [f"Evaluate the limit as {variable} approaches the requested value."]
        steps += [f"Limit: {sp.sstr(result)}"]
    else:
        steps += [f"Result: {sp.sstr(result)}"]
    return steps

def ai_explain(prompt: str) -> str | None:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            instructions=(
                "You are 5K6Learn MathBot, a careful maths tutor. Explain in simple English, "
                "show numbered steps, state assumptions, and do not invent a numeric answer. "
                "The symbolic maths engine's result is authoritative when supplied."
            ),
            input=prompt,
        )
        return response.output_text
    except Exception:
        # Do not leak secrets or provider exception details to the browser.
        return "AI explanation is temporarily unavailable. The mathematical result below was computed by the maths engine."

@app.get("/api/health")
def health():
    return {"status": "ok", "math_engine": "SymPy", "ai_enabled": bool(os.getenv("OPENAI_API_KEY", "").strip())}

@app.post("/api/solve")
def solve(req: SolveRequest):
    mode = req.mode.lower().strip()
    variable_name = req.variable.strip() or "x"
    if variable_name not in {"x", "y", "z", "t", "a", "b", "c", "n"}:
        return {"ok": False, "error": "Variable must be one of x, y, z, t, a, b, c, n."}
    var = SAFE_NAMES[variable_name]
    try:
        if mode == "matrix":
            if not req.matrix_a:
                raise ValueError("Enter matrix A as rows of numbers.")
            A = sp.Matrix(req.matrix_a)
            if req.matrix_b is not None:
                B = sp.Matrix(req.matrix_b)
                if A.shape != B.shape:
                    raise ValueError("Matrix A and B must have the same dimensions for addition.")
                result = A + B
                title = "A + B"
            else:
                result = {
                    "determinant": sp.sstr(A.det()) if A.rows == A.cols else "Only square matrices have a determinant.",
                    "transpose": str(A.T.tolist()),
                    "inverse": str(A.inv().tolist()) if A.rows == A.cols and A.det() != 0 else "Not available (matrix is not square or is singular).",
                }
                title = "Matrix properties"
            return {"ok": True, "mode": mode, "title": title, "result": result, "steps": ["Read the matrix entries.", "Apply the requested matrix operation."]}
        if mode == "word":
            if not req.word_problem.strip():
                raise ValueError("Enter a word problem first.")
            explanation = ai_explain("Solve this word problem and explain the mathematical setup step by step:\n" + req.word_problem)
            if explanation is None:
                return {"ok": False, "error": "Word-problem interpretation needs an OpenAI API key. You can still enter the equation directly without one."}
            return {"ok": True, "mode": mode, "title": "Word problem explanation", "result": explanation, "steps": [explanation], "ai_used": True}

        raw = req.expression.strip()
        if mode == "solve":
            if "=" in raw:
                left, right = raw.split("=", 1)
                expr = safe_expr(left) - safe_expr(right)
            else:
                expr = safe_expr(raw)
            result = sp.solve(expr, var)
        elif mode == "limit":
            # Input e.g. sin(x)/x; second_expression is the approach value, default 0.
            expr = safe_expr(raw)
            point = safe_expr(req.second_expression or "0")
            result = sp.limit(expr, var, point)
        else:
            expr = safe_expr(raw)
            if mode == "simplify":
                result = sp.simplify(expr)
            elif mode == "factor":
                result = sp.factor(expr)
            elif mode == "expand":
                result = sp.expand(expr)
            elif mode == "differentiate":
                result = sp.diff(expr, var)
            elif mode == "integrate":
                result = sp.integrate(expr, var)
            elif mode == "evaluate":
                result = sp.N(expr)
            elif mode == "graph":
                # Generate numeric points for the browser canvas.
                fn = sp.lambdify(var, expr, modules=["math"])
                points = []
                for i in range(161):
                    xv = -10 + i * 0.125
                    try:
                        yv = float(fn(xv))
                        if math.isfinite(yv) and abs(yv) < 1e6:
                            points.append({"x": xv, "y": yv})
                    except Exception:
                        continue
                return {"ok": True, "mode": mode, "title": f"Graph of {sp.sstr(expr)}", "result": f"f({variable_name}) = {sp.sstr(expr)}", "points": points, "steps": ["The expression was evaluated at points from -10 to 10.", "The graph connects the valid finite points."]}
            else:
                raise ValueError("Unknown mode. Choose simplify, solve, factor, expand, differentiate, integrate, limit, evaluate, graph, matrix, or word.")
        steps = make_steps(mode, expr, var, result)
        response = {"ok": True, "mode": mode, "title": "Solution", "result": sp.sstr(result), "steps": steps}
        if os.getenv("OPENAI_API_KEY", "").strip() and mode not in {"evaluate", "graph"}:
            response["ai_explanation"] = ai_explain(
                f"Math operation: {mode}\nExpression: {sp.sstr(expr)}\nVariable: {variable_name}\nVerified engine result: {sp.sstr(result)}\nExplain the method simply without changing the result."
            )
        return response
    except (ValueError, TypeError, ZeroDivisionError, sp.SympifyError) as exc:
        return {"ok": False, "error": str(exc)}
    except Exception:
        return {"ok": False, "error": "The expression could not be solved in this mode. Check the input or try a simpler expression."}

@app.get("/")
def home():
    return {"message": "5K6Learn MathBot API is running", "docs": "/docs", "health": "/api/health"}
