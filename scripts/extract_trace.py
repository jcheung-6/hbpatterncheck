#!/usr/bin/env python3
"""Extract anonymous chromatogram traces from a Variant II or Sebia PDF/image.

Prints JSON to stdout: method, peak positions, percentages, and a 128-point curve.
Does not emit filenames, patient names, sample numbers, dates, or comments.
Requires pymupdf and, for scanned pages, the tesseract binary.
"""

from __future__ import annotations

import json
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf

CURVE_N = 128
NAME_RE = re.compile(
    r"^(unknown|f|fe|p1|p2|p3|b3|ao|a0|aa|a2|s|d|c|hba|hba2|hb)$",
    re.I,
)


def main() -> None:
    if len(sys.argv) != 2:
        fail("Need one PDF or image path.")
    path = Path(sys.argv[1])
    if not path.is_file():
        fail("File not found.")
    if path.stat().st_size > 12 * 1024 * 1024:
        fail("File is over 12 MB.")
    try:
        doc = pymupdf.open(path)
    except Exception:
        fail("Could not open that file as a PDF or image.")
    traces = []
    warnings = []
    for index, page in enumerate(doc):
        if index >= 4:
            warnings.append("Only the first 4 pages are read.")
            break
        try:
            trace = extract_page(page)
        except Exception:
            trace = None
        if trace is None:
            warnings.append(f"Page {index + 1} had no readable curve or peak table.")
            continue
        traces.append(trace)
    if not traces:
        fail("No Variant II or Sebia trace could be read.", warnings)
    json.dump({"ok": True, "traces": traces, "warnings": warnings}, sys.stdout)


def fail(message: str, warnings: list[str] | None = None) -> None:
    json.dump({"ok": False, "error": message, "warnings": warnings or []}, sys.stdout)
    sys.exit(0)


def extract_page(page: pymupdf.Page) -> dict | None:
    embedded = page.get_text("text") or ""
    digital = "electrophoresis" in embedded.lower() or "haemoglobin" in embedded.lower()
    words = words_from_pymupdf(page) if digital else []
    text = embedded if digital else ""
    raster = None
    if not digital or not words:
        raster, words, text = raster_ocr(page)
    method = detect_method(text)
    if method is None:
        return None
    vector = vector_signal(page)
    if method == "sebia_ce":
        return extract_sebia(words, vector, raster)
    return extract_variant(words, raster, vector)


def detect_method(text: str) -> str | None:
    folded = text.lower()
    if "variant" in folded or "bthal" in folded or "β" in folded or "time (min" in folded:
        return "variant_ii"
    if "electrophoresis" in folded or "capillarys" in folded or "haemoglobin" in folded or "hemoglobin" in folded:
        return "sebia_ce"
    return None


def words_from_pymupdf(page: pymupdf.Page) -> list[dict]:
    found = []
    for item in page.get_text("words"):
        x0, y0, x1, y1, raw = item[:5]
        text = str(raw).strip()
        if text:
            found.append({"left": x0, "top": y0, "text": text, "conf": 95})
    return found


