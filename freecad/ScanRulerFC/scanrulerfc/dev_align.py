# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/icp.ts,
# src/core/deviation/align.ts, src/core/deviation/deviation.ts (scanNormalsSign)
#
# Point-to-plane ICP pulling a thinned sample of the scan onto the reference,
# and the three best fits built on it: automatic (the identity and the 24
# principal-axis attitudes screened, wound both ways, the best few run on,
# the winner refined), from picked pairs (Horn's closed form, then ICP), and
# local (the fit in hand refined on marked surface only, gated so a patch
# cannot snap onto a neighbouring feature). Poses are compared on a capped
# mean over every sample, so a fit cannot score better by letting go of the
# part. The arithmetic is ScanRuler's; each pass pairs every sample at once
# through numpy instead of one at a time.

import math

import numpy as np

from . import dev_rigid as R


class AlignError(Exception):
    pass


# ---- samples ----


def sample_scan(positions, normals, wanted, seed=0x5EED):
    """An evenly thinned sample: a deterministic stride with a random phase,
    so repeat runs on the same scan give the same answer."""
    positions = np.asarray(positions, dtype=float).reshape(-1, 3)
    total = len(positions)
    count = min(int(wanted), total)
    if count <= 0:
        return {"xyz": np.zeros((0, 3)), "normals": None, "count": 0}
    stride = total / count
    phase = R.mulberry32(seed)()
    v = np.minimum(total - 1, np.floor((np.arange(count) + phase) * stride).astype(np.int64))
    return {"xyz": positions[v].copy(), "normals": None if normals is None else np.asarray(normals, dtype=float)[v].copy(), "count": count}


def _thinned(s, every):
    return {"xyz": s["xyz"][::every], "normals": None if s["normals"] is None else s["normals"][::every], "count": len(s["xyz"][::every])}


def _flipped(s):
    return s if s["normals"] is None else {**s, "normals": -s["normals"]}


# ---- pairing ----


def pair_all(surface, samples, transform, max_pair, facing_search, min_dot, score_cap):
    """Every sample paired with the reference under `transform`: the sample
    in the reference frame, its closest point and pseudonormal there, the
    distance, what it adds to the pose score, and whether it may drive the
    step."""
    xyz = samples["xyz"]
    n = len(xyz)
    q = transform.apply(xyz)
    sn = transform.rotate(samples["normals"]) if samples["normals"] is not None else None
    hit = surface.closest(q, max_pair)
    paired = hit.found.copy()
    cp, cn, dist = hit.point, hit.normal, hit.distance
    if facing_search and sn is not None:
        # Nearest surface first; only a sample whose nearest surface faces
        # back at it pays for the facing-aware search.
        redo = paired & (np.einsum("ij,ij->i", sn, cn) < min_dot)
        if redo.any():
            idx = np.nonzero(redo)[0]
            h2 = surface.closest(q[idx], max_pair, facing=sn[idx], min_dot=min_dot)
            paired[idx] = h2.found
            cp[idx], cn[idx], dist[idx] = h2.point, h2.normal, h2.distance
    score = np.full(n, float(score_cap))
    ok = paired & ~(dist > max_pair)
    if sn is not None:
        ok &= ~(np.einsum("ij,ij->i", sn, cn) < min_dot)
    score[ok] = np.minimum(dist[ok], score_cap)
    return q, cp, cn, dist, score, ok


# ---- ICP ----


