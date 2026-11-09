# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/field/stats.ts,
# src/core/field/colormap.ts (jet and its caps)
#
# What any per-vertex field on the scan needs, deviation and wall thickness
# alike: its statistics over the readings that count, percentiles from a
# strided sample, scale ends a person would have picked, and the jet ramp
# the map is painted with. Pure numpy.

import math

import numpy as np


def field_stats(values, valid_min, valid_max):
    """measured, total, min, max, mean, rms (about zero), sigma (about the
    mean) over the readings inside [valid_min, valid_max]; NaN never counts."""
    v = np.asarray(values, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        ok = (v >= valid_min) & (v <= valid_max)
    m = v[ok]
    n = int(len(m))
    if n == 0:
        return {"measured": 0, "total": int(len(v)), "min": 0.0, "max": 0.0, "mean": 0.0, "rms": 0.0, "sigma": 0.0}
    mean = float(m.mean())
    sq = float((m * m).sum()) / n
    return {
        "measured": n,
        "total": int(len(v)),
        "min": float(m.min()),
        "max": float(m.max()),
        "mean": mean,
        "rms": math.sqrt(sq),
        "sigma": math.sqrt(max(0.0, sq - mean * mean)),
    }


def field_percentiles(values, valid_min, valid_max, fractions, magnitude=False):
    """Percentiles from a strided sample: stable, not exact."""
    v = np.asarray(values, dtype=np.float64)
    stride = max(1, len(v) // 200_000)
    s = v[::stride]
    with np.errstate(invalid="ignore"):
        s = s[(s >= valid_min) & (s <= valid_max)]
    if len(s) == 0:
        return [math.nan for _ in fractions]
    if magnitude:
        s = np.abs(s)
    s = np.sort(s)
    return [float(s[min(len(s) - 1, max(0, int(math.floor(len(s) * f))))]) for f in fractions]


NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]


def _by_decade(step, exp):
    v = step * 10.0**exp if exp >= 0 else step / 10.0 ** (-exp)
    return round(v, min(max(0, 1 - exp), 100))


def nice_ceil(x):
    """Round up to a value a person would have chosen for the end of a scale."""
    if not (x > 0):
        return 0.1
    exp = math.floor(math.log10(x))
    m = x / 10.0**exp
    for step in NICE_STEPS:
        if m <= step + 1e-9:
            return _by_decade(step, exp)
    return _by_decade(10, exp)


def nice_floor(x):
    if not (x > 0):
        return 0
    exp = math.floor(math.log10(x))
    m = x / 10.0**exp
    for step in reversed(NICE_STEPS):
        if m >= step - 1e-9:
            return _by_decade(step, exp)
    return _by_decade(1, exp)


# Jet pinned so the middle of the scale is a saturated green.
JET = np.array([[0, 0, 255], [0, 255, 255], [0, 200, 0], [255, 255, 0], [255, 0, 0]], dtype=float)
JET_UNDER = (0, 0, 110)
JET_OVER = (130, 0, 0)
UNMEASURED_RGB = (126, 131, 138)


def ramp(t):
    t = np.clip(np.asarray(t, dtype=float), 0, 1)
    last = len(JET) - 1
    u = t * last
    i = np.minimum(last - 1, np.floor(u)).astype(int)
    f = (u - i)[..., None]
    return np.round(JET[i] + (JET[i + 1] - JET[i]) * f).astype(np.uint8)


def quantize(t, bands):
    if not bands or bands < 2:
        return t
    u = np.clip(t, 0, 1)
    return (np.minimum(bands - 1, np.floor(u * bands)) + 0.5) / bands


def paint(values, low, high, valid_min, valid_max, bands=None, reversed_=False):
    """RGB per reading: the ramp inside the scale, the dark caps past either
    end, grey where there is no measurement. A reversed scale (thickness)
    puts the hot end at the low readings."""
    v = np.asarray(values, dtype=float)
    out = np.empty((len(v), 3), dtype=np.uint8)
    with np.errstate(invalid="ignore"):
        valid = (v >= valid_min) & (v <= valid_max)
        hi_cap = valid & (v > high)
        lo_cap = valid & (v < low)
    mid = valid & ~hi_cap & ~lo_cap
    span = high - low
    t = (v[mid] - low) / span if span > 0 else np.zeros(int(mid.sum()))
    if reversed_:
        t = 1 - t
    t = quantize(t, bands)
    out[mid] = ramp(t)
    out[~valid] = UNMEASURED_RGB
    out[hi_cap] = JET_UNDER if reversed_ else JET_OVER
    out[lo_cap] = JET_OVER if reversed_ else JET_UNDER
    return out
