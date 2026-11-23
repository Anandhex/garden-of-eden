// CPU copies of the character parts (meshes inside the FBX files), extracted on first use and kept: rest vertices in rig space, normals, UVs,
// vertex colours, triangles per material, bone weights remapped to the person rig's bone indices, and every blend shape as a sparse
// list (vertex index, delta). PersonBuilder bakes a person by adding weighted deltas and merging parts into one mesh.
using System.Collections.Generic;
using UnityEngine;

namespace GardenOfEden.World
{
    public sealed class ShapeDelta { public int[] idx; public Vector3[] d; }

    public sealed class PartData
    {
        public string name;
        public Vector3[] pos, nrm;
        public Vector2[] uv;
        public Vector2[] uv2;           // second UV set (the new head layout: UV0 = head texture set, UV1 = FaceDecalUV), or null
        public Color32[] col;           // null when the FBX has no vertex colours
        public int[][] tris;            // per submesh
        public string[] mats;           // per submesh material name
        public Texture[] tex;           // per submesh main texture of the FBX material (hair/brow/lash cards), or null
        public BoneWeight[] bw;         // indices into RigInfo.names
        public Dictionary<string, ShapeDelta> shapes = new Dictionary<string, ShapeDelta>();
    }

    /// <summary>The rest pose of the person rig (names, parents, world positions and rotations) read once from the rig prefab.</summary>
    public sealed class RigInfo
    {
        public string[] names;
        public int[] parent;                 // -1 for the root
        public Vector3[] restPos;            // world, root at the origin
        public Quaternion[] restRot;
        public Vector3[] restScale;          // lossy
        public readonly Dictionary<string, int> index = new Dictionary<string, int>();
        public int hips;

        public static RigInfo Read(GameObject prefab)
        {
            var inst = Object.Instantiate(prefab);
            inst.transform.position = Vector3.zero; inst.transform.rotation = Quaternion.identity; inst.transform.localScale = Vector3.one;
            var ts = inst.GetComponentsInChildren<Transform>(true);
            var r = new RigInfo { names = new string[ts.Length], parent = new int[ts.Length], restPos = new Vector3[ts.Length], restRot = new Quaternion[ts.Length], restScale = new Vector3[ts.Length] };
            var idx = new Dictionary<Transform, int>();
            for (int i = 0; i < ts.Length; i++) idx[ts[i]] = i;
            for (int i = 0; i < ts.Length; i++)
            {
                r.names[i] = ts[i].name;
                r.parent[i] = ts[i].parent != null && idx.TryGetValue(ts[i].parent, out var p) ? p : -1;
                r.restPos[i] = ts[i].position; r.restRot[i] = ts[i].rotation; r.restScale[i] = ts[i].lossyScale;
                r.index[ts[i].name] = i;
            }
            r.hips = r.index.TryGetValue("Hips", out var h) ? h : 0;
            Object.DestroyImmediate(inst);
            return r;
        }
    }

    public sealed class PartLibrary
    {
        readonly CharacterKit kit;
        public readonly RigInfo rig;
        readonly Dictionary<string, PartData> cache = new Dictionary<string, PartData>();
        // Reusable buffers for blend shape extraction.
        Vector3[] bufD = new Vector3[0], bufN = new Vector3[0], bufT = new Vector3[0];

        public PartLibrary(CharacterKit kit)
        {
            this.kit = kit;
            rig = RigInfo.Read(kit.rigPrefab);
        }

        static Matrix4x4 RelativeToRoot(Transform root, Transform t)
        {
            var m = Matrix4x4.identity;
            for (var c = t; c != null && c != root; c = c.parent) m = Matrix4x4.TRS(c.localPosition, c.localRotation, c.localScale) * m;
            return m;
        }

        public bool Has(string fbxKey, string objName) => cache.ContainsKey(fbxKey + "/" + objName);

        /// <summary>The part named objName in the FBX file fbxKey (without extension), or null when it does not exist.</summary>
        public PartData Get(string fbxKey, string objName)
        {
            string key = fbxKey + "/" + objName;
            if (cache.TryGetValue(key, out var d)) return d;
            d = Extract(fbxKey, objName);
            cache[key] = d;
            return d;
        }

