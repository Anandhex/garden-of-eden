// Roofs: gable (also with upturned "curved" eaves), hip, and flat with a parapet; covered in thatch, tile, shingle, slate or
// turf. Every roof is a closed shell: top bands, a soffit (the underside), rake and eave edge faces, and the gables are filled
// in the wall's material, so there is never a gap between wall top and roof or at the ridge. Then the chimneys and the
// grand extras (turrets, domes, a temple's crown).
using UnityEngine;

namespace GardenOfEden.World
{
    public sealed partial class BuildingBuilder
    {
        static float ProfY(float z, float zf, float yr, float ye, float flare)
        {
            float s = Mathf.Clamp01(z / zf);
            float y = Mathf.Lerp(yr, ye, s);
            if (flare > 0f) { float q = Mathf.Max(0f, (s - 0.45f) / 0.55f); y += flare * q * q; }
            return y;
        }

        // Chunky eaves (G8): roughly twice a real roof's edge, so the roof reads as one thick soft slab from the game camera.
        static float Thick(RoofMat m) => m == RoofMat.Thatch ? 0.5f : m == RoofMat.Turf ? 0.55f : m == RoofMat.Tile ? 0.27f : m == RoofMat.Slate ? 0.25f : 0.3f;

        static int Bands(RoofMat m) => m == RoofMat.Thatch ? 3 : m == RoofMat.Turf ? 2 : m == RoofMat.Tile ? 8 : m == RoofMat.Slate ? 7 : m == RoofMat.Shingle ? 9 : 4;

        static Color BandCol(Style st, int k, int side, uint h)
        {
            float j = F(h, k, side + 11);
            switch (st.rm)
            {
                case RoofMat.Thatch: return Pal.Mul(st.roof, 0.9f + 0.18f * j);
                case RoofMat.Tile: return Pal.Mul(st.roof, (k % 2 == 0 ? 1.05f : 0.92f) * (0.97f + 0.06f * j));
                case RoofMat.Shingle: return Pal.Mul(st.roof, 0.82f + 0.3f * j);
                case RoofMat.Slate: return Pal.Mul(st.roof, (k % 2 == 0 ? 1.04f : 0.94f) * (0.95f + 0.1f * j));
                case RoofMat.Turf: return Color.Lerp(Pal.Mul(st.roof, 0.95f + 0.1f * j), Pal.Rgb(0x8aa85a), k == 0 ? 0.35f : 0f);
                default: return Pal.Mul(st.roof, 0.95f + 0.1f * j);
            }
        }

        void BuildRoof(MeshBuilder rb, Style st, float x0, float x1, float z0, float z1, float eaveY, uint h, out float ridgeY, out Vector3 chimney)
        {
            float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
            bool alongX = (x1 - x0) >= (z1 - z0);
            float L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
            float yaw = alongX ? 0f : 90f;
            var tr = Matrix4x4.TRS(new Vector3(cx, 0, cz), Quaternion.Euler(0, yaw, 0), Vector3.one);
            rb.SetTransform(tr);

            float yr;   // ridge (or roof deck top) height
            float chx, chz;   // chimney foot in roof space
            switch (st.rf)
            {
                case RoofForm.Flat: RoofFlat(rb, st, L, D, eaveY, h, out yr); chx = L * 0.3f * (h % 2 == 0 ? 1f : -1f); chz = -D * 0.2f; break;
                case RoofForm.Hip: RoofHip(rb, st, L, D, eaveY, h, out yr); chx = Mathf.Max(0.3f, (L - D) * 0.25f) * (h % 2 == 0 ? 1f : -1f); chz = -D * 0.13f; break;
                default: RoofGable(rb, st, L, D, eaveY, h, st.rf == RoofForm.Curved, out yr); chx = L * 0.28f * (h % 2 == 0 ? 1f : -1f); chz = -D * 0.16f; break;
            }
            ridgeY = yr + 0.1f;
            chimney = tr.MultiplyPoint3x4(new Vector3(0, yr + 0.9f, 0));

            // chimneys
            if (st.chimneys > 0 && st.ck != ChimKind.None)
            {
                float top = Chimney(rb, st, chx, chz, eaveY - 0.3f, yr, h, st.rf == RoofForm.Flat);
                chimney = tr.MultiplyPoint3x4(new Vector3(chx, top, chz));
                ridgeY = Mathf.Max(ridgeY, top);
                if (st.chimneys > 1 && L > 4f)
                {
                    float top2 = Chimney(rb, st, -chx, chz, eaveY - 0.3f, yr, h + 7u, st.rf == RoofForm.Flat);
                    ridgeY = Mathf.Max(ridgeY, top2);
                }
            }

            // extras: turrets, dome, crown
            if (st.turrets) Turrets(rb, st, L, D, eaveY, h);
            if (st.dome) { Dome(rb, st, 0, 0, Mathf.Min(L, D) * 0.28f, eaveY + (st.crenel ? 0.95f : 0.7f), true); ridgeY = Mathf.Max(ridgeY, eaveY + 0.7f + Mathf.Min(L, D) * 0.45f + 0.6f); }
            if (st.crown) { float ty = Crown(rb, st, 0, 0, yr, L, D, h); ridgeY = Mathf.Max(ridgeY, ty); chimney = tr.MultiplyPoint3x4(new Vector3(0, yr + 0.3f, 0)); }
            rb.ResetTransform();
        }

