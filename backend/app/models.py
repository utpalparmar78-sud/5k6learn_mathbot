"""Request models for the MathBot API.

All user input is validated here before it ever reaches the maths engine.
Field limits keep the symbolic parser safe and responses fast.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SolveRequest(BaseModel):
    """A single calculation request.

    ``mode`` selects the operation. Only the fields relevant to that mode
    need to be supplied; everything else has a sensible default.
    """

    mode: str = Field(default="simplify", max_length=40)
    expression: str = Field(default="", max_length=1200)
    variable: str = Field(default="x", max_length=8)
    second_expression: str = Field(default="", max_length=600)
    third_expression: str = Field(default="", max_length=600)

    order: int = Field(default=1, ge=1, le=12)
    precision: int = Field(default=8, ge=1, le=40)

    xmin: float = Field(default=-10.0, ge=-1e9, le=1e9)
    xmax: float = Field(default=10.0, ge=-1e9, le=1e9)
    samples: int = Field(default=240, ge=20, le=1200)

    matrix_a: list[list[float]] | None = None
    matrix_b: list[list[float]] | None = None
    matrix_op: str = Field(default="properties", max_length=30)

    data: list[float] | None = None
    word_problem: str = Field(default="", max_length=3000)
