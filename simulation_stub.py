"""SIMULATION_STUB — synthetic ON/OFF curves for the playground UI.

Swap this module for the real ODE solver. The FastAPI route should keep
calling `simulate(payload)` and returning the dict unchanged.

Do not put UI here. Equations are not finalized; curves are placeholders
so every view, plot, export and interaction can be wired end to end.
"""

from __future__ import annotations

import math
from typing import Any

# SIMULATION_STUB
STUB_MARKER = "SIMULATION_STUB"

_DELIVERY = {"lipoplex", "lnp", "polyplex", "naked"}
_SYSTEM = {"plasmid", "mrna"}
_LOGIC = {"single", "and"}

_DELIVERY_SCALE = {
    "lipoplex": 1.0,
    "lnp": 1.15,
    "polyplex": 0.85,
    "naked": 0.22,
}

_VALID = {
    "delivery": _DELIVERY,
    "system": _SYSTEM,
    "logic": _LOGIC,
}


def _linspace(t0: float, t1: float, n: int) -> list[float]:
    if n < 2:
        return [float(t0)]
    step = (t1 - t0) / (n - 1)
    return [t0 + i * step for i in range(n)]


def _sigmoid(t: float, t_half: float, steep: float, ymax: float, ymin: float = 0.0) -> float:
    return ymin + (ymax - ymin) / (1.0 + math.exp(-steep * (t - t_half)))


def _t_half(system: str, t1: float) -> float:
    # Plasmid waits on nuclear import + transcription; mRNA rises sooner.
    if system == "plasmid":
        return min(22.0, 0.35 * t1)
    return min(12.0, 0.22 * t1)


def simulate(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a SimulateResponse. Replace the body of this function later."""
    delivery = str(payload.get("delivery") or "")
    system = str(payload.get("system") or "")
    logic = str(payload.get("logic") or "")
    for key, allowed in _VALID.items():
        value = str(payload.get(key) or "")
        if value not in allowed:
            raise ValueError(f"{key} must be one of {sorted(allowed)}.")

    span = payload.get("tSpan") or {}
    t0 = float(span.get("t0", 0.0))
    t1 = float(span.get("t1", 72.0))
    n = int(span.get("n", 145))
    t = _linspace(t0, t1, n)

    scale = _DELIVERY_SCALE.get(delivery, 1.0)
    if logic == "and":
        scale *= 0.72

    t_half = _t_half(system, t1)
    peak = 1.0 * scale
    leak_amp = 0.045 * scale
    on_curve = [_sigmoid(x, t_half, 0.28, peak, ymin=0.01 * scale) for x in t]
    off_curve = [_sigmoid(x, t_half + 6.0, 0.18, leak_amp, ymin=0.008 * scale) for x in t]

    peak_on = max(on_curve)
    peak_off = max(off_curve)
    half = peak_on / 2.0
    t_half_obs = t[-1]
    for time, value in zip(t, on_curve):
        if value >= half:
            t_half_obs = time
            break

    fold = peak_on / max(peak_off, 1e-9)
    leak = peak_off / max(peak_on, 1e-9)

    states: dict[str, list[float]] = {
        "output_on": on_curve,
        "output_off": off_curve,
        "cargo_extra": [max(0.0, math.exp(-0.08 * x)) for x in t],
        "endosome": [_sigmoid(x, 4.0, 0.6, 0.35 * scale) * math.exp(-0.04 * max(0.0, x - 8.0)) for x in t],
        "sensor_rna": [_sigmoid(x, t_half - 4.0, 0.3, 0.8 * scale) for x in t],
    }
    if system == "plasmid":
        states["cytosol_dna"] = [_sigmoid(x, 6.0, 0.4, 0.5 * scale) * math.exp(-0.02 * x) for x in t]
        states["nucleus"] = [_sigmoid(x, 12.0, 0.35, 0.4 * scale) for x in t]

    response: dict[str, Any] = {
        "t": t,
        "states": states,
        "observables": {
            "foldChange": round(fold, 4),
            "leak": round(leak, 4),
            "tHalf": round(t_half_obs, 3),
            "peakOutput": round(peak_on, 4),
        },
        "stub": True,
        "marker": STUB_MARKER,
    }

    if logic == "and":
        low = peak_off
        mid = peak_off + 0.12 * (peak_on - peak_off)
        response["truthTable"] = [
            {"inputs": "00", "output": round(low, 4)},
            {"inputs": "01", "output": round(mid, 4)},
            {"inputs": "10", "output": round(mid, 4)},
            {"inputs": "11", "output": round(peak_on, 4)},
        ]

    return response
