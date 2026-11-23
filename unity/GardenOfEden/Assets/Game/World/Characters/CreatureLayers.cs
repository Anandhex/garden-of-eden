// The generated tail and wing layers of the Blender monsters. The humanoid clips drive the 55 shared bones; the extra bones
// (Tail1..n, Wing_*) have no clip in a Humanoid rig, so this adds a small procedural sway on top in LateUpdate, scaled by how
// fast the creature moves (a lazy swish when still, a stronger lash when running; wings fold at rest and flap now and then).
using System.Collections.Generic;
using UnityEngine;

namespace GardenOfEden.World
{
    public sealed class CreatureLayers : MonoBehaviour
    {
        struct Seg { public Transform t; public Quaternion rest; public float phase, amp; public Vector3 axis; }
        readonly List<Seg> segs = new List<Seg>();
        float clock, speed;
        bool built;
        ArmRelax arms;

        /// <summary>Ground speed in m/s, set by the puppet each frame.</summary>
        public void SetSpeed(float s) { speed = s; }

        void Build()
        {
            built = true;
            var an = GetComponent<Animator>();
            if (an != null && an.isHuman) arms = new ArmRelax(transform, null);
            float seed = (Mathf.Abs(transform.root.GetInstanceID()) % 997) / 997f * 6.28f;
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                string n = t.name;
                if (n.StartsWith("Tail") && n.Length <= 6)
                {
                    int k = n.Length > 4 && char.IsDigit(n[4]) ? n[4] - '0' : 1;
                    segs.Add(new Seg { t = t, rest = t.localRotation, phase = seed - k * 0.55f, amp = 7f + k * 2f, axis = Vector3.up });
                }
                else if (n.StartsWith("Wing_") && !n.Contains("Hand"))
                {
                    bool left = n.EndsWith("L") || n.EndsWith("_L");
                    segs.Add(new Seg { t = t, rest = t.localRotation, phase = seed, amp = n.Contains("Upper") ? 14f : 8f, axis = left ? Vector3.forward : Vector3.back });
                }
            }
        }

        void LateUpdate()
        {
            if (!built) Build();
            if (arms != null) arms.Apply(transform);
            if (segs.Count == 0) return;
            clock += Time.deltaTime;
            float moving = Mathf.Clamp01(speed / 2f);
            foreach (var s in segs)
            {
                if (s.t == null) continue;
                bool wing = s.t.name.StartsWith("Wing");
                float f = wing ? 2.2f + moving * 2f : 1.4f + moving * 2.2f;
                float a = s.amp * (wing ? 0.35f + moving * 0.6f : 0.55f + moving * 0.9f);
                float ang = Mathf.Sin(clock * f + s.phase) * a;
                s.t.localRotation = s.rest * Quaternion.AngleAxis(ang, s.axis);
            }
        }
    }
}
