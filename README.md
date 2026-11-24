# 5K6Learn MathBot

A precise mathematics workbench with an editorial interface. Everything runs **in the browser** — open `frontend/index.html` and start calculating. No server, installer, account or network connection required.

## Start

Open **`frontend/index.html`** in Chrome, Edge or Firefox.

That is the entire setup. You do not need to run `run.bat`, start Python, or connect to a backend.

## What changed

- **No cards, no gradients, no purple.** The layout uses typography, hairline rules and whitespace instead of stacked boxes.
- **Five colour palettes**, switchable from the header: Graphite, Paper, Arctic, Forest and Copper.
- **New typefaces**, bundled locally: Bricolage Grotesque (display), Instrument Sans (body), JetBrains Mono (data and code).
- **Real SVG icons** throughout — no emoji or glyph characters.
- **A full hero section**, tool index, capability list, method section and a proper site footer.
- **A fully local engine** — the maths runs in this tab using a bundled math.js plus exact rational polynomial arithmetic.

## Tools

| Tool | Example |
|------|---------|
| Simplify | `(x+2)^2 − x^2` |
| Solve | `2x + 5 = 15`, quadratics and numeric roots |
| Factor / Expand | `x^2 − 5x + 6`, `(x+2)^3` |
| Derivative | `x^3 + sin(x)`, adjustable order |
| Integral | Indefinite, or definite with bounds (Simpson's rule) |
| Limit | Substitution, L'Hôpital or numeric convergence |
| Calculator | Keypad for basic arithmetic, brackets, percentages and powers |
| Calculate | High-precision numeric evaluation |
| Graph | Up to 8 functions, adjustable range, hover readout |
| Matrix | Determinant, inverse, rank, eigenvalues, products, `AX = B` |
| Statistics | Mean, median, mode, variance, standard deviation, quartiles |
| Number theory | Primes, factors, divisors, φ(n), gcd/lcm, base conversion |
| Word problems | Common wording translated into equations |

Extras: saved history with search, keyboard shortcuts (`Enter` calculate, `Esc` reset, `1`–`9` jump to tool), copyable answers and step-by-step methods.

## Project structure

```
5k6learnmathbot/
├── frontend/
│   ├── index.html              # Header, hero, workbench, sections, footer
│   ├── css/
│   │   ├── fonts.css           # Locally bundled typefaces
│   │   ├── palettes.css        # Five complete colour systems
│   │   ├── base.css            # Reset and canvas
│   │   ├── layout.css          # Editorial structure, responsive rules
│   │   └── components.css      # Controls, plot, drawer
│   ├── fonts/                  # woff2 files
│   └── js/
│       ├── vendor/math.js      # Bundled math.js
│       ├── engine.js           # All calculations, in-browser
│       ├── config.js           # Tool and palette catalogue
│       ├── graph.js            # Canvas plotting
│       ├── history.js          # LocalStorage history
│       ├── ui.js               # DOM rendering
│       ├── api.js              # Local API shim
│       └── app.js              # Controller
├── backend/                    # Optional legacy Python API — not needed
├── run.bat                     # Optional legacy launcher — not needed
└── README.md
```

Notes on the expression language: powers use `^`, multiplication may be implicit (`2x`, `(x+1)(x−1)`), constants include `pi`, `e`, `i`, and functions include `sin`, `cos`, `tan`, `sqrt`, `log(x, base)`, `exp`, `abs`, `floor`, `ceil`, `gcd`, `lcm` and more. Input is parsed into a restricted expression tree; nothing typed by the user is executed as code.
