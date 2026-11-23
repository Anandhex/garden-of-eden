"""Fixed landmark vertex sets on the MakeHuman hm08 topology (deterministic, picked once from the default mesh).

The topology never changes, so every measurement and every part split uses the same vertex indices for every shape.
`Landmarks(B)` needs an `mhcore.Base` (vertex groups, faces) and the default-macro coordinates.
"""
import os, glob, json
import numpy as np
import mhcore as mc

PART_OF_BONE = {
    "head": ("Head", "Neck", "Jaw", "LeftEye", "RightEye", "LeftOrbicularisTop", "RightOrbicularisTop",
             "LeftOrbicularisBottom", "RightOrbicularisBottom"),
    "torso": ("Hips", "Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder", "LeftBreast", "RightBreast", "Root"),
    "arms": ("LeftArm", "RightArm", "LeftForeArm", "RightForeArm"),
    "legs": ("LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftButtock", "RightButtock"),
    "feet": ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"),
}


def bone_part(b):
    b = b.replace("mixamorig:", "")
    for p, names in PART_OF_BONE.items():
        if b in names:
            return p
    if "Hand" in b:
        return "hands"
    raise KeyError(b)


class Landmarks:
    def __init__(self, B, P0):
        self.B = B
        self.P0 = P0
        n = B.n
        bm = B.body_mask
        self.body = np.nonzero(bm)[0]
        self.faces = [f for f in B.faces_all if all(bm[v] for v in f)]
        self.face_ids = [i for i, f in enumerate(B.faces_all) if all(bm[v] for v in f)]
        # ---- weights (MPFB mixamo_unity, CC0) and the dominant-bone part of every vertex
        W = mc.rig_weights()["weights"]
        self.bones = list(W.keys())
        self.W = np.zeros((n, len(self.bones)))
        for j, b in enumerate(self.bones):
            for vi, w in W[b]:
                self.W[vi, j] = w
        dom = np.argmax(self.W, axis=1)
        self.vpart = np.array([bone_part(self.bones[j]) for j in dom])
        self.vpart[self.W.sum(axis=1) < 1e-6] = "none"
        # ---- face part of every body face = part of the majority of its vertices (ties: lowest priority index)
        prio = ["head", "torso", "arms", "hands", "legs", "feet"]
        fp = []
        for f in self.faces:
            ps = [self.vpart[v] for v in f]
            fp.append(max(prio, key=lambda p: (ps.count(p), -prio.index(p))))
        self.fpart = np.array(fp)
        # ---- ears (MPFB extra group), left = +x
        ears = B.groups["ears"]
        self.ear_L = ears[P0[ears, 0] > 0]
        self.ear_R = ears[P0[ears, 0] < 0]
        # ---- nose: vertices strongly moved by the nose targets (relative to each target's own maximum)
        score = np.zeros(n)
        for f in sorted(glob.glob(mc.sys_data("targets", "nose", "*.target.gz"))):
            D = mc.read_target(f, n)
            m = np.linalg.norm(D, axis=1)
            if m.max() > 0:
                score = np.maximum(score, m / m.max())
        self.nose_score = score
        # ---- lips (MPFB extra group) and the midline landmarks (outer profile)
        L = B.groups["lips"]
        self.lips = L
        mid = L[np.abs(P0[L, 0]) < 1e-4]
        outer = mid[P0[mid, 1] < P0[mid, 1].min() + 0.012]
        o = outer[np.argsort(-P0[outer, 2])]
        self.lipTop = int(o[0])
        self.lipBottom = int(o[-1])
        # contact: the deepest point of the FRONT profile (min y per height) between the upper and lower lip bulges
        front = [v for v in mid if not np.any((np.abs(P0[mid, 2] - P0[v, 2]) < 0.0008) & (P0[mid, 1] < P0[v, 1] - 1e-5))]
        front = [v for v in front if P0[self.lipBottom, 2] + 0.004 < P0[v, 2] < P0[self.lipTop, 2] - 0.004]
        self.lipContact = int(max(front, key=lambda v: P0[v, 1]))
        self.mouthCorner_L = int(L[np.argmax(P0[L, 0])])
        self.mouthCorner_R = int(L[np.argmin(P0[L, 0])])
        # ---- chin: lowest front midline body vertex above the throat jump
        midb = self.body[np.abs(P0[self.body, 0]) < 1e-4]
        cand = midb[(P0[midb, 2] < P0[self.lipBottom, 2]) & (P0[midb, 2] > P0[self.lipBottom, 2] - 0.09) &
                    (P0[midb, 1] < P0[self.lipBottom, 1] + 0.035)]
        self.chin = int(cand[np.argmin(P0[cand, 2])])
        # ---- eye lid ring: body vertices touching the eyeball helper sphere (left eye, +x)
        self.lid = {}
        for sd, g in (("L", "helper-l-eye"), ("R", "helper-r-eye")):
            E = B.groups[g]
            c = P0[E].mean(axis=0)
            r = np.linalg.norm(P0[E] - c, axis=1).mean()
            cand = self.body[(np.linalg.norm(P0[self.body] - c, axis=1) < r * 1.10) & (P0[self.body, 1] < c[1] - 0.25 * r)]
            self.lid[sd] = cand
        # subnasale: the lowest midline vertex of the core nose region (columella base), fixed index
        core = np.nonzero(self.nose_score > 0.6)[0]
        core = core[(np.abs(P0[core, 0]) < 1e-4) & bm[core]]
        self.subnasale = int(core[np.argmin(P0[core, 2])])
        # crown: top of the head (midline)
        self.crown = int(midb[np.argmax(P0[midb, 2])])
        # brow column helper (vertices above the eye centre line used for the brow ridge)

    # -------------------------------------------------------------------------------------------- per-shape helpers
    def joint(self, P, name):
        return P[self.B.groups[name]].mean(axis=0)

    def eye_frame(self, P, sd="L"):
        """canthi, upper/lower lid points of the visible aperture (projected on the front plane)."""
        R = self.lid[sd]
        Q = P[R]
        ci = R[np.argmin(np.abs(Q[:, 0]))]
        co = R[np.argmax(np.abs(Q[:, 0]))]
        xc = (P[ci, 0] + P[co, 0]) / 2
        w = abs(P[co, 0] - P[ci, 0])
        near = R[np.abs(Q[:, 0] - xc) < 0.18 * w]
        up = near[np.argmax(P[near, 2])]
        lo = near[np.argmin(P[near, 2])]
        return int(ci), int(co), int(up), int(lo)

    def nose_set(self, thr=0.25):
        return np.nonzero(self.nose_score > thr)[0]