        // ------------------------------------------------------------------ gable

        void RoofGable(MeshBuilder rb, Style st, float L, float D, float eaveY, uint h, bool curved, out float yr)
        {
            float ov = st.overhang, go = st.rm == RoofMat.Thatch ? 0.38f : 0.3f;
            float th = Thick(st.rm);
            float rise = D * 0.5f * st.pitch;
            float slope = rise / (D * 0.5f);
            float zf = D * 0.5f + ov, Lh = L * 0.5f + go;
            float ye = eaveY - ov * slope;
            yr = eaveY + rise;
            float flare = curved ? 0.45f : 0f;
            int n = Mathf.Max(Bands(st.rm), curved ? 7 : 0);

            for (int side = 0; side < 2; side++)
            {
                float sg = side == 0 ? 1f : -1f;
                Vector3 outN = new Vector3(0, 1f, sg * 0.8f);
                for (int k = 0; k < n; k++)
                {
                    float za = zf * k / n, zb = zf * (k + 1) / n;
                    float ya = ProfY(za, zf, yr, ye, flare), yb2 = ProfY(zb, zf, yr, ye, flare);
                    Color c = BandCol(st, k, side, h);
                    rb.Quad(new Vector3(-Lh, ya, sg * za), new Vector3(Lh, ya, sg * za), new Vector3(Lh, yb2, sg * zb), new Vector3(-Lh, yb2, sg * zb), c, outN);
                    // soffit
                    rb.Quad(new Vector3(-Lh, ya - th, sg * za), new Vector3(Lh, ya - th, sg * za), new Vector3(Lh, yb2 - th, sg * zb), new Vector3(-Lh, yb2 - th, sg * zb), Pal.Mul(st.roof, 0.55f), Vector3.down);
                    // rake edges
                    rb.Quad(new Vector3(Lh, ya, sg * za), new Vector3(Lh, yb2, sg * zb), new Vector3(Lh, yb2 - th, sg * zb), new Vector3(Lh, ya - th, sg * za), Pal.Mul(st.roof, 0.8f), Vector3.right);
                    rb.Quad(new Vector3(-Lh, ya, sg * za), new Vector3(-Lh, yb2, sg * zb), new Vector3(-Lh, yb2 - th, sg * zb), new Vector3(-Lh, ya - th, sg * za), Pal.Mul(st.roof, 0.8f), Vector3.left);
                }
                // eave edge
                float ye2 = ProfY(zf, zf, yr, ye, flare);
                Color edge = st.rm == RoofMat.Turf ? Pal.Rgb(0x6a5a45) : Pal.Mul(st.roof, 0.78f);
                rb.Quad(new Vector3(-Lh, ye2, sg * zf), new Vector3(Lh, ye2, sg * zf), new Vector3(Lh, ye2 - th, sg * zf), new Vector3(-Lh, ye2 - th, sg * zf), edge, new Vector3(0, 0, sg));

                // thatch fringe along the eave
                if (st.rm == RoofMat.Thatch)
                {
                    int nt = Mathf.Max(6, Mathf.RoundToInt(2f * Lh / 0.32f));
                    for (int i = 0; i < nt; i++)
                    {
                        float u0 = -Lh + 2f * Lh * i / nt, u1 = -Lh + 2f * Lh * (i + 1) / nt;
                        float len = 0.14f + 0.16f * F(h, i, side + 30);
                        rb.Tri(new Vector3(u0, ye2 - th, sg * zf), new Vector3(u1, ye2 - th, sg * zf), new Vector3((u0 + u1) * 0.5f, ye2 - th - len, sg * zf), Pal.Mul(st.roof, 0.72f + 0.12f * (i % 2)), new Vector3(0, 0, sg));
                    }
                }
                // roof tile drip course: a lighter edge course on the first band (tile) is part of the band shading
            }
            // ridge cap
            switch (st.rm)
            {
                case RoofMat.Thatch: rb.Box(new Vector3(-Lh - 0.02f, yr - 0.08f, -0.2f), new Vector3(Lh + 0.02f, yr + 0.2f, 0.2f), Pal.Mul(st.roof, 0.8f), Pal.Mul(st.roof, 0.9f)); break;
                case RoofMat.Turf: rb.Box(new Vector3(-Lh, yr - 0.05f, -0.12f), new Vector3(Lh, yr + 0.14f, 0.12f), Pal.Rgb(0x7fa052)); break;
                default: rb.Box(new Vector3(-Lh - 0.05f, yr - 0.03f, -0.14f), new Vector3(Lh + 0.05f, yr + 0.11f, 0.14f), Pal.Mul(st.roof, 0.7f), Pal.Mul(st.roof, 0.8f)); break;
            }
            // turf: tufts and flowers on the sod
            if (st.rm == RoofMat.Turf)
            {
                for (int i = 0; i < 6; i++)
                {
                    float sg = i % 2 == 0 ? 1f : -1f;
                    float u = Mathf.Lerp(-Lh * 0.8f, Lh * 0.8f, F(h, i, 40)), z = zf * (0.15f + 0.6f * F(h, i, 41));
                    Color bc = i % 3 == 0 ? Pal.Rgb(new[] { 0xe9d56a, 0xe880a0, 0xffffff }[(h + (uint)i) % 3]) : Pal.Rgb(0x6f9a45);
                    rb.Blob(new Vector3(u, ProfY(z, zf, yr, ye, 0f) + 0.05f, sg * z), new Vector3(0.18f, 0.1f, 0.18f), bc, 5, 3, 0.2f, i + (int)h);
                }
            }

            // gable fills (closing the end walls under the roof)
            float eaveF = eaveY - 0.05f;
            for (int e = -1; e <= 1; e += 2)
            {
                float x = e * L * 0.5f + e * 0.01f;
                Vector3 outN = e > 0 ? Vector3.right : Vector3.left;
                bool banded = !curved && (st.wm == WallMat.Stone || st.wm == WallMat.Logs || st.wm == WallMat.Boards || st.wm == WallMat.Ashlar);
                Color fill = st.upperTone || st.floors > 1 ? WallCol(st, st.floors - 1) : st.wall;
                if (banded)
                {
                    float bh = st.wm == WallMat.Stone ? 0.34f : st.wm == WallMat.Logs ? 0.3f : 0.5f;
                    int nb = Mathf.CeilToInt((yr - eaveF) / bh);
                    for (int i = 0; i < nb; i++)
                    {
                        float ya = eaveF + i * bh, yb2 = Mathf.Min(yr - th * 0.4f, eaveF + (i + 1) * bh);
                        float za = ZAt(ya, eaveY, rise, D), zb = ZAt(yb2, eaveY, rise, D);
                        Color bc = Pal.Mul(fill, 0.9f + 0.2f * F(h, i, 50 + e));
                        rb.Quad(new Vector3(x, ya, -za), new Vector3(x, ya, za), new Vector3(x, yb2, zb), new Vector3(x, yb2, -zb), bc, outN);
                    }
                }
                else
                {
                    int m = 8;
                    float half = D * 0.5f;
                    for (int sgn = -1; sgn <= 1; sgn += 2)
                        for (int i = 0; i < m; i++)
                        {
                            float za = half * i / m, zb = half * (i + 1) / m;
                            float ta = ProfY(za, zf, yr, ye, flare) - th * 0.5f, tb = ProfY(zb, zf, yr, ye, flare) - th * 0.5f;
                            rb.Quad(new Vector3(x, eaveF, sgn * za), new Vector3(x, eaveF, sgn * zb), new Vector3(x, tb, sgn * zb), new Vector3(x, ta, sgn * za), fill, outN);
                        }
                }
                if (st.wm == WallMat.HalfTimber && !curved)
                {
                    float xo = x + e * 0.012f;
                    Color tc = st.trim;
                    float pw = 0.07f;
                    rb.Quad(new Vector3(xo, eaveY, -pw), new Vector3(xo, eaveY, pw), new Vector3(xo, yr - th * 0.7f, pw), new Vector3(xo, yr - th * 0.7f, -pw), tc, outN);
                    for (int sgn = -1; sgn <= 1; sgn += 2)
                        rb.Quad(new Vector3(xo, eaveY, sgn * (D * 0.4f)), new Vector3(xo, eaveY, sgn * (D * 0.4f - 0.14f)), new Vector3(xo, eaveY + rise * 0.55f, sgn * 0.04f), new Vector3(xo, eaveY + rise * 0.55f, sgn * 0.04f + sgn * 0.14f), tc, outN);
                    rb.Quad(new Vector3(xo, eaveY + rise * 0.36f, -D * 0.22f), new Vector3(xo, eaveY + rise * 0.36f, D * 0.22f), new Vector3(xo, eaveY + rise * 0.36f + 0.1f, D * 0.22f), new Vector3(xo, eaveY + rise * 0.36f + 0.1f, -D * 0.22f), tc, outN);
                }
                // a little round attic vent in the gable
                if (!curved && rise > 0.9f && st.wm != WallMat.Logs)
                {
                    float vy = eaveY + rise * 0.42f, vr = 0.2f;
                    float xv = x + e * 0.02f;
                    rb.Quad(new Vector3(xv, vy - vr, -vr * 0.7f), new Vector3(xv, vy - vr, vr * 0.7f), new Vector3(xv, vy + vr, vr * 0.7f), new Vector3(xv, vy + vr, -vr * 0.7f), Pal.Rgb(0x2b2b33), outN);
                    rb.Box(new Vector3(xv - (e < 0 ? 0.03f : 0f), vy - vr - 0.04f, -vr * 0.7f - 0.04f), new Vector3(xv + (e > 0 ? 0.03f : 0f), vy - vr, vr * 0.7f + 0.04f), st.trim);
                }
            }

            // bargeboards along the rake edges and finials
            if (st.bargeboard)
            {
                for (int e = -1; e <= 1; e += 2)
                {
                    float x = e * (Lh + 0.035f);
                    Vector3 outN = e > 0 ? Vector3.right : Vector3.left;
                    for (int side = 0; side < 2; side++)
                    {
                        float sg = side == 0 ? 1f : -1f;
                        for (int k = 0; k < n; k++)
                        {
                            float za = zf * k / n, zb = zf * (k + 1) / n;
                            float ya = ProfY(za, zf, yr, ye, flare), yb2 = ProfY(zb, zf, yr, ye, flare);
                            rb.Quad(new Vector3(x, ya + 0.05f, sg * za), new Vector3(x, yb2 + 0.05f, sg * zb), new Vector3(x, yb2 - 0.2f, sg * zb), new Vector3(x, ya - 0.2f, sg * za), st.trim, outN);
                            if (k % 2 == 0) rb.Tri(new Vector3(x, ya - 0.2f, sg * (za + zb) * 0.5f - 0.08f), new Vector3(x, ya - 0.2f, sg * (za + zb) * 0.5f + 0.08f), new Vector3(x, ya - 0.34f, sg * (za + zb) * 0.5f), st.trim, outN);
                        }
                    }
                    rb.Spike(new Vector3(x - e * 0.03f, yr + 0.05f, 0f), new Vector3(x + e * 0.1f, yr + 0.65f, 0f), 0.06f, st.trim, 4);
                }
            }
            else if (st.rf == RoofForm.Gable && st.rm != RoofMat.Thatch && st.rm != RoofMat.Turf)
            {
                // plain verge boards
                for (int e = -1; e <= 1; e += 2)
                {
                    float x = e * (Lh + 0.015f);
                    Vector3 outN = e > 0 ? Vector3.right : Vector3.left;
                    for (int side = 0; side < 2; side++)
                    {
                        float sg = side == 0 ? 1f : -1f;
                        float ya = ProfY(0f, zf, yr, ye, flare), yb2 = ProfY(zf, zf, yr, ye, flare);
                        rb.Quad(new Vector3(x, ya + 0.03f, 0f), new Vector3(x, yb2 + 0.03f, sg * zf), new Vector3(x, yb2 - 0.16f, sg * zf), new Vector3(x, ya - 0.16f, 0f), Pal.Mul(st.trim, 1.15f), outN);
                    }
                }
            }

            // the frieze that closes the gap between the wall top and a flared roof
            if (flare > 0f)
            {
                float half = D * 0.5f;
                float yTop = ProfY(half, zf, yr, ye, flare) - th * 0.5f;
                for (int sgn = -1; sgn <= 1; sgn += 2)
                    rb.Box(new Vector3(-L * 0.5f - 0.02f, eaveY - 0.03f, sgn > 0 ? half - T : -half), new Vector3(L * 0.5f + 0.02f, yTop, sgn > 0 ? half : -half + T), st.wall, Pal.Mul(st.wall, 0.9f));
            }
        }

