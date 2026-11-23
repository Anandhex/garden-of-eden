// The parsed manifests of the Blender character system: swappable parts (parts_manifest.json), clothes (clothes_manifest.json),
// species presets and joint offsets. Pure data and filters; PersonRecipe picks from here, PersonBuilder builds from the picks.
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace GardenOfEden.World
{
    /// <summary>One entry of the parts manifest (an eye look, a brow, a mouth, a nose, an ear pair, a hair style, a beard).</summary>
    public sealed class PartEntry
    {
        public string id, category, name, file, texture;
        public string[] tags, species, sexes, ages, meshObjects;
        public Dictionary<string, string> textures = new Dictionary<string, string>();
        public bool decal, hatCompatible = true;
        public string hatVariant, defaultColour, teethMesh, kind;
        public bool Has(string[] list, string v) { if (list == null) return false; foreach (var x in list) if (x == v) return true; return false; }
        public bool HasTag(string t) => Has(tags, t);
    }

    public sealed class ClothPiece
    {
        public string id, slot, layer, obj, file;
        public string[] hides, cultures, classes, ages, sexes, species, materials;
    }

    public sealed class Outfit
    {
        public string id, cls, culture, sex, age;
        public string[] pieces;
        public Color tint, trim;
    }

    public sealed class SpeciesPreset
    {
        public string id;
        public Dictionary<string, float> shapes = new Dictionary<string, float>();
        public float rootScaleM = 1f, rootScaleF = 1f, heightM = 1.75f, heightF = 1.65f;
        public Color[] skin = new Color[0];
        public string[] ears = new string[0], earVariants = new string[0], extra = new string[0], tuskVariants = new string[0];
        public string nose;
    }

    public sealed class PersonCatalog
    {
        public readonly Dictionary<string, List<PartEntry>> parts = new Dictionary<string, List<PartEntry>>();
        public readonly Dictionary<string, PartEntry> partById = new Dictionary<string, PartEntry>();
        public readonly Dictionary<string, ClothPiece> pieces = new Dictionary<string, ClothPiece>();
        public readonly List<Outfit> outfits = new List<Outfit>();
        public readonly Dictionary<string, SpeciesPreset> species = new Dictionary<string, SpeciesPreset>();
        /// <summary>shape -> bone -> offset in Unity axes (metres at weight 1).</summary>
        public readonly Dictionary<string, Dictionary<string, Vector3>> jointOffsets = new Dictionary<string, Dictionary<string, Vector3>>();
        public readonly Dictionary<string, Color> hairPalette = new Dictionary<string, Color>(), irisPalette = new Dictionary<string, Color>(), lipPalette = new Dictionary<string, Color>();
        public static readonly string[] EmptyList = new string[0];
        /// <summary>Extra default parts of the base body (base_body_meta.json "parts" beyond the six regions, nose and ears: lashes, brow cards...), always worn.</summary>
        public readonly List<string> baseExtra = new List<string>();
        /// <summary>Mouth interior meshes by name (parts_mouth.fbx): the cavity, the tongue, the teeth styles.</summary>
        public readonly List<PartEntry> mouthParts = new List<PartEntry>();
        /// <summary>Eye parts of the new face (base_body_meta.json "eyeParts": eyeballs, corneas, lashes).</summary>
        public readonly List<string> eyeParts = new List<string>();
        /// <summary>Expression blend shapes (blinks, visemes, smiles) that stay live on the baked mesh (base_body_meta.json "expressionShapes").</summary>
        public static readonly HashSet<string> ExpressionShapes = new HashSet<string>();
        static readonly HashSet<string> KnownBase = new HashSet<string> { "Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Ear_L", "Part_Ear_R", "Part_Eye_L", "Part_Eye_R" };

        static PersonCatalog instance;
        public static PersonCatalog Get(CharacterKit kit)
        {
            if (instance == null && kit != null)
            {
                try { instance = new PersonCatalog(kit); }
                catch (Exception e) { Debug.LogError("PersonCatalog: " + e); }
            }
            return instance;
        }

        static string[] Strs(JToken t)
        {
            if (t == null || t.Type != JTokenType.Array) return EmptyList;
            var l = new List<string>();
            foreach (var x in t) l.Add((string)x);
            return l.ToArray();
        }

        static Color Hex(string s, Color fallback) => !string.IsNullOrEmpty(s) && ColorUtility.TryParseHtmlString(s, out var c) ? c : fallback;

        PersonCatalog(CharacterKit kit)
        {
            // ---- parts
            var pm = JObject.Parse(kit.partsManifest.text);
            foreach (var j in (JArray)pm["parts"])
            {
                var p = new PartEntry
                {
                    id = (string)j["id"], category = (string)j["category"], name = (string)j["name"], file = (string)j["file"], texture = (string)j["texture"],
                    tags = Strs(j["tags"]), species = Strs(j["species"]), sexes = Strs(j["sexes"]), ages = Strs(j["ages"]), meshObjects = Strs(j["meshObjects"]),
                    decal = j["decal"] != null && (bool)j["decal"],
                };
                if (j["textures"] is JObject to) foreach (var kv in to) p.textures[kv.Key] = (string)kv.Value;
                p.teethMesh = j["teethMesh"] != null && j["teethMesh"].Type == JTokenType.String ? (string)j["teethMesh"] : null;
                p.kind = j["kind"] != null && j["kind"].Type == JTokenType.String ? (string)j["kind"] : null;
                if (j["hat"] is JObject hat)
                {
                    p.hatCompatible = hat["compatible"] == null || (bool)hat["compatible"];
                    p.hatVariant = hat["variant"] != null && hat["variant"].Type != JTokenType.Null ? (string)hat["variant"] : null;
                }
                if (j["colourSlots"] is JArray cs && cs.Count > 0) p.defaultColour = (string)cs[0]["default"];
                if (!parts.TryGetValue(p.category, out var list)) parts[p.category] = list = new List<PartEntry>();
                list.Add(p);
                partById[p.id] = p;
            }
            if (parts.TryGetValue("mouthParts", out var mp)) mouthParts.AddRange(mp);
            foreach (var kind in new[] { "hair", "eyes", "eyebrows", "mouths", "noses", "ears", "beards" }) if (!parts.ContainsKey(kind)) parts[kind] = new List<PartEntry>();
            foreach (var pal in new[] { "hair", "iris", "lips" })
            {
                var target = pal == "hair" ? hairPalette : pal == "iris" ? irisPalette : lipPalette;
                foreach (var kv in (JObject)pm["palettes"][pal]) target[kv.Key] = Hex((string)kv.Value, Color.gray);
            }

            // ---- clothes
            var cm = JObject.Parse(kit.clothesManifest.text);
            foreach (var j in (JArray)cm["pieces"])
            {
                var c = new ClothPiece
                {
                    id = (string)j["id"], slot = (string)j["slot"], layer = (string)j["layer"], obj = (string)j["object"], file = (string)j["file"],
                    hides = Strs(j["hides"]), cultures = Strs(j["cultures"]), classes = Strs(j["classes"]), ages = Strs(j["ages"]), sexes = Strs(j["sexes"]),
                    species = Strs(j["species"]), materials = Strs(j["materials"]),
                };
                pieces[c.id] = c;
            }
            foreach (var j in (JArray)cm["outfits"])
                outfits.Add(new Outfit { id = (string)j["id"], cls = (string)j["class"], culture = (string)j["culture"], sex = (string)j["sex"], age = (string)j["age"], pieces = Strs(j["pieces"]), tint = Hex((string)j["tint"], new Color(0.5f, 0.45f, 0.4f)), trim = Hex((string)j["trim"], new Color(0.7f, 0.55f, 0.3f)) });

            // ---- species
            var sp = JObject.Parse(kit.speciesPresets.text);
            foreach (var kv in sp)
            {
                var j = (JObject)kv.Value;
                var s = new SpeciesPreset { id = kv.Key, rootScaleM = (float)j["rootScaleM"], rootScaleF = (float)j["rootScaleF"], heightM = (float)j["heightM"], heightF = (float)j["heightF"] };
                foreach (var sh in (JObject)j["shapes"]) s.shapes[sh.Key] = (float)sh.Value;
                var skin = new List<Color>();
                foreach (var c in (JArray)j["skin"]) skin.Add(new Color((float)c[0], (float)c[1], (float)c[2]));
                s.skin = skin.ToArray();
                var pp = (JObject)j["parts"];
                s.ears = Strs(pp["ears"]); s.earVariants = Strs(pp["earVariants"]); s.extra = Strs(pp["extra"]); s.tuskVariants = Strs(pp["tuskVariants"]);
                var nose = Strs(pp["nose"]); s.nose = nose.Length > 0 ? nose[0] : "Part_Nose";
                species[s.id] = s;
            }

            // ---- extra default parts of the base body (new face parts appear here without code changes)
            if (kit.baseMeta != null)
            {
                var bm = JObject.Parse(kit.baseMeta.text);
                if (bm["parts"] is JObject bp) foreach (var kv in bp) if (!KnownBase.Contains(kv.Key)) baseExtra.Add(kv.Key);
                foreach (var e in Strs(bm["eyeParts"])) eyeParts.Add(e);
                foreach (var e in Strs(bm["expressionShapes"])) ExpressionShapes.Add(e);
            }

            // ---- joint offsets (Blender axes -> Unity: (-x, z, -y))
            var jo = JObject.Parse(kit.jointOffsets.text);
            foreach (var shape in (JObject)jo["offsets"])
            {
                var d = new Dictionary<string, Vector3>();
                foreach (var bone in (JObject)shape.Value) { var a = (JArray)bone.Value; d[bone.Key] = new Vector3(-(float)a[0], (float)a[2], -(float)a[1]); }
                jointOffsets[shape.Key] = d;
            }
        }
    }
}
