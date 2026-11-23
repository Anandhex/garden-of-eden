// Maps art ids to real prefabs. Create one (Assets > Create > Garden of Eden > Prop Manifest) and drag it onto WorldView.
// An id with no entry (or an entry with a null prefab) is drawn by the procedural builders. Keys:
//   props/tree, props/rock, buildings/wall ... any id in ArtIds (object ids)
//   people/body, people/player, creature/wolf, fx/grave ... (actors: the prefab replaces the procedural body)
//   building/<kind> e.g. building/inn, building/house, building/smithy (a whole building, see fitFootprint)
using System;
using System.Collections.Generic;
using UnityEngine;

namespace GardenOfEden.World
{
    [CreateAssetMenu(menuName = "Garden of Eden/Prop Manifest", fileName = "PropManifest")]
    public class PropManifest : ScriptableObject
    {
        [Serializable]
        public class Entry
        {
            [Tooltip("An art id (props/tree) or building/<kind>.")]
            public string artId;
            [Tooltip("Null = keep the procedural one.")]
            public GameObject prefab;
            public float scale = 1f;
            public Vector3 offset;
            [Tooltip("Props only: spin each instance randomly about the vertical.")]
            public bool randomYaw = true;
            [Tooltip("Buildings only: stretch the prefab's X/Z bounds to the footprint.")]
            public bool fitFootprint;
        }

        public List<Entry> entries = new List<Entry>();

        Dictionary<string, Entry> index;

        void OnEnable() => index = null;
        void OnValidate() => index = null;

        public bool TryGet(string artId, out Entry entry)
        {
            entry = null;
            if (string.IsNullOrEmpty(artId)) return false;
            if (index == null)
            {
                index = new Dictionary<string, Entry>();
                foreach (var e in entries) if (e != null && !string.IsNullOrEmpty(e.artId) && e.prefab != null) index[e.artId] = e;
            }
            return index.TryGetValue(artId, out entry);
        }
    }
}
