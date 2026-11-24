"""Quick engine check: run with `.venv\\Scripts\\python.exe backend\\smoke_test.py`."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.engine import compute
from app.main import ai_explain
from app.models import SolveRequest

CASES: list[tuple[dict, str]] = [
    ({"mode": "simplify", "expression": "(x+2)^2 - x^2"}, "4*x + 4"),
    ({"mode": "solve", "expression": "2*x + 5 = 15"}, "[5]"),
    ({"mode": "factor", "expression": "x^2 - 5*x + 6"}, "(x - 3)*(x - 2)"),
    ({"mode": "expand", "expression": "(x+2)^2"}, "x**2 + 4*x + 4"),
    ({"mode": "differentiate", "expression": "x^3"}, "3*x**2"),
    ({"mode": "integrate", "expression": "2*x"}, "x**2 + C"),
    ({"mode": "limit", "expression": "sin(x)/x"}, "1"),
    ({"mode": "evaluate", "expression": "sqrt(81) + 4^2"}, "25"),
    ({"mode": "evaluate", "expression": "1e-3 + 2pi"}, "6.2841853"),
    ({"mode": "statistics", "expression": "1,2,3,4,5"}, "mean: 3"),
    ({"mode": "number", "expression": "56", "second_expression": "overview"}, "prime: no"),
    ({"mode": "matrix", "expression": "[[1,2],[3,4]]", "matrix_op": "det"}, "determinant: -2"),
]

def flatten(value) -> str:
    if isinstance(value, dict):
        return "\n".join(f"{key}: {flatten(item)}" for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return ", ".join(flatten(item) for item in value)
    return str(value)


failures = 0
for payload, expected in CASES:
    try:
        response = compute(SolveRequest(**payload), ai_explain)
        rendered = flatten(response.get("result", ""))
        okay = response.get("ok") and expected in rendered
        print(("PASS" if okay else "FAIL"), payload["mode"], "->", rendered[:70].replace("\n", " "))
        if not okay:
            failures += 1
    except Exception as exc:  # noqa: BLE001
        print("FAIL", payload["mode"], "-> exception:", exc)
        failures += 1

# Graph and system-of-equations responses have structured shapes.
for payload in (
    {"mode": "graph", "expression": "x^2; sin(x)"},
    {"mode": "solve", "expression": "x+y=5; x-y=1"},
    {"mode": "matrix", "expression": "[[1,2],[3,4]]", "matrix_op": "properties"},
):
    response = compute(SolveRequest(**payload), ai_explain)
    okay = bool(response.get("ok"))
    print(("PASS" if okay else "FAIL"), payload["mode"], "(structured response)")
    if not okay:
        failures += 1

print("\n" + ("All checks passed." if failures == 0 else f"{failures} check(s) failed."))
sys.exit(1 if failures else 0)