        PartData Extract(string fbxKey, string objName)
        {
            var go = kit.Fbx(fbxKey);
            if (go == null) { Debug.LogWarning("PartLibrary: no FBX " + fbxKey); return null; }
            SkinnedMeshRenderer smr = null;
            foreach (var s in go.GetComponentsInChildren<SkinnedMeshRenderer>(true)) if (s.name == objName) { smr = s; break; }
            if (smr == null || smr.sharedMesh == null) { Debug.LogWarning("PartLibrary: " + fbxKey + " has no mesh " + objName); return null; }
            var m = smr.sharedMesh;
            if (!m.isReadable) { Debug.LogWarning("PartLibrary: " + fbxKey + "/" + objName + " is not readable"); return null; }
            var rel = RelativeToRoot(go.transform, smr.transform);
            int n = m.vertexCount;
            var part = new PartData { name = objName };
            var v = m.vertices; var nr = m.normals;
            part.pos = new Vector3[n]; part.nrm = new Vector3[n];
            for (int i = 0; i < n; i++)
            {
                part.pos[i] = rel.MultiplyPoint3x4(v[i]);
                part.nrm[i] = nr.Length == n ? rel.MultiplyVector(nr[i]).normalized : Vector3.up;
            }
            part.uv = m.uv.Length == n ? m.uv : new Vector2[n];
            var u2 = m.uv2; part.uv2 = u2 != null && u2.Length == n ? u2 : null;
            var colors = m.colors32;
            part.col = colors != null && colors.Length == n ? colors : null;
            int sub = m.subMeshCount;
            part.tris = new int[sub][]; part.mats = new string[sub]; part.tex = new Texture[sub];
            var mats = smr.sharedMaterials;
            for (int s = 0; s < sub; s++)
            {
                part.tris[s] = m.GetTriangles(s);
                part.mats[s] = s < mats.Length && mats[s] != null ? mats[s].name : "Skin";
                if (s < mats.Length && mats[s] != null && mats[s].HasProperty("_BaseMap")) part.tex[s] = mats[s].GetTexture("_BaseMap");
                else if (s < mats.Length && mats[s] != null && mats[s].HasProperty("_MainTex")) part.tex[s] = mats[s].GetTexture("_MainTex");
            }
            // bone weights, remapped to the rig's indices by bone name
            var bones = smr.bones;
            var map = new int[bones.Length];
            for (int i = 0; i < bones.Length; i++) map[i] = bones[i] != null && rig.index.TryGetValue(bones[i].name, out var ri) ? ri : rig.hips;
            var bw = m.boneWeights;
            part.bw = new BoneWeight[n];
            for (int i = 0; i < n && i < bw.Length; i++)
            {
                var b = bw[i];
                b.boneIndex0 = map[b.boneIndex0]; b.boneIndex1 = map[b.boneIndex1]; b.boneIndex2 = map[b.boneIndex2]; b.boneIndex3 = map[b.boneIndex3];
                part.bw[i] = b;
            }
            // blend shapes: sparse, full-weight frame, rotated into rig space
            if (bufD.Length < n) { bufD = new Vector3[n]; bufN = new Vector3[n]; bufT = new Vector3[n]; }
            var dv = new Vector3[n]; var dn = new Vector3[n]; var dt = new Vector3[n];
            int count = m.blendShapeCount;
            var idx = new List<int>(); var dl = new List<Vector3>();
            for (int s = 0; s < count; s++)
            {
                int frames = m.GetBlendShapeFrameCount(s);
                if (frames == 0) continue;
                m.GetBlendShapeFrameVertices(s, frames - 1, dv, dn, dt);
                float fw = m.GetBlendShapeFrameWeight(s, frames - 1);
                float k = fw > 0.001f ? 100f / fw : 1f;
                idx.Clear(); dl.Clear();
                for (int i = 0; i < n; i++)
                {
                    var d = dv[i];
                    if (d.x * d.x + d.y * d.y + d.z * d.z < 1e-12f) continue;
                    idx.Add(i); dl.Add(rel.MultiplyVector(d) * k);
                }
                if (idx.Count > 0) part.shapes[m.GetBlendShapeName(s)] = new ShapeDelta { idx = idx.ToArray(), d = dl.ToArray() };
            }
            return part;
        }
    }
}