        static float ZAt(float y, float eaveY, float rise, float D)
        {
            float t = Mathf.Clamp01((y - eaveY) / Mathf.Max(0.001f, rise));
            return D * 0.5f * (1f - t);
        }

        // ------------------------------------------------------------------ hip

        void RoofHip(MeshBuilder rb, Style st, float L, float D, float eaveY, uint h, out float yr)
        {
            float ov = st.overhang;
            float th = Thick(st.rm);
            float rise = D * 0.5f * st.pitch;
            float slope = rise / (D * 0.5f);
            float zf = D * 0.5f + ov, Lh = L * 0.5f + ov;
            float rh = Mathf.Max(0.12f, L * 0.5f - D * 0.5f);
            float ye = eaveY - ov * slope;
            yr = eaveY + rise;
            int n = Bands(st.rm);
            for (int k = 0; k < n; k++)
            {
                float s0 = k / (float)n, s1 = (k + 1) / (float)n;
                float hx0 = Mathf.Lerp(Lh, rh, s0), hx1 = Mathf.Lerp(Lh, rh, s1);
                float zw0 = Mathf.Lerp(zf, 0f, s0), zw1 = Mathf.Lerp(zf, 0f, s1);
                float y0 = Mathf.Lerp(ye, yr, s0), y1 = Mathf.Lerp(ye, yr, s1);
                for (int side = 0; side < 2; side++)
                {
                    float sg = side == 0 ? 1f : -1f;
                    Color c = BandCol(st, k, side, h);
                    rb.Quad(new Vector3(-hx0, y0, sg * zw0), new Vector3(hx0, y0, sg * zw0), new Vector3(hx1, y1, sg * zw1), new Vector3(-hx1, y1, sg * zw1), c, new Vector3(0, 1, sg * 0.8f));
                    Color ce = Pal.Mul(BandCol(st, k, side + 2, h), 0.93f);
                    rb.Quad(new Vector3(sg * hx0, y0, -zw0), new Vector3(sg * hx0, y0, zw0), new Vector3(sg * hx1, y1, zw1), new Vector3(sg * hx1, y1, -zw1), ce, new Vector3(sg * 0.8f, 1, 0));
                }
            }
            Color under = Pal.Mul(st.roof, 0.55f);
            for (int side = 0; side < 2; side++)
            {
                float sg = side == 0 ? 1f : -1f;
                rb.Quad(new Vector3(-Lh, ye - th, sg * zf), new Vector3(Lh, ye - th, sg * zf), new Vector3(rh, yr - th, 0), new Vector3(-rh, yr - th, 0), under, Vector3.down);
                rb.Tri(new Vector3(sg * Lh, ye - th, -zf), new Vector3(sg * Lh, ye - th, zf), new Vector3(sg * rh, yr - th, 0), under, Vector3.down);
                // eave edge faces
                Color edge = Pal.Mul(st.roof, 0.78f);
                rb.Quad(new Vector3(-Lh, ye, sg * zf), new Vector3(Lh, ye, sg * zf), new Vector3(Lh, ye - th, sg * zf), new Vector3(-Lh, ye - th, sg * zf), edge, new Vector3(0, 0, sg));
                rb.Quad(new Vector3(sg * Lh, ye, -zf), new Vector3(sg * Lh, ye, zf), new Vector3(sg * Lh, ye - th, zf), new Vector3(sg * Lh, ye - th, -zf), Pal.Mul(edge, 0.95f), new Vector3(sg, 0, 0));
            }
            // ridge and hip lines
            rb.Box(new Vector3(-rh - 0.06f, yr - 0.04f, -0.13f), new Vector3(rh + 0.06f, yr + 0.12f, 0.13f), Pal.Mul(st.roof, 0.68f), Pal.Mul(st.roof, 0.78f));
            Color hipC = Pal.Mul(st.roof, 0.72f);
            for (int sx = -1; sx <= 1; sx += 2)
                for (int sz = -1; sz <= 1; sz += 2)
                {
                    Vector3 a = new Vector3(sx * Lh, ye + 0.03f, sz * zf), b = new Vector3(sx * rh, yr + 0.05f, 0);
                    rb.Spike(a, b, 0.07f, hipC, 4);
                }
            // finial on a pyramid roof
            if (L * 0.5f - D * 0.5f < 0.2f) rb.Spike(new Vector3(0, yr, 0), new Vector3(0, yr + 0.5f, 0), 0.09f, Pal.Rgb(0xc9a23f), 4);
        }