def icp(surface, samples, initial, max_iterations=60, reject_median_factor=3.0, min_normal_dot=0.0, facing_search=False, max_pair_distance=math.inf, score_cap=None, tolerance=None, on_iteration=None):
    """Point-to-plane ICP fitting samples (scan frame) onto surface
    (reference frame) from `initial`. The increment is taken about the
    correspondences' centroid, so the 6x6 solve stays well conditioned for a
    part far from the origin."""
    facing_search = facing_search is True and samples["normals"] is not None and min_normal_dot > 0 and math.isfinite(max_pair_distance)
    diag = surface.bbox_diagonal
    tolerance = diag * 1e-7 if tolerance is None else tolerance
    score_cap = diag * 0.05 if score_cap is None else score_cap

    transform = initial.copy()
    best = initial.copy()
    best_score = math.inf
    best_rms = math.inf
    best_mean = math.inf
    best_matched = 0
    iterations = 0
    converged = False
    n = samples["count"]

    for it in range(max_iterations):
        iterations = it + 1
        q, cp, cn, dist, pscore, ok = pair_all(surface, samples, transform, max_pair_distance, facing_search, min_normal_dot, score_cap)
        # Truncated mean over every sample, not just the survivors of the cut.
        score = float(pscore.sum()) / n
        found = int(ok.sum())
        if found < 3:
            break
        head = np.sort(dist[ok])
        median = head[found >> 1]
        cutoff = max(median * reject_median_factor, diag * 1e-5)
        ok = ok & ~(dist > cutoff)
        matched = int(ok.sum())
        if matched < 6:
            break
        Q, CP, CN = q[ok], cp[ok], cn[ok]
        c = Q.mean(axis=0)
        mean_distance = float(dist[ok].sum()) / matched
        r = np.einsum("ij,ij->i", Q - CP, CN)
        J = np.hstack([np.cross(Q - c, CN), CN])
        ata = J.T @ J
        atb = -(J.T @ r)
        rms = math.sqrt(float((r * r).sum()) / matched)
        if on_iteration:
            on_iteration(iterations, mean_distance, transform)
        if score < best_score:
            best_score, best_rms, best_mean, best_matched = score, rms, mean_distance, matched
            best = transform.copy()
        # A touch of Levenberg damping: a plate free to slide in its own
        # plane would otherwise answer with an arbitrary slide along it.
        lam = (np.trace(ata) / 6) * 1e-9 + 1e-12
        ata = ata + np.eye(6) * lam
        try:
            step = np.linalg.solve(ata, atb)
        except np.linalg.LinAlgError:
            break
        if not np.isfinite(step).all():
            break
        omega, tau = step[:3], step[3:]
        angle = float(np.linalg.norm(omega))
        shift = float(np.linalg.norm(tau))
        max_angle, max_shift = 0.35, diag * 0.5
        scale = min(1.0, max_angle / angle if angle > max_angle else 1.0, max_shift / shift if shift > max_shift else 1.0)
        if scale < 1:
            omega, tau = omega * scale, tau * scale
        local = R.from_twist(omega, tau)
        delta = R.Rigid(local.r, c + local.t - local.r @ c)
        transform = R.reorthonormalize(R.compose(delta, transform))
        moved = float(np.linalg.norm(omega)) * diag * 0.5 + float(np.linalg.norm(tau))
        if moved < tolerance:
            converged = True
            break

    return {
        "transform": best,
        "iterations": iterations,
        "rms": best_rms if math.isfinite(best_rms) else 0.0,
        "meanDistance": best_mean if math.isfinite(best_mean) else 0.0,
        "score": best_score,
        "matched": best_matched,
        "sampled": n,
        "converged": converged,
    }


# ---- which way the scan is wound ----


