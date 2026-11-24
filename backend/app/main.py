"""5K6Learn MathBot — API entry point.

Run with:  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .engine import CAPABILITIES, compute
from .models import SolveRequest

load_dotenv()

app = FastAPI(
    title="5K6Learn MathBot API",
    version=__version__,
    description="A safe symbolic mathematics engine powered by SymPy.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Fine for a local tool; restrict before a public deployment.
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    message = first.get("msg", "Invalid request.")
    return JSONResponse(status_code=422, content={"ok": False, "detail": f"Invalid input: {message}"})


def ai_explain(prompt: str) -> str | None:
    """Return an AI explanation when an API key is configured, else None."""
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=key)
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            instructions=(
                "You are 5K6Learn MathBot, a careful and friendly maths tutor. "
                "Explain in plain English with numbered steps, state assumptions, "
                "and never change a verified symbolic result supplied by the engine."
            ),
            input=prompt,
        )
        return response.output_text
    except Exception:
        # Never leak provider errors or keys to the browser.
        return "The AI tutor is temporarily unavailable. The engine result below is still valid."


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine": "SymPy",
        "version": __version__,
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "tools": len(CAPABILITIES),
    }


@app.get("/api/modes")
def modes() -> dict:
    return {"ok": True, "modes": CAPABILITIES}


@app.post("/api/solve")
def solve(req: SolveRequest) -> dict:
    try:
        return compute(req, ai_explain)
    except (ValueError, TypeError, ZeroDivisionError, ArithmeticError) as exc:
        return {"ok": False, "error": str(exc) or "That input could not be calculated."}
    except Exception:
        return {"ok": False, "error": "The calculation failed. Try a simpler expression or a different tool."}


@app.get("/api/hello")
def hello() -> dict:
    return {"message": "5K6Learn MathBot API is running.", "docs": "/docs", "health": "/api/health"}


# Serve the website from the same origin when the frontend folder is present.
# Registered last so the API routes above always win.
_FRONTEND = Path(__file__).resolve().parent.parent.parent / "frontend"
if (_FRONTEND / "index.html").is_file():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")