        // ------------------------------------------------------------------ flat

        void RoofFlat(MeshBuilder rb, Style st, float L, float D, float eaveY, uint h, out float yr)
        {
            float ov = st.overhang + 0.05f;
            Color deck = Pal.Mul(st.roof, 1f);
            float lh = L * 0.5f + ov, dh = D * 0.5f + ov;
            // The slab: a closed box with a soffit.
            rb.Box(new Vector3(-lh, eaveY - 0.04f, -dh), new Vector3(lh, eaveY + 0.14f, dh), Pal.Mul(st.wall2, 0.95f), deck, true);
            float py = eaveY + 0.14f;
            float ph = 0.55f;
            Color pc = Pal.Mul(st.wall, 0.98f);
            if (st.parapet)
            {
                float t = 0.2f;
                rb.Box(new Vector3(-lh, py, dh - t), new Vector3(lh, py + ph, dh), pc, Pal.Lighten(pc, 0.15f));
                rb.Box(new Vector3(-lh, py, -dh), new Vector3(lh, py + ph, -dh + t), pc, Pal.Lighten(pc, 0.15f));
                rb.Box(new Vector3(-lh, py, -dh + t), new Vector3(-lh + t, py + ph, dh - t), pc, Pal.Lighten(pc, 0.15f));
                rb.Box(new Vector3(lh - t, py, -dh + t), new Vector3(lh, py + ph, dh - t), pc, Pal.Lighten(pc, 0.15f));
                // rounded corner posts (adobe, coast) or merlons (castles)
                if (st.crenel)
                {
                    int nl = Mathf.Max(3, Mathf.RoundToInt(2f * lh / 0.9f)), nd = Mathf.Max(2, Mathf.RoundToInt(2f * dh / 0.9f));
                    for (int i = 0; i < nl; i++)
                    {
                        float u = Mathf.Lerp(-lh + 0.3f, lh - 0.3f, (i + 0.5f) / nl);
                        rb.Box(new Vector3(u - 0.22f, py + ph, dh - t), new Vector3(u + 0.22f, py + ph + 0.4f, dh), pc, Pal.Lighten(pc, 0.15f));
                        rb.Box(new Vector3(u - 0.22f, py + ph, -dh), new Vector3(u + 0.22f, py + ph + 0.4f, -dh + t), pc, Pal.Lighten(pc, 0.15f));
                    }
                    for (int i = 0; i < nd; i++)
                    {
                        float u = Mathf.Lerp(-dh + 0.3f, dh - 0.3f, (i + 0.5f) / nd);
                        rb.Box(new Vector3(-lh, py + ph, u - 0.22f), new Vector3(-lh + t, py + ph + 0.4f, u + 0.22f), pc, Pal.Lighten(pc, 0.15f));
                        rb.Box(new Vector3(lh - t, py + ph, u - 0.22f), new Vector3(lh, py + ph + 0.4f, u + 0.22f), pc, Pal.Lighten(pc, 0.15f));
                    }
                    ph += 0.4f;
                }
                else
                {
                    foreach (var sx in new[] { -1f, 1f })
                        foreach (var sz in new[] { -1f, 1f })
                            rb.Box(new Vector3(sx * lh - 0.17f - (sx < 0 ? 0f : 0.0f), py, sz * dh - 0.17f), new Vector3(sx * lh + 0.17f, py + ph + 0.18f, sz * dh + 0.17f), Pal.Mul(st.wall2, 1.0f), Pal.Lighten(st.wall2, 0.2f));
                    // a scupper (water spout) through the front parapet
                    rb.Box(new Vector3(L * 0.2f, py - 0.1f, dh), new Vector3(L * 0.2f + 0.14f, py + 0.04f, dh + 0.35f), Pal.Mul(st.trim, 0.9f));
                }
                // roof furniture: a stair-house and pots
                if (st.a.id == "steppe" && F(h, 60) < 0.6f && L > 3f && D > 2.5f)
                {
                    float sx = L * 0.25f * (F(h, 61) < 0.5f ? 1f : -1f), sz = -D * 0.2f;
                    rb.Box(new Vector3(sx - 0.55f, py, sz - 0.5f), new Vector3(sx + 0.55f, py + 0.95f, sz + 0.5f), Pal.Mul(st.wall, 0.96f), Pal.Lighten(st.wall, 0.12f));
                    rb.Box(new Vector3(sx - 0.62f, py + 0.95f, sz - 0.57f), new Vector3(sx + 0.62f, py + 1.05f, sz + 0.57f), st.trim);
                    rb.Box(new Vector3(sx - 0.2f, py, sz + 0.5f), new Vector3(sx + 0.2f, py + 0.75f, sz + 0.52f), Pal.Rgb(0x2b231c));
                    ph = Mathf.Max(ph, 1.05f);
                }
            }
            yr = py + ph;
        }