def scan_normals_sign(surface, positions, normals, transform, vertices=None, near=None):
    """1 when the scan's normals point out of the material, -1 into it: the
    sign of their agreement with the surface each lies nearest, a vote
    weighted by 1 / (1 + (d / near)^2)."""
    positions = np.asarray(positions, dtype=float).reshape(-1, 3)
    normals = np.asarray(normals, dtype=float).reshape(-1, 3)
    idx = np.arange(len(positions)) if vertices is None else np.asarray(vertices, dtype=np.int64)
    step = max(1, len(idx) // 2000)
    idx = idx[::step]
    if len(idx) == 0:
        return 1
    hit = surface.closest(transform.apply(positions[idx]))
    f = hit.found
    if not f.any():
        return 1
    d = hit.distance[f]
    agree = np.einsum("ij,ij->i", transform.rotate(normals[idx][f]), hit.normal[f])
    scale = near
    if scale is None:
        srt = np.sort(d)
        scale = max(srt[len(srt) // 5], surface.bbox_diagonal * 1e-5)
    total = float((agree / (1 + (d / scale) ** 2)).sum())
    return -1 if total < 0 else 1


def _outward(surface, samples, pose):
    if samples["normals"] is None or samples["count"] == 0:
        return samples
    return samples if scan_normals_sign(surface, samples["xyz"], samples["normals"], pose) == 1 else _flipped(samples)


# ---- the fits ----

SCREEN_ITERATIONS = 6
COARSE_ITERATIONS = 20
SHORTLIST = 5
FINE_ITERATIONS = 70
AMBIGUITY_MARGIN = 1.25
MIN_LOCAL_POINTS = 50
FLAT_SELECTION = 0.05


def _fine(surface, given, start, source, ambiguous, progress=None, orient=True):
    samples = _outward(surface, given, start) if orient else given
    r = icp(
        surface,
        samples,
        start,
        max_iterations=FINE_ITERATIONS,
        reject_median_factor=3,
        min_normal_dot=0.3,
        on_iteration=(lambda i, d, m: progress(f"Aligning — pass {i}, mean deviation {d:.4f} mm…")) if progress else None,
    )
    if r["matched"] == 0:
        raise AlignError(
            "No scan point found reference surface facing its way, so the scan was left where it was. Check that the scan and the reference are the same part, or pick a few point pairs to start from."
        )
    return {"transform": r["transform"], "source": source, "rms": r["rms"], "meanDistance": r["meanDistance"], "iterations": r["iterations"], "matched": r["matched"], "sampled": r["sampled"], "ambiguous": ambiguous}


def auto_align(surface, positions, normals, coarse_samples=4000, fine_samples=25_000, progress=None):
    """Best fit with no help: the identity (two files exported in one frame)
    and the 24 principal-axis attitudes, each screened wound both ways; the
    best few run on; the winner refined on more points."""
    coarse = sample_scan(positions, normals, coarse_samples)
    scan_frame = R.principal_frame(coarse["xyz"])
    nominal_frame = R.principal_frame(surface.positions)
    candidates = [R.identity()] + R.prealign_candidates(scan_frame, nominal_frame)
    turned = _flipped(coarse) if coarse["normals"] is not None else None
    windings = [(coarse, coarse), (turned, _thinned(turned, 4))] if turned is not None else [(coarse, coarse)]
    screened = []
    for i, cand in enumerate(candidates):
        if progress:
            progress(f"Aligning — screening start {i + 1} of {len(candidates)}…")
        for samples, screen in windings:
            r = icp(surface, screen, cand, max_iterations=SCREEN_ITERATIONS, reject_median_factor=2.5, min_normal_dot=0)
            screened.append({**r, "samples": samples})
    screened.sort(key=lambda r: r["score"])
    scored = []
    for i, s in enumerate(screened[:SHORTLIST]):
        if progress:
            progress(f"Aligning — trying start {i + 1} of {SHORTLIST}…")
        r = icp(surface, s["samples"], s["transform"], max_iterations=COARSE_ITERATIONS, reject_median_factor=2.5, min_normal_dot=0)
        scored.append({**r, "samples": s["samples"]})
    scored.sort(key=lambda r: r["score"])
    winner = scored[0]
    runner = scored[1] if len(scored) > 1 else None
    radius = float(np.linalg.norm(coarse["xyz"] - scan_frame["centroid"], axis=1).max()) if coarse["count"] else 0.0
    ambiguous = bool(
        runner is not None
        and runner["score"] < winner["score"] * AMBIGUITY_MARGIN
        and R.disagreement(winner["transform"], runner["transform"], scan_frame["centroid"], radius) > surface.bbox_diagonal * 0.01
    )
    if progress:
        progress("Aligning — refining…")
    sampled = sample_scan(positions, normals, fine_samples)
    samples = sampled if winner["samples"] is coarse else _flipped(sampled)
    return _fine(surface, samples, winner["transform"], "auto", ambiguous, progress, orient=False)


def align_from_pairs(surface, positions, normals, pairs, fine_samples=25_000, vertices=None, progress=None):
    """Best fit started from hand-picked pairs [(scan, reference), ...]."""
    if len(pairs) < 3:
        raise AlignError("Pick at least three point pairs — two cannot fix a rotation.")
    solved = R.absolute_orientation([p[0] for p in pairs], [p[1] for p in pairs])
    if not solved:
        raise AlignError("Could not solve the picked points.")
    if solved["conditioning"] < 0.02:
        raise AlignError("The picked points are nearly in a line — add one away from that line, so the rotation about it is fixed.")
    positions = np.asarray(positions, dtype=float).reshape(-1, 3)
    sel = np.asarray(vertices, dtype=np.int64) if vertices is not None and len(vertices) > 0 else None
    if sel is not None and len(sel) < MIN_LOCAL_POINTS:
        raise AlignError(f"Select more surface — a fit needs at least {MIN_LOCAL_POINTS} selected points, and this selection has {len(sel)}. Clear the selection to fit on the whole scan.")
    src_p = positions if sel is None else positions[sel]
    src_n = None if normals is None else (normals if sel is None else np.asarray(normals)[sel])
    samples = sample_scan(src_p, src_n, fine_samples)
    out = _fine(surface, samples, solved["transform"], "points", False, progress)
    out["pairRms"] = solved["rms"]
    if sel is not None:
        out["selected"] = int(len(sel))
    return out


def _normal_spread(normals):
    if normals is None or len(normals) == 0:
        return 1.0
    m = normals.T @ normals / len(normals)
    return float(np.linalg.eigvalsh(m)[1])


def align_local(surface, positions, normals, vertices, start, max_distance, fine_samples=25_000, progress=None):
    """Fine tuning on marked surface only, from a fit that roughly holds;
    pairs past max_distance refused outright."""
    vertices = np.asarray(vertices, dtype=np.int64)
    if len(vertices) < MIN_LOCAL_POINTS:
        raise AlignError(f"Mark more surface — a local fit needs at least {MIN_LOCAL_POINTS} marked points, and this selection has {len(vertices)}.")
    if not (max_distance > 0):
        raise AlignError("The maximum search distance must be greater than zero.")
    positions = np.asarray(positions, dtype=float).reshape(-1, 3)
    samples = sample_scan(positions[vertices], None if normals is None else np.asarray(normals)[vertices], fine_samples)
    r = icp(
        surface,
        samples,
        start,
        max_iterations=FINE_ITERATIONS,
        reject_median_factor=3,
        min_normal_dot=0.5,
        facing_search=True,
        max_pair_distance=max_distance,
        score_cap=max_distance,
        on_iteration=(lambda i, d, m: progress(f"Fine fit — pass {i}, mean deviation {d:.4f} mm…")) if progress else None,
    )
    if r["matched"] == 0:
        raise AlignError(f"No marked point found reference surface within {max_distance} mm. Raise the maximum search distance, or run the global best fit first.")
    return {
        "transform": r["transform"],
        "source": "local",
        "rms": r["rms"],
        "meanDistance": r["meanDistance"],
        "iterations": r["iterations"],
        "matched": r["matched"],
        "sampled": r["sampled"],
        "ambiguous": False,
        "selected": int(len(vertices)),
        "searchDistance": max_distance,
        "underconstrained": _normal_spread(samples["normals"]) < FLAT_SELECTION,
    }
