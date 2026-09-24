"""Flattens the design system's WOOW symbol (a PDF export with nested transforms and
clip paths) into plain paths, in a viewBox that tightly wraps the symbol.

    python3 woowtech/tools/flatten-symbol.py

Reads woowtech/brand/woowtech-symbol.svg, writes woowtech/brand/woowtech-symbol-path.svg.
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

BRAND = Path(__file__).resolve().parent.parent / "brand"
SOURCE = BRAND / "woowtech-symbol.svg"
TARGET = BRAND / "woowtech-symbol-path.svg"
SYMBOL_FILL = "#6183fc"
NS = "{http://www.w3.org/2000/svg}"

def parse_transform(text):
    matrix = (1, 0, 0, 1, 0, 0)
    for name, args in re.findall(r"(matrix|translate)\(([^)]*)\)", text or ""):
        values = [float(v) for v in re.split(r"[ ,]+", args.strip())]
        step = tuple(values) if name == "matrix" else (1, 0, 0, 1, values[0], values[1] if len(values) > 1 else 0)
        matrix = compose(matrix, step)
    return matrix

def compose(outer, inner):
    a, b, c, d, e, f = outer
    A, B, C, D, E, F = inner
    return (a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f)

def apply(matrix, x, y):
    a, b, c, d, e, f = matrix
    return a * x + c * y + e, b * x + d * y + f

def walk(element, matrix, out):
    matrix = compose(matrix, parse_transform(element.get("transform")))
    if element.tag == NS + "path" and element.get("fill", "").lower() == SYMBOL_FILL:
        out.append((element.get("d"), matrix))
    for child in element:
        if child.tag in (NS + "defs", NS + "clipPath"):
            continue
        walk(child, matrix, out)

root = ET.parse(SOURCE).getroot()
min_x, min_y, width, height = (float(v) for v in root.get("viewBox").split())
paths = []
walk(root, (1, 0, 0, 1, 0, 0), paths)

commands = []
for d, matrix in paths:
    tokens = re.findall(r"[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    points, inside = [], False
    converted, i = [], 0
    while i < len(tokens):
        token = tokens[i]
        if token == "Z":
            converted.append("Z"); i += 1; continue
        count = {"M": 1, "L": 1, "C": 3}[token]
        coords = []
        for k in range(count):
            x, y = apply(matrix, float(tokens[i + 1 + 2 * k]), float(tokens[i + 2 + 2 * k]))
            if k == count - 1:
                points.append((x, y))  # on-curve points only; control points may stray
            coords.append(f"{x - min_x:.3f} {y - min_y:.3f}")
        converted.append(token + " " + " ".join(coords))
        i += 1 + 2 * count
    # Keep shapes that overlap the symbol's viewBox (the export also holds page art).
    xs, ys = [x for x, _ in points], [y for _, y in points]
    overlaps = max(xs) > min_x and min(xs) < min_x + width and max(ys) > min_y and min(ys) < min_y + height
    if overlaps:
        commands.append(" ".join(converted))
    else:
        print(f"  skipped page art at x {min(xs):.0f}..{max(xs):.0f}, y {min(ys):.0f}..{max(ys):.0f}")

# One path per shape: the strokes overlap, and a single combined path would let
# opposite windings cancel out where they cross.
TARGET.write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">'
    + "".join(f'<path fill="{SYMBOL_FILL}" d="{d}"/>' for d in commands)
    + "</svg>\n",
    encoding="utf-8",
)
print(f"{len(commands)} of {len(paths)} {SYMBOL_FILL} shapes kept -> {TARGET.name}")