        // ------------------------------------------------------------------ chimneys

        float Chimney(MeshBuilder rb, Style st, float x, float z, float yBase, float yr, uint h, bool flat)
        {
            float top = (flat ? yr : yr + 0.75f);
            if (st.ck == ChimKind.Pot)
            {
                // a clay smoke pot on the roof deck
                float y0 = yr - (st.parapet ? 0.0f : 0f);
                if (flat) y0 = Mathf.Max(yBase + 0.3f, yr - 0.5f);
                Color pot = Pal.Rgb(0xb5683c);
                rb.Frustum(new Vector3(x, y0, z), 0.3f, 0.2f, 0.55f, 8, pot, true);
                rb.Frustum(new Vector3(x, y0 + 0.55f, z), 0.26f, 0.26f, 0.09f, 8, Pal.Mul(pot, 0.85f), true);
                return y0 + 0.75f;
            }
            Color col = st.stone;
            float hw = 0.3f;
            switch (st.ck)
            {
                case ChimKind.Stone:
                {
                    col = st.wm == WallMat.Stone ? Pal.Mul(st.wall, 0.95f) : Pal.Rgb(0x8f8a82);
                    rb.Box(new Vector3(x - 0.46f, yBase, z - 0.46f), new Vector3(x + 0.46f, yr + 0.2f, z + 0.38f), col, Pal.Mul(col, 0.7f));
                    rb.Box(new Vector3(x - 0.38f, yr + 0.2f, z - 0.38f), new Vector3(x + 0.38f, top, z + 0.3f), Pal.Mul(col, 0.92f), Pal.Mul(col, 0.7f));
                    for (float y = yr + 0.35f; y < top - 0.1f; y += 0.28f)
                        rb.Box(new Vector3(x - 0.32f, y, z - 0.32f), new Vector3(x + 0.32f, y + 0.06f, z + 0.32f), Pal.Mul(col, 0.7f));
                    rb.Box(new Vector3(x - 0.52f, top, z - 0.52f), new Vector3(x + 0.52f, top + 0.15f, z + 0.52f), Pal.Mul(col, 1.1f));
                    return top + 0.13f;
                }
                case ChimKind.Brick:
                {
                    col = Pal.Rgb(0xa5593f);
                    rb.Box(new Vector3(x - 0.3f, yBase, z - 0.34f), new Vector3(x + 0.3f, top, z + 0.34f), col, Pal.Mul(col, 0.7f));
                    for (float y = yr + 0.15f; y < top; y += 0.22f)
                        rb.Box(new Vector3(x - 0.31f, y, z - 0.35f), new Vector3(x + 0.31f, y + 0.035f, z + 0.35f), Pal.Mul(col, 0.8f));
                    rb.Box(new Vector3(x - 0.38f, top, z - 0.42f), new Vector3(x + 0.38f, top + 0.12f, z + 0.42f), Pal.Mul(col, 1.15f));
                    for (int i = 0; i < 2; i++)
                        rb.Frustum(new Vector3(x - 0.14f + i * 0.28f, top + 0.12f, z), 0.1f, 0.075f, 0.36f, 6, Pal.Rgb(0xb5683c));
                    return top + 0.5f;
                }
                default:   // Capped
                {
                    col = Pal.Rgb(0xf0e8d6);
                    rb.Box(new Vector3(x - 0.27f, yBase, z - 0.27f), new Vector3(x + 0.27f, top, z + 0.27f), col, Pal.Mul(col, 0.8f));
                    rb.Box(new Vector3(x - 0.36f, top, z - 0.36f), new Vector3(x + 0.36f, top + 0.1f, z + 0.36f), Pal.Rgb(0xc65a38), Pal.Rgb(0xd06a3e));
                    rb.Frustum(new Vector3(x, top + 0.1f, z), 0.3f, 0f, 0.34f, 4, Pal.Rgb(0xc65a38), true, 45f);
                    rb.Box(new Vector3(x - 0.16f, top + 0.1f, z - 0.16f), new Vector3(x + 0.16f, top + 0.2f, z + 0.16f), Pal.Rgb(0x2b2b33));
                    return top + 0.45f;
                }
            }
        }

