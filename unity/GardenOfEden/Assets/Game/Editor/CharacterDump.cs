using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace GardenOfEden.EditorTools
{
    /// <summary>Debug helper: prints the structure of each imported character model to Assets/../Logs/character-dump.txt.</summary>
    public static class CharacterDump
    {
        public static void Humanoid()
        {
            foreach (var path in AssetDatabase.FindAssets("t:Model", new[] { "Assets/Game/Art/Characters/KayKit", "Assets/Game/Art/Characters/Quaternius/Humans" }).Select(AssetDatabase.GUIDToAssetPath))
            {
                var imp = (ModelImporter)AssetImporter.GetAtPath(path);
                imp.animationType = ModelImporterAnimationType.Human;
                imp.SaveAndReimport();
            }
            Run();
        }

        public static void Run()
        {
            var sb = new StringBuilder();
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { "Assets/Game/Art/Characters" }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                var imp = AssetImporter.GetAtPath(path) as ModelImporter;
                sb.AppendLine("== " + path + " animType=" + imp.animationType + " scale=" + imp.globalScale + " clips=" + imp.clipAnimations.Length + "/" + imp.defaultClipAnimations.Length);
                var rends = go.GetComponentsInChildren<Renderer>(true);
                var b = new Bounds();
                bool first = true;
                foreach (var r in rends)
                {
                    var bb = r.bounds;
                    if (first) { b = bb; first = false; } else b.Encapsulate(bb);
                    sb.Append("  R " + r.name + " " + r.GetType().Name + " mats=");
                    sb.AppendLine(string.Join(",", r.sharedMaterials.Select(m => m == null ? "null" : m.name + "(" + m.shader.name + " " + (m.HasProperty("_Color") ? m.color.ToString() : "") + (m.mainTexture != null ? " tex" : "") + ")")));
                }
                sb.AppendLine("  bounds size " + b.size.ToString("F2") + " center " + b.center.ToString("F2") + " rootScale=" + go.transform.localScale);
                var av = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Avatar>().FirstOrDefault();
                sb.AppendLine("  avatar " + (av != null ? "valid=" + av.isValid + " human=" + av.isHuman : "none"));
                var clips = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview")).ToArray();
                sb.AppendLine("  clips " + clips.Length + ": " + string.Join(", ", clips.Take(40).Select(c => c.name + "(" + c.length.ToString("F2") + ")")));
                var smr = go.GetComponentInChildren<SkinnedMeshRenderer>();
                if (smr != null)
                    sb.AppendLine("  bones " + string.Join(",", smr.bones.Take(70).Select(t => t.name)));
            }
            File.WriteAllText("Logs/character-dump.txt", sb.ToString());
            Debug.Log("character dump written");
        }
    }
}
