"""RADAR (ADAR-sensor) activation model.

Payload output of an ADAR RNA sensor is a saturating, thresholded function of
target-transcript abundance in the individual cell. We model it with a Hill
function (see docs/RACS_framework.md, section 2):

    a(x; K, n, L) = L + (1 - L) * x^n / (K^n + x^n)

``x`` is in *linear* normalized abundance units (CP10k by default). ``K`` is the
half-activation abundance (the activation threshold), ``n`` the steepness, ``L``
the basal leak.

IMPORTANT — calibration status: the numeric values in ``DEFAULT_HILL`` are
documented PLACEHOLDERS in CP10k units. They must be fit from the published
RADAR/RADARS dose-response before any activation-dependent number is treated as
final. Everything downstream that consumes these is flagged in ROADMAP.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class HillParams:
    """Parameters of the RADAR activation curve, plus the tunable-threshold band.

    Attributes
    ----------
    K : half-activation abundance (CP10k). Nominal operating threshold.
    n : Hill coefficient (steepness).
    L : basal leak in [0, 1).
    K_lo, K_hi : reachable band for the threshold. The sensor designer can tune
        the effective threshold within [K_lo, K_hi]; targets whose ROC-optimal
        threshold falls outside this band are forced to the nearer band edge.
    """

    # Calibrated against the published ADAR-sensor activation range rather than guessed.
    # CellREADR reports that cellular RNAs expressed at ~10-50 TPM are sufficient to
    # trigger sensing and payload translation; engineered RADARS have been demonstrated
    # on endogenous transcripts down to ~13 TPM.
    #   Kaseniit et al., Nat Biotechnol 2023 (RADARS)      doi:10.1038/s41587-022-01493-x
    #   CellREADR, bioRxiv 2024                            doi:10.1101/2024.11.26.625312
    # Units here are CP10k, and TPM = CP10k x 100, so 10-50 TPM = 0.1-0.5 CP10k.
    # NOTE: the previous placeholders (K=5.0, band 1.0-50.0 CP10k = 500-5000 TPM) were
    # 10-100x stricter than anything the literature requires, which systematically
    # understated Feas and therefore RACS. Re-score cohorts to propagate this.
    K: float = 0.3        # ~30 TPM, middle of the reported activation range
    n: float = 2.0
    L: float = 0.02
    K_lo: float = 0.1     # ~10 TPM, the easiest reported trigger point
    K_hi: float = 0.5     # ~50 TPM, the conservative end of the range

    def __post_init__(self) -> None:
        if not (0.0 <= self.L < 1.0):
            raise ValueError("leak L must be in [0, 1)")
        if self.K <= 0 or self.n <= 0:
            raise ValueError("K and n must be positive")
        if not (0 < self.K_lo <= self.K_hi):
            raise ValueError("require 0 < K_lo <= K_hi")


# Documented PLACEHOLDER — see module docstring and ROADMAP.md ("calibrate Hill").
DEFAULT_HILL = HillParams()


def hill_activation(x, params: HillParams = DEFAULT_HILL, K: float | None = None):
    """RADAR activation probability a(x) for abundance ``x``.

    Parameters
    ----------
    x : array-like or float
        Linear normalized abundance (CP10k). Negative values are clipped to 0.
    params : HillParams
        Curve parameters. ``n`` and ``L`` are taken from here.
    K : float, optional
        Override the threshold (used when operating at a reachable-band edge or
        at the ROC-optimal threshold). Defaults to ``params.K``.

    Returns
    -------
    ndarray or float in [L, 1).
    """
    x = np.asarray(x, dtype=float)
    x = np.clip(x, 0.0, None)
    k = params.K if K is None else float(K)
    xn = np.power(x, params.n)
    kn = k**params.n
    frac = np.divide(xn, kn + xn, out=np.zeros_like(x, dtype=float), where=(kn + xn) > 0)
    return params.L + (1.0 - params.L) * frac


def reachable_band(params: HillParams = DEFAULT_HILL) -> tuple[float, float]:
    """Return (K_lo, K_hi), the physically reachable threshold band."""
    return (params.K_lo, params.K_hi)


def clamp_threshold(k_star: float, params: HillParams = DEFAULT_HILL) -> float:
    """Project a desired threshold onto the reachable band [K_lo, K_hi]."""
    return float(np.clip(k_star, params.K_lo, params.K_hi))