        // ------------------------------------------------------------------ extras

        void Turrets(MeshBuilder rb, Style st, float L, float D, float eaveY, uint h)
        {
            float baseY = eaveY - st.floors * st.floorH;
            Color tc = st.wm == WallMat.Adobe ? Pal.Mul(st.wall, 0.96f) : Pal.Mul(st.wall, 0.93f);
            Color cap = Pal.Mul(st.roof, 1f);
            if (st.rm == RoofMat.Flat || st.rm == RoofMat.Turf) cap = st.accent;
            foreach (var sx in new[] { -1f, 1f })
                foreach (var sz in new[] { -1f, 1f })
                {
                    float px = sx * L * 0.5f, pz = sz * D * 0.5f;
                    float r = 0.78f;
                    rb.Frustum(new Vector3(px, baseY - 0.4f, pz), r + 0.08f, r, eaveY + 1.2f - baseY + 0.4f, 10, tc, true);
                    // stone band and slit windows
                    rb.Frustum(new Vector3(px, eaveY + 1.0f, pz), r + 0.12f, r + 0.12f, 0.2f, 10, Pal.Lighten(tc, 0.12f), true);
                    for (int i = 0; i < 2; i++)
                    {
                        float a = Mathf.Atan2(sz, sx) + (i == 0 ? 0f : 0f);
                        float y = baseY + 1.6f + i * st.floorH;
                        rb.SetTransform(Matrix4x4.identity);
                    }
                    rb.Frustum(new Vector3(px, eaveY + 1.2f, pz), r + 0.28f, 0.0f, 1.5f, 10, cap, true);
                    rb.Spike(new Vector3(px, eaveY + 2.65f, pz), new Vector3(px, eaveY + 3.15f, pz), 0.05f, Pal.Rgb(0xc9a23f), 4);
                }
        }