def raster_ocr(page: pymupdf.Page) -> tuple[pymupdf.Pixmap, list[dict], str]:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.3, 2.3), colorspace=pymupdf.csGRAY, alpha=False)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
        png = Path(handle.name)
    pix.save(png)
    try:
        proc = subprocess.run(
            ["tesseract", str(png), "stdout", "--psm", "6", "tsv"],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        png.unlink(missing_ok=True)
    words = []
    lines = (proc.stdout or "").splitlines()
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 12:
            continue
        text = parts[11].strip()
        if not text:
            continue
        try:
            conf = float(parts[10])
        except ValueError:
            conf = -1
        words.append(
            {
                "left": float(parts[6]),
                "top": float(parts[7]),
                "text": text,
                "conf": conf,
            }
        )
    text = " ".join(word["text"] for word in words)
    return pix, words, text


def extract_variant(words: list[dict], raster: pymupdf.Pixmap | None, vector: tuple[list[float], list[float]] | None) -> dict | None:
    peaks = variant_peaks(words)
    curve, start, end = (None, 0.0, 6.0)
    if raster is not None:
        box = variant_plot_box(words, raster.width, raster.height)
        if box is not None:
            curve = trace_raster(raster, box)
            start, end = 0.0, box["axis_end"]
    if curve is None and vector is not None:
        curve = resample(vector[0], vector[1], min(vector[0]), max(vector[0]), 0.0, 6.0)
        start, end = 0.0, 6.0
    axis_end = end if end > start else 6.0
    if curve is not None and not curve_matches_main_peak(curve, start, axis_end, peaks):
        curve = None
    if curve is None and len(peaks) < 2:
        return None
    return {
        "method": "variant_ii",
        "axisStart": start,
        "axisEnd": axis_end,
        "peaks": peaks,
        "curve": curve,
    }


def extract_sebia(
    words: list[dict],
    vector: tuple[list[float], list[float]] | None,
    raster: pymupdf.Pixmap | None,
) -> dict | None:
    fractions = sebia_fractions(words)
    curve = None
    start, end = 0.0, 300.0
    positions: list[tuple[float, str, float]] = []
    if vector is not None:
        axis = sebia_axis(words)
        if axis is not None:
            start, end, x0, x1 = axis
            xs, ys = vector
            signal_x, signal_y = densify(xs, ys)
            curve = resample(signal_x, signal_y, x0, x1, start, end)
            label_peaks = sebia_labels(words, signal_x, signal_y, x0, x1, start, end, fractions)
            if label_peaks:
                positions = label_peaks
    if curve is None and raster is not None:
        box = sebia_plot_box(words, raster.width, raster.height)
        if box is not None:
            curve = trace_raster(raster, box)
            start, end = box["axis_start"], box["axis_end"]
    if not positions and fractions and curve is not None:
        positions = assign_apexes(curve, start, end, fractions)
    if not positions and fractions:
        slots = {"A": 140.0, "A2": 250.0, "H": 40.0, "fraction": 210.0}
        positions = [(slots.get(name, 180.0 + index * 12), name, percent) for index, (name, percent) in enumerate(fractions)]
    peaks = [{"name": name, "position": round(pos, 2), "percent": round(percent, 2)} for pos, name, percent in positions if percent > 0]
    if curve is None and len(peaks) < 2:
        return None
    return {
        "method": "sebia_ce",
        "axisStart": start,
        "axisEnd": end if end > start else 300.0,
        "peaks": [peak for peak in peaks if peak["position"] > 0 or peak["name"] in {"A", "A2", "H"}],
        "curve": curve,
    }


def variant_peaks(words: list[dict]) -> list[dict]:
    total = total_area(words)
    names = []
    times = []
    areas = []
    for word in words:
        token = word["text"].strip()
        folded = token.lower().replace(" ", "")
        if NAME_RE.match(folded) and word["conf"] >= 30:
            names.append({"top": word["top"], "left": word["left"], "value": canonical_name(folded)})
            continue
        if re.fullmatch(r"\d\.\d{2}", token):
            value = float(token)
            if 0.3 <= value <= 8.5:
                times.append({"top": word["top"], "left": word["left"], "value": value})
            continue
        digits = token.replace(",", "")
        if re.fullmatch(r"\d{3,8}", digits):
            value = int(digits)
            if 400 <= value <= 5_000_000 and value != total:
                areas.append({"top": word["top"], "left": word["left"], "value": value})
    area_col = tallest_column(areas, 40)
    time_col = tallest_column(times, 40)
    if len(area_col) < 4 or total is None or total <= 0:
        return []
    area_col.sort(key=lambda item: item["top"])
    y0, y1 = area_col[0]["top"] - 18, area_col[-1]["top"] + 18
    name_rows = [item for item in names if y0 <= item["top"] <= y1]
    time_rows = [item for item in time_col if y0 <= item["top"] <= y1] or [item for item in times if y0 <= item["top"] <= y1]
    name_rows.sort(key=lambda item: item["top"])
    time_rows.sort(key=lambda item: item["top"])
    used_names: set[int] = set()
    used_times: set[int] = set()
    rows = []
    for area in area_col:
        rows.append(
            {
                "top": area["top"],
                "name": take_nearest(name_rows, area["top"], used_names, 24) or "Unknown",
                "time": take_nearest(time_rows, area["top"], used_times, 22),
                "percent": area["value"] / total * 100,
            }
        )
    known = sorted((row["top"], row["time"]) for row in rows if row["time"] is not None)
    peaks = []
    for row in rows:
        when = row["time"] if row["time"] is not None else interpolate_time(known, row["top"])
        if when is None or row["percent"] <= 0 or row["percent"] > 100:
            continue
        peaks.append({"name": row["name"], "position": round(when, 2), "percent": round(row["percent"], 2)})
    return peaks


def interpolate_time(known: list[tuple[float, float]], top: float) -> float | None:
    if len(known) < 2:
        return None
    if top <= known[0][0] or top >= known[-1][0]:
        return None
    for (y0, t0), (y1, t1) in zip(known, known[1:]):
        if y0 <= top <= y1 and y1 > y0:
            weight = (top - y0) / (y1 - y0)
            return t0 + weight * (t1 - t0)
    return None


def tallest_column(points: list[dict], tolerance: float) -> list[dict]:
    if not points:
        return []
    ordered = sorted(points, key=lambda item: item["left"])
    clusters: list[list[dict]] = [[ordered[0]]]
    for item in ordered[1:]:
        if abs(item["left"] - clusters[-1][-1]["left"]) <= tolerance:
            clusters[-1].append(item)
        else:
            clusters.append([item])
    return max(clusters, key=len)


def take_nearest(points: list[dict], top: float, used: set[int], tolerance: float):
    best = None
    best_distance = tolerance
    for index, item in enumerate(points):
        if index in used:
            continue
        distance = abs(item["top"] - top)
        if distance <= best_distance:
            best_distance = distance
            best = index
    if best is None:
        return None
    used.add(best)
    return points[best]["value"]


def total_area(words: list[dict]) -> int | None:
    for index, word in enumerate(words):
        if word["text"].lower() == "total":
            window = words[index : index + 6]
            for item in window:
                digits = item["text"].replace(",", "")
                if re.fullmatch(r"\d{5,9}", digits):
                    return int(digits)
    return None


def nearest(points: list[tuple[float, float]], top: float, used: set[int], tolerance: float) -> float | None:
    best = None
    best_distance = tolerance
    for index, (y, value) in enumerate(points):
        if index in used:
            continue
        distance = abs(y - top)
        if distance <= best_distance:
            best_distance = distance
            best = index
    if best is None:
        return None
    used.add(best)
    return points[best][1]


def canonical_name(token: str) -> str:
    if token in {"fe", "f"}:
        return "F"
    if token in {"ao", "a0", "aa"}:
        return "A0"
    if token in {"b3", "p3"}:
        return "P3"
    if token == "p2":
        return "P2"
    if token == "a2":
        return "A2"
    if token == "unknown":
        return "Unknown"
    if token in {"hba", "hb"}:
        return "A"
    return token.upper()


def sebia_fractions(words: list[dict]) -> list[tuple[str, float]]:
    lines = group_lines(words, 8)
    found: list[tuple[str, float]] = []
    for line in lines:
        text = " ".join(word["text"] for word in line)
        folded = text.lower().replace(" ", "")
        percents = [float(word["text"]) for word in line if re.fullmatch(r"\d+\.\d+", word["text"]) and float(word["text"]) <= 100]
        if "hba2" in folded or re.search(r"hb\s*a2", text, re.I):
            value = first_percent(line, percents, a2=True)
            if value is not None:
                found.append(("A2", value))
            continue
        if re.search(r"hb\s*a\b", text, re.I) or folded.startswith("hba"):
            value = first_percent(line, percents, a2=False)
            if value is not None:
                found.append(("A", value))
            continue
        indexes = [word for word in line if re.fullmatch(r"\d{1,2}", word["text"]) and 1 <= int(word["text"]) <= 15]
        if indexes and percents and not re.search(r"normal|value|zone", text, re.I):
            found.append((f"fraction", percents[0]))
    # Prefer named Hb A / A2 when both styles exist. Numbered fractions are the printout's own index.
    named = [(name, value) for name, value in found if name in {"A", "A2"}]
    numbered = [(name, value) for name, value in found if name == "fraction"]
    if len(numbered) >= 2 and not named:
        return numbered
    if named and not numbered:
        return named
    if numbered and named:
        # Numbered rows are the integration list. Named rows repeat Hb A / A2.
        return numbered if len(numbered) >= len(named) else named
    return named or numbered


def first_percent(line: list[dict], percents: list[float], a2: bool) -> float | None:
    if percents:
        return percents[0]
    for word in line:
        if re.fullmatch(r"\d{2,3}", word["text"]):
            value = int(word["text"])
            repaired = value / 10
            if a2 and 0.5 <= repaired <= 10:
                return repaired
            if not a2 and 40 <= repaired <= 99:
                return repaired
    return None


def group_lines(words: list[dict], tolerance: float) -> list[list[dict]]:
    ordered = sorted(words, key=lambda word: (word["top"], word["left"]))
    lines: list[list[dict]] = []
    for word in ordered:
        if lines and abs(word["top"] - lines[-1][0]["top"]) <= tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    for line in lines:
        line.sort(key=lambda word: word["left"])
    return lines


def sebia_axis(words: list[dict]) -> tuple[float, float, float, float] | None:
    ticks = []
    for word in words:
        if re.fullmatch(r"\d{1,3}", word["text"]):
            value = int(word["text"])
            if value % 20 == 0 and 0 <= value <= 300:
                ticks.append((value, word["left"], word["top"]))
    if len(ticks) < 4:
        return None
    # Axis labels share a row.
    rows: dict[int, list[tuple[int, float, float]]] = {}
    for value, left, top in ticks:
        key = int(round(top / 8) * 8)
        rows.setdefault(key, []).append((value, left, top))
    row = max(rows.values(), key=len)
    if len(row) < 4:
        return None
    row.sort()
    start = float(row[0][0])
    end = float(row[-1][0])
    if end <= start:
        return None
    return start, end, row[0][1], row[-1][1]


def curve_matches_main_peak(curve: list[float], start: float, end: float, peaks: list[dict]) -> bool:
    if not peaks or not curve or end <= start:
        return True
    main = max(peaks, key=lambda peak: peak["percent"])
    index = max(range(len(curve)), key=lambda item: curve[item])
    position = start + (index + 0.5) / len(curve) * (end - start)
    return abs(position - main["position"]) <= 0.55


def sebia_labels(words, xs, ys, x0, x1, start, end, fractions) -> list[tuple[float, str, float]]:
    axis_top = None
    ticks = [word for word in words if re.fullmatch(r"\d{1,3}", word["text"]) and int(word["text"]) % 20 == 0]
    if ticks:
        axis_top = statistics.median(word["top"] for word in ticks)
    labels = []
    for word in words:
        if not re.fullmatch(r"[1-9]", word["text"]):
            continue
        if axis_top is not None and word["top"] > axis_top - 8:
            continue
        if not (x0 - 5 <= word["left"] <= x1 + 15):
            continue
        labels.append((int(word["text"]), word["left"]))
    if len(labels) < 2 or len(fractions) < 2:
        return []
    # Fractions were collected in reading order, which matches 1..n for numbered tables.
    percents = [value for _name, value in fractions]
    if len(percents) < len(labels):
        return []
    peaks = []
    for number, left in labels:
        if number - 1 >= len(percents):
            continue
        nearest_x = local_peak_x(xs, ys, left)
        position = start + (nearest_x - x0) / (x1 - x0) * (end - start)
        name = "A" if percents[number - 1] == max(percents) else "peak"
        if number <= len(fractions) and fractions[number - 1][0] in {"A", "A2"}:
            name = fractions[number - 1][0]
        peaks.append((position, name, percents[number - 1]))
    return peaks


def local_peak_x(xs: list[float], ys: list[float], label_x: float, radius: float = 22) -> float:
    window = [(x, y) for x, y in zip(xs, ys) if abs(x - label_x) <= radius]
    if not window:
        return label_x
    return max(window, key=lambda item: item[1])[0]


def apex_xs(xs: list[float], ys: list[float]) -> list[float]:
    if len(ys) < 5:
        return []
    found = []
    for index in range(2, len(ys) - 2):
        if ys[index] >= max(ys[index - 2 : index + 3]) and ys[index] > max(ys) * 0.04:
            if found and abs(xs[index] - found[-1]) < 6:
                if ys[index] > ys[xs.index(found[-1])] if found[-1] in xs else 0:
                    found[-1] = xs[index]
            else:
                found.append(xs[index])
    return found


def assign_apexes(curve: list[float], start: float, end: float, fractions: list[tuple[str, float]]) -> list[tuple[float, str, float]]:
    peaks = []
    limit = max(curve) if curve else 0
    for index in range(2, len(curve) - 2):
        if curve[index] >= max(curve[index - 2 : index + 3]) and curve[index] > limit * 0.05:
            position = start + (index + 0.5) / len(curve) * (end - start)
            peaks.append((curve[index], position))
    deduped = []
    for height, position in peaks:
        if deduped and abs(position - deduped[-1][1]) < (end - start) * 0.03:
            if height > deduped[-1][0]:
                deduped[-1] = (height, position)
        else:
            deduped.append((height, position))
    deduped.sort(reverse=True)
    fractions_sorted = sorted(fractions, key=lambda item: item[1], reverse=True)
    assigned = []
    for (height, position), (name, percent) in zip(deduped, fractions_sorted):
        assigned.append((position, "A" if name == "fraction" and percent == fractions_sorted[0][1] else name, percent))
    if assigned:
        return assigned
    # No apexes: park named fractions on a conventional axis so the table can still be searched.
    slots = {"A": 140.0, "A2": 250.0, "H": 40.0, "fraction": 200.0}
    return [(slots.get(name, 180.0), name, percent) for name, percent in fractions]


def variant_plot_box(words: list[dict], width: int, height: int) -> dict | None:
    digits = []
    for word in words:
        if re.fullmatch(r"[0-6]", word["text"]):
            digits.append(word)
    rows: dict[int, list[dict]] = {}
    for word in digits:
        key = int(round(word["top"] / 12) * 12)
        rows.setdefault(key, []).append(word)
    axis = None
    for row in rows.values():
        values = sorted({int(word["text"]) for word in row})
        if len(values) >= 5 and values[0] == 0:
            axis = row
            break
    if axis is None:
        return None
    axis.sort(key=lambda word: int(word["text"]))
    left = min(word["left"] for word in axis if word["text"] == "0")
    right = max(word["left"] for word in axis if word["text"] == max(word["text"] for word in axis))
    bottom = min(word["top"] for word in axis) - 6
    y_labels = [word for word in words if re.fullmatch(r"\d{1,2}\.\d", word["text"]) and word["left"] < left]
    top = min((word["top"] for word in y_labels), default=bottom - (right - left) * 0.45)
    if right - left < 80 or bottom - top < 40:
        return None
    end_label = max(int(word["text"]) for word in axis)
    return {
        "left": int(max(0, left)),
        "right": int(min(width - 1, right)),
        "top": int(max(0, top)),
        "bottom": int(min(height - 1, bottom)),
        "axis_start": 0.0,
        "axis_end": float(end_label) if end_label >= 5 else 6.0,
    }


def sebia_plot_box(words: list[dict], width: int, height: int) -> dict | None:
    axis = sebia_axis(words)
    if axis is None:
        return None
    start, end, x0, x1 = axis
    tops = [word["top"] for word in words if re.fullmatch(r"\d{1,3}", word["text"]) and int(word["text"]) % 20 == 0 and x0 - 5 <= word["left"] <= x1 + 5]
    if not tops:
        return None
    bottom = min(tops) - 4
    top = bottom - (x1 - x0) * 0.55
    return {
        "left": int(max(0, x0)),
        "right": int(min(width - 1, x1)),
        "top": int(max(0, top)),
        "bottom": int(min(height - 1, bottom)),
        "axis_start": start,
        "axis_end": end,
    }


def vector_signal(page: pymupdf.Page) -> tuple[list[float], list[float]] | None:
    groups: dict[tuple, list[tuple[float, float]]] = {}
    for drawing in page.get_drawings():
        color = drawing.get("color") or (0, 0, 0)
        key = tuple(round(channel, 2) for channel in color[:3])
        for item in drawing.get("items") or []:
            if item[0] != "l":
                continue
            p1, p2 = item[1], item[2]
            groups.setdefault(key, []).append((p1.x, p1.y, p2.x, p2.y))
    best = None
    for segs in groups.values():
        if len(segs) < 200:
            continue
        xs = [value for seg in segs for value in (seg[0], seg[2])]
        span = max(xs) - min(xs)
        if span < 120:
            continue
        if best is None or len(segs) > len(best):
            best = segs
    if best is None:
        return None
    bins: dict[float, list[float]] = {}
    for x1, y1, x2, y2 in best:
        for x, y in ((x1, y1), (x2, y2)):
            bins.setdefault(round(x, 1), []).append(y)
    xs = sorted(bins)
    raw = [statistics.median(bins[x]) for x in xs]
    baseline = statistics.median(raw)
    up = [max(0.0, baseline - value) for value in raw]
    down = [max(0.0, value - baseline) for value in raw]
    signal = up if peakiness(up) >= peakiness(down) else down
    return xs, signal


def densify(xs: list[float], ys: list[float]) -> tuple[list[float], list[float]]:
    return xs, ys


def peakiness(values: list[float]) -> float:
    peak = max(values) if values else 0
    mean = sum(values) / len(values) if values else 1
    return peak / (mean + 1e-6)


def trace_raster(pix: pymupdf.Pixmap, box: dict) -> list[float] | None:
    width, channels = pix.width, pix.n
    data = pix.samples
    left, right = box["left"], box["right"]
    top, bottom = box["top"], box["bottom"]
    if right - left < 40 or bottom - top < 30:
        return None

    def luminance(x: int, y: int) -> int:
        return data[(y * width + x) * channels]

    dark_rows = []
    for y in range(top, bottom):
        dark = sum(1 for x in range(left, right, 2) if luminance(x, y) < 80)
        dark_rows.append(dark)
    span = bottom - top
    head = max(range(0, max(1, int(span * 0.22))), key=lambda index: dark_rows[index], default=0)
    tail = max(range(int(span * 0.7), span), key=lambda index: dark_rows[index], default=span - 1)
    y0 = top + head + 3
    y1 = top + tail - 2
    if y1 - y0 < 30:
        return None
    xs = list(range(left + 2, right - 2))
    ys = list(range(y0, y1))
    if not xs or not ys:
        return None
    step = 8
    prev = [luminance(xs[0], y) for y in ys]
    back: list[list[int]] = []
    for x in xs[1:]:
        current = [0] * len(ys)
        choice = [0] * len(ys)
        for index in range(len(ys)):
            lo = max(0, index - step)
            hi = min(len(ys), index + step + 1)
            best_cost = 10**9
            best_index = lo
            ink = luminance(x, ys[index])
            for previous in range(lo, hi):
                cost = prev[previous] + abs(index - previous) * 3
                if cost < best_cost:
                    best_cost = cost
                    best_index = previous
            current[index] = ink + best_cost
            choice[index] = best_index
        back.append(choice)
        prev = current
    end_index = min(range(len(ys)), key=lambda index: prev[index])
    path = [end_index]
    for choice in reversed(back):
        end_index = choice[end_index]
        path.append(end_index)
    path.reverse()
    heights = [float(y1 - ys[index]) for index in path]
    if max(heights) < 8:
        return None
    return resample(xs, heights, xs[0], xs[-1], box["axis_start"], box["axis_end"])


def interpolate(values: list[float | None]) -> list[float] | None:
    if sum(value is not None for value in values) < len(values) * 0.4:
        return None
    out = list(values)
    last = None
    for index, value in enumerate(out):
        if value is not None:
            if last is not None and index - last > 1:
                left = out[last]
                gap = index - last
                for step in range(1, gap):
                    out[last + step] = left + (value - left) * step / gap
            last = index
    first = next(index for index, value in enumerate(out) if value is not None)
    last_known = max(index for index, value in enumerate(out) if value is not None)
    for index in range(first):
        out[index] = out[first]
    for index in range(last_known + 1, len(out)):
        out[index] = out[last_known]
    return [float(value or 0) for value in out]


def resample(xs: list[float], ys: list[float], x0: float, x1: float, start: float, end: float) -> list[float] | None:
    if x1 <= x0 or len(xs) < 10:
        return None
    sampled = []
    for index in range(CURVE_N):
        x = x0 + (x1 - x0) * (index + 0.5) / CURVE_N
        sampled.append(interp(xs, ys, x))
    floor = sorted(sampled)[max(0, int(len(sampled) * 0.12) - 1)]
    shifted = [max(0.0, value - floor) for value in sampled]
    # Light 3-point smooth to drop grid specks.
    smooth = []
    for index, value in enumerate(shifted):
        window = shifted[max(0, index - 1) : index + 2]
        smooth.append(sum(window) / len(window))
    peak = max(smooth) or 1
    if peak < 1e-3:
        return None
    return [round(value / peak, 4) for value in smooth]


def interp(xs: list[float], ys: list[float], x: float) -> float:
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= x:
            lo = mid
        else:
            hi = mid
    span = xs[hi] - xs[lo] or 1
    weight = (x - xs[lo]) / span
    return ys[lo] * (1 - weight) + ys[hi] * weight


if __name__ == "__main__":
    main()
