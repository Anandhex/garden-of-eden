"""Virtual space for the blend-shape fields.

shapes.py describes every blend shape as a displacement field over a *virtual* body: an upright T-pose adult of 1.75 m
with fixed landmark heights (ankle 0.088, knee 0.50, hip 0.88, shoulder 1.366, neck base 1.42, chin 1.507, eye 1.625, top 1.752).
The real bundle body is in an A-pose with its own proportions, so each vertex is mapped to the virtual space
(arms rotated up and rescaled, piecewise-linear z map through the landmarks, x/y scaled per body/head), the field is
evaluated there and the delta is mapped back through the inverse of the local Jacobian.
"""
import numpy as np
import shapes


def S(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


OLD_Z = {"sole": 0.0, "ankle": 0.088, "knee": 0.50, "hip": 0.88, "neck_base": 1.42, "chin": 1.507, "eye": 1.625, "top": 1.752}
OLD_PIVOT = (0.175, 1.366)     # x, z of the shoulder joint in the virtual T-pose
OLD_ARM_LEN = 0.525            # shoulder joint to wrist
OLD_CHEST_HW = 0.165
OLD_SKULL_HW = 0.085
OLD_HEAD_Y = 0.012


class FieldMap:
    def __init__(self, P, vert_part, lm):
        """P: (N,3) male basis vertices; vert_part: per vertex part name (arms/hands/torso/head/...); lm: landmarks."""
        self.P = P
        N = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax, s = np.abs(x), np.sign(x)
        pivot = lm["pivot"]
        d = lm["wrist"] - pivot
        self.alpha = float(np.arctan2(-d[2], d[0]))              # arm angle below horizontal
        self.arm_len = float(np.linalg.norm(d))
        # arm weight
        w = np.zeros(N)
        pa = np.array([p in ("arms", "hands") for p in vert_part], float)
        w = pa.copy()
        tor = np.array([p == "torso" for p in vert_part])
        cap = S(0.5 * pivot[0], lm["shoulder_b"][0], ax) * S(pivot[2] - 0.09, pivot[2] - 0.02, z) * tor
        w = np.maximum(w, cap)
        self.w_arm = w
        a = self.alpha
        c, sn = np.cos(a), np.sin(a)
        # rotation in the xz-plane about the pivot, mirrored for the right arm (u = |x|)
        u = ax - pivot[0]
        zz = z - pivot[2]
        ur = u * c - zz * sn
        zr = u * sn + zz * c
        u2 = u + w * (ur - u)
        z2 = zz + w * (zr - zz)
        # arm length scale (along the virtual x) and move the pivot to the virtual pivot
        sl = OLD_ARM_LEN / self.arm_len
        u3 = u2 * (1 + w * (sl - 1))
        xv = np.where(w > 1e-9, OLD_PIVOT[0] + u3, ax)
        xv = ax * (1 - w) + (OLD_PIVOT[0] + u3) * w
        zv0 = (z2 + pivot[2]) * w + z * (1 - w)
        zv0 = zv0 + w * 0.0
        # Jacobian of the arm stage
        R = np.array([[c, -sn], [sn, c]])
        J = np.zeros((N, 3, 3))
        J[:, 1, 1] = 1.0
        # (x,z) block: I + w (R - I), then x scaled
        J[:, 0, 0] = (1 + w * (c - 1)) * (1 + w * (sl - 1))
        J[:, 0, 2] = (w * (-sn)) * (1 + w * (sl - 1))
        J[:, 2, 0] = w * sn
        J[:, 2, 2] = 1 + w * (c - 1)
        # z remap through the landmarks (applied to the T-posed z)
        zs = [lm["sole"], lm["ankle_b"][2] - 0.03, lm["knee"][2], lm["hip_b"][2], lm["neck_base"][2], lm["chin"], lm["eye"][2], lm["top"]]
        zo = [OLD_Z[k] for k in ("sole", "ankle", "knee", "hip", "neck_base", "chin", "eye", "top")]
        # arms: after the rotation their z is near the pivot z; align the pivot with the virtual shoulder height
        zlen = np.interp(pivot[2], zs, zo)
        zv1 = zv0
        self.zs, self.zo = np.array(zs), np.array(zo)
        slope = np.interp(z, 0.5 * (self.zs[1:] + self.zs[:-1]), np.diff(self.zo) / np.diff(self.zs), left=None, right=None)
        zmap = np.interp(zv1, self.zs, self.zo)
        # arm verts: z relative to the pivot is kept (rigid), the pivot itself lands on OLD_PIVOT[1]
        zarm = OLD_PIVOT[1] + (zv1 - pivot[2]) * 1.0
        zmap = np.where(w > 1e-9, zmap * (1 - w) + zarm * w, zmap)
        Jz = np.where(w > 1e-9, slope * (1 - w) + 1.0 * w, slope)
        Jz = np.broadcast_to(Jz, (N,))
        J[:, 2, :] *= Jz[:, None]
        # body / head x,y scale
        skull = [i for i, p in enumerate(vert_part) if p == "head"]
        sk_hw = np.abs(x[skull][np.abs(x[skull]) < lm["head_half_w"] * 0.97]).max()
        self.kxh = OLD_SKULL_HW / sk_hw
        chest = np.abs(x[(np.array(vert_part) == "torso") & (np.abs(z - (lm["neck_base"][2] - 0.1)) < 0.05)]).max()
        self.kxb = OLD_CHEST_HW / chest
        wh = S(lm["neck_base"][2], lm["chin"], z)
        kx = self.kxb * (1 - wh) + self.kxh * wh
        y0 = float(np.median(P[np.array(vert_part) == "torso", 1]))
        yhc = float(lm["head_c"][1])
        yb = (y - y0) * self.kxb
        yh = OLD_HEAD_Y + (y - yhc) * self.kxh
        yv = yb * (1 - wh) + yh * wh
        xv_all = np.where(w > 1e-9, xv * (1 - 0) , ax)
        xv_scaled = xv_all * kx
        # for arm verts the x has already been scaled to the old pivot geometry, do not scale it again
        xv_final = np.where(w > 1e-9, xv_all * (1 - w) * kx + xv_all * w, xv_all * kx)
        self.Pv = np.stack([s * xv_final, yv, zmap], axis=1)
        # Jacobian: x,y scale (about the origin) and the right-arm mirror flips the x-z coupling
        J[:, 0, :] *= np.where(w > 1e-9, 1 - w * (1 - kx), kx)[:, None]
        J[:, 1, 1] = np.where(wh > 0, ((1 - wh) * self.kxb + wh * self.kxh), self.kxb)
        mirror = np.where(s < 0, -1.0, 1.0)
        J[:, 0, 2] *= mirror
        J[:, 2, 0] *= mirror
        self.Jinv = np.linalg.inv(J)
        shapes.EYE_X = float(lm["eye_x"] * self.kxh)
        self.sk_hw = sk_hw
        # the shoulder joint moves with the shape; the translation of the pivot is NOT rotated by the A-pose
        py = (pivot[1] - y0) * self.kxb
        self.piv_v = np.array([[OLD_PIVOT[0], py, OLD_PIVOT[1]], [-OLD_PIVOT[0], py, OLD_PIVOT[1]]])
        slope_p = float(np.interp(pivot[2], 0.5 * (self.zs[1:] + self.zs[:-1]), np.diff(self.zo) / np.diff(self.zs)))
        self.jb_inv = np.array([1 / self.kxb, 1 / self.kxb, 1 / slope_p])
        self.side = np.where(s >= 0, 0, 1)

    def deltas(self, name):
        f = shapes.F(self.Pv[:, 0], self.Pv[:, 1], self.Pv[:, 2])
        dx, dy, dz = shapes.FUNCS[name](f)
        dv = np.stack([dx, dy, dz], axis=1)
        pf = shapes.F(self.piv_v[:, 0], self.piv_v[:, 1], self.piv_v[:, 2])
        px, py_, pz = shapes.FUNCS[name](pf)
        tp = np.stack([px, py_, pz], axis=1)[self.side] * self.w_arm[:, None]
        real = np.einsum('nij,nj->ni', self.Jinv, dv - tp) + tp * self.jb_inv[None, :]
        return real