        void Dome(MeshBuilder rb, Style st, float x, float z, float r, float y, bool gilded)
        {
            Color drum = Pal.Lighten(st.wall, 0.15f);
            rb.Frustum(new Vector3(x, y, z), r * 1.1f, r * 1.05f, 0.85f, 12, drum, true);
            for (int i = 0; i < 6; i++)
            {
                float a = i * Mathf.PI * 2f / 6f;
                rb.Box(new Vector3(x + Mathf.Cos(a) * r * 1.07f - 0.05f, y + 0.3f, z + Mathf.Sin(a) * r * 1.07f - 0.05f), new Vector3(x + Mathf.Cos(a) * r * 1.07f + 0.05f, y + 0.7f, z + Mathf.Sin(a) * r * 1.07f + 0.05f), Pal.Rgb(0x2b2b33));
            }
            Color dc = st.a.id == "imperial" ? Pal.Rgb(0x6f9a95) : st.a.id == "steppe" ? Pal.Rgb(0xd8b04a) : Pal.Rgb(0xd8d2c0);
            rb.Blob(new Vector3(x, y + 0.85f, z), new Vector3(r * 1.05f, r * 0.95f, r * 1.05f), dc, 10, 5, 0f, 1, 0.3f);
            rb.Spike(new Vector3(x, y + 0.85f + r * 0.9f, z), new Vector3(x, y + 0.85f + r * 0.9f + 0.7f, z), 0.07f, Pal.Rgb(0xd8b04a), 4);
        }

