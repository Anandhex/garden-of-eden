// Everything the runtime person builder needs, referenced from one asset in Resources (built by the editor menu
// "Garden of Eden > Build Character System", see Editor/CharacterImport.cs): the FBX files of the Blender character system
// (base body, swappable parts, clothes), their JSON manifests, the cloth detail texture array, the shared materials, the shared
// Humanoid controller, and one prefab per creature.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;

namespace GardenOfEden.World
{
    public sealed class CharacterKit : ScriptableObject
    {
        public const string ResourceName = "CharacterKit";

        [Serializable] public struct FbxRef { public string key; public GameObject fbx; }

        public List<FbxRef> fbx = new List<FbxRef>();
        public TextAsset partsManifest, clothesManifest, speciesPresets, jointOffsets, baseMeta;
        /// <summary>The 55 Humanoid bones only (no meshes), Animator with the base avatar. Cloned for every person.</summary>
        public GameObject rigPrefab;
        public Avatar baseAvatar;
        public RuntimeAnimatorController peopleController;
        public Texture2DArray detailArray;
        public Material clothMaterial, skinTemplate, hairTemplate;
        /// <summary>The skin texture set from the art pipeline (shared atlas UVs), or null until it exists: normal map, mask (R roughness, G AO/cavity).</summary>
        public Texture2D skinNormal, skinMask;
        [Serializable] public struct SkinTone { public string id; public Color baseColour; public Texture2D albedo; }
        /// <summary>Head albedo per skin tone (skin_tones.json), the shader divides by baseColour so each person keeps their colour.</summary>
        public List<SkinTone> skinTones = new List<SkinTone>();
        public float walkSpeed = 1.4f, runSpeed = 4f;
        public List<CharacterBody> creatures = new List<CharacterBody>();

        static CharacterKit instance;
        static bool loaded;
        Dictionary<string, GameObject> byKey;
        Dictionary<string, CharacterBody> creatureById;

        public static CharacterKit Instance
        {
            get
            {
                if (!loaded || instance == null) { loaded = true; instance = Resources.Load<CharacterKit>(ResourceName); }
                return instance;
            }
        }

        public bool Ready => rigPrefab != null && baseAvatar != null && peopleController != null && clothMaterial != null && skinTemplate != null && Fbx("base_body") != null;

        public GameObject Fbx(string key)
        {
            if (byKey == null)
            {
                byKey = new Dictionary<string, GameObject>();
                foreach (var f in fbx) if (f.fbx != null) byKey[f.key] = f.fbx;
            }
            return byKey.TryGetValue(key, out var g) ? g : null;
        }

        public bool TryCreature(string id, out CharacterBody body)
        {
            if (creatureById == null)
            {
                creatureById = new Dictionary<string, CharacterBody>();
                foreach (var c in creatures) if (c != null && c.prefab != null) creatureById[c.id] = c;
            }
            return creatureById.TryGetValue(id ?? "", out body);
        }
    }
}