        /// <summary>A temple's roof-top crown, in the style of the culture. Returns its top.</summary>
        float Crown(MeshBuilder rb, Style st, float x, float z, float yr, float L, float D, uint h)
        {
            float y = yr + 0.05f;
            switch (st.a.id)
            {
                case "highland":
                {   // a stone bell-cote with a slate cap
                    Color s = Pal.Mul(st.wall, 0.95f);
                    rb.Box(new Vector3(x - 0.5f, y - 0.1f, z - 0.35f), new Vector3(x + 0.5f, y + 1.3f, z + 0.35f), s, Pal.Mul(s, 0.8f));
                    rb.Box(new Vector3(x - 0.2f, y + 0.5f, z - 0.4f), new Vector3(x + 0.2f, y + 1.1f, z + 0.4f), Pal.Rgb(0x2b2b33));
                    rb.Frustum(new Vector3(x, y + 1.3f, z), 0.65f, 0f, 0.8f, 4, st.roof, true, 45f);
                    rb.Box(new Vector3(x - 0.03f, y + 2.0f, z - 0.03f), new Vector3(x + 0.03f, y + 2.5f, z + 0.03f), Pal.Rgb(0x3a3a3e));
                    rb.Box(new Vector3(x - 0.14f, y + 2.3f, z - 0.03f), new Vector3(x + 0.14f, y + 2.36f, z + 0.03f), Pal.Rgb(0x3a3a3e));
                    return y + 2.5f;
                }
                case "river":
                {   // a timber cupola with a shingled spire
                    rb.Frustum(new Vector3(x, y - 0.1f, z), 0.55f, 0.5f, 1.0f, 8, st.trim, true);
                    for (int i = 0; i < 4; i++) { float a = i * Mathf.PI * 0.5f; rb.Box(new Vector3(x + Mathf.Cos(a) * 0.5f - 0.1f, y + 0.25f, z + Mathf.Sin(a) * 0.5f - 0.1f), new Vector3(x + Mathf.Cos(a) * 0.5f + 0.1f, y + 0.85f, z + Mathf.Sin(a) * 0.5f + 0.1f), Pal.Rgb(0x2b2b33)); }
                    rb.Frustum(new Vector3(x, y + 0.9f, z), 0.7f, 0f, 1.9f, 8, Pal.Mul(st.roof, 0.9f), true);
                    rb.Spike(new Vector3(x, y + 2.7f, z), new Vector3(x, y + 3.3f, z), 0.04f, Pal.Rgb(0xc9a23f), 4);
                    return y + 3.3f;
                }
                case "coastal":
                {   // a white belfry with arched openings and a terracotta cap
                    Color w = Pal.Rgb(0xf3ede0);
                    rb.Box(new Vector3(x - 0.55f, y - 0.1f, z - 0.55f), new Vector3(x + 0.55f, y + 1.5f, z + 0.55f), w, Pal.Mul(w, 0.9f));
                    foreach (var sg in new[] { -1f, 1f })
                    {
                        rb.Box(new Vector3(x - 0.22f, y + 0.5f, z + sg * 0.55f - 0.02f), new Vector3(x + 0.22f, y + 1.3f, z + sg * 0.55f + 0.02f), Pal.Rgb(0x2b2b33));
                        rb.Box(new Vector3(x + sg * 0.55f - 0.02f, y + 0.5f, z - 0.22f), new Vector3(x + sg * 0.55f + 0.02f, y + 1.3f, z + 0.22f), Pal.Rgb(0x2b2b33));
                    }
                    rb.Frustum(new Vector3(x, y + 1.5f, z), 0.85f, 0f, 0.9f, 4, st.roof, true, 45f);
                    rb.Box(new Vector3(x - 0.03f, y + 2.3f, z - 0.03f), new Vector3(x + 0.03f, y + 2.9f, z + 0.03f), Pal.Rgb(0xd8b04a));
                    rb.Box(new Vector3(x - 0.18f, y + 2.65f, z - 0.03f), new Vector3(x + 0.18f, y + 2.71f, z + 0.03f), Pal.Rgb(0xd8b04a));
                    return y + 2.9f;
                }
                case "forest":
                {   // a tall carved steeple
                    rb.Box(new Vector3(x - 0.45f, y - 0.1f, z - 0.45f), new Vector3(x + 0.45f, y + 1.1f, z + 0.45f), Pal.Mul(st.wall, 0.9f), Pal.Mul(st.wall, 1.05f));
                    rb.Frustum(new Vector3(x, y + 1.1f, z), 0.62f, 0f, 2.6f, 6, Pal.Mul(st.roof, 0.85f), true);
                    foreach (var sg in new[] { -1f, 1f })
                    {
                        rb.Spike(new Vector3(x + sg * 0.6f, y + 1.1f, z), new Vector3(x + sg * 0.95f, y + 1.9f, z), 0.06f, st.trim, 4);
                        rb.Spike(new Vector3(x, y + 1.1f, z + sg * 0.6f), new Vector3(x, y + 1.9f, z + sg * 0.95f), 0.06f, st.trim, 4);
                    }
                    rb.Spike(new Vector3(x, y + 3.6f, z), new Vector3(x, y + 4.2f, z), 0.04f, Pal.Rgb(0xc9a23f), 4);
                    return y + 4.2f;
                }
                case "steppe":
                {   // a gilded onion on a drum
                    rb.Frustum(new Vector3(x, y - 0.1f, z), 0.65f, 0.6f, 0.9f, 8, Pal.Lighten(st.wall, 0.2f), true);
                    rb.Blob(new Vector3(x, y + 1.25f, z), new Vector3(0.65f, 0.6f, 0.65f), Pal.Rgb(0xd8b04a), 9, 5, 0f, 2, 0.3f);
                    rb.Frustum(new Vector3(x, y + 1.7f, z), 0.3f, 0f, 0.9f, 8, Pal.Rgb(0xd8b04a), true);
                    rb.Spike(new Vector3(x, y + 2.55f, z), new Vector3(x, y + 3.1f, z), 0.04f, st.accent, 4);
                    return y + 3.1f;
                }
                default:   // imperial
                {   // a drum and a verdigris dome
                    Dome(rb, st, x, z, 0.85f, y - 0.1f, true);
                    return y + 3.2f;
                }
            }
        }
    }
}
