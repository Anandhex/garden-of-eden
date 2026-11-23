// The living face of a built person: blinks every few seconds and moves the jaw (and visemes, when the art has them) while the
// person talks (Speaking: NPC speech, chatter lines, gossip). Runs after the Animator (LateUpdate), so it layers on any clip.
//   Blink: live blend shapes named *blink* / Eyes_Closed* when the base head has them; otherwise the skin shader's _Blink, which
//     paints the eyeballs with the lid's skin for a moment (the current head has sculpted, unrigged lids).
//   Jaw: the Jaw bone opens a few degrees around the head's side axis in a syllable rhythm (lower face weights follow it).
//   Visemes: live blend shapes named Viseme_* / V_* / Mouth_Open are cycled with the same rhythm.
using System.Collections.Generic;
using UnityEngine;

namespace GardenOfEden.World
{
    /// <summary>
    /// The shared KayKit clips hold the arms well out from the sides (made for chunky bodies); on our slender bodies that reads as a
    /// scarecrow. After the Animator, the upper arms are turned down by Degrees about the body's forward axis, so every clip keeps its
    /// motion with relaxed arms. Skipped when the Animator did not write the bones this frame (culled), so it never accumulates.
    /// </summary>
    public sealed class ArmRelax
    {
        public static float Degrees = 28f;
        readonly Transform left, right;
        Quaternion lastL, lastR;
        public ArmRelax(Transform root, Transform[] bones)
        {
            foreach (var t in bones ?? root.GetComponentsInChildren<Transform>(true)) { if (t.name == "LeftUpperArm") left = t; else if (t.name == "RightUpperArm") right = t; }
        }
        public void Apply(Transform root)
        {
            if (left == null || right == null || Degrees == 0f) return;
            if (left.rotation == lastL && right.rotation == lastR) return;   // the Animator did not write them: already relaxed
            var f = root.forward;
            left.rotation = Quaternion.AngleAxis(Degrees, f) * left.rotation;
            right.rotation = Quaternion.AngleAxis(-Degrees, f) * right.rotation;
            lastL = left.rotation; lastR = right.rotation;
        }
    }

    public sealed class PersonFace : MonoBehaviour
    {
        static readonly int BlinkId = Shader.PropertyToID("_Blink");
        public static float MaxJawDegrees = 7f;   // modest while the head has closed sculpted lips; raise once the lip slit lands

        string actorId;
        SkinnedMeshRenderer smr;
        Material skin;
        Transform jaw;
        Quaternion jawRest;
        Vector3 jawAxis;
        readonly List<int> blinkShapes = new List<int>(), visemes = new List<int>();
        int openShape = -1;
        float nextBlink, blinkT = -1f, seed, open, lastBlink;
        bool usesShapes;
        ArmRelax arms;

        public void Init(BuiltPerson b, SkinnedMeshRenderer renderer, Transform[] bones)
        {
            actorId = b.recipe != null ? b.recipe.spec.id : null;
            smr = renderer;
            skin = b.skinMat;
            seed = (Hash.Str(actorId ?? "x") % 1000) / 1000f;
            foreach (var t in bones) if (t.name == "Jaw") { jaw = t; break; }
            if (jaw != null)
            {
                jawRest = jaw.localRotation;
                // the opening axis: the character's side (+X, it faces +Z) in the jaw's own space, from the rig's rest pose
                jawAxis = Quaternion.Inverse(jaw.rotation) * transform.TransformDirection(Vector3.right);
            }
            foreach (var kv in b.liveShapes)
            {
                string l = kv.Key.ToLowerInvariant();
                if (l.Contains("blink") || l.Contains("closed") || l.StartsWith("lid_close")) blinkShapes.Add(kv.Value);
                else if (l == "mouth_open" || l == "jaw_open") openShape = kv.Value;
                else if (l.StartsWith("viseme") || l.StartsWith("v_") || l == "mouth_o" || l == "mouth_e" || l == "mouth_mbp") visemes.Add(kv.Value);
                // other expressions (smile, frown, brows, squint, cheek puff) stay at rest for now
            }
            usesShapes = blinkShapes.Count > 0;
            arms = new ArmRelax(transform, bones);
            nextBlink = Time.time + 0.5f + seed * 3f;
        }

        void LateUpdate()
        {
            arms.Apply(transform);
            float now = Time.time, dt = Time.deltaTime;
            // ---- blink: a quick close-open (0.14 s), every 2..6 s, sometimes a double blink
            if (blinkT < 0f && now >= nextBlink)
            {
                blinkT = 0f;
                float r = Mathf.Repeat(seed * 7.13f + now * 0.37f, 1f);
                nextBlink = now + 2f + r * 4f;
                if (r < 0.12f) nextBlink = now + 0.32f;
            }
            float lid = 0f;
            if (blinkT >= 0f)
            {
                blinkT += dt;
                const float dur = 0.14f;
                lid = blinkT < dur * 0.45f ? blinkT / (dur * 0.45f) : 1f - (blinkT - dur * 0.45f) / (dur * 0.55f);
                lid = Mathf.Clamp01(lid);
                if (blinkT >= dur) { blinkT = -1f; lid = 0f; }
            }
            if (lid != lastBlink)
            {
                lastBlink = lid;
                if (usesShapes) foreach (var i in blinkShapes) smr.SetBlendShapeWeight(i, lid * 100f);
                else if (skin != null) skin.SetFloat(BlinkId, lid > 0.35f ? 1f : 0f);
            }

            // ---- talking: a syllable rhythm (two incommensurate sines, gated), eased
            float talking = Speaking.Talking(actorId);
            float target = 0f;
            if (talking >= 0f)
            {
                float t = now * 1f + seed * 10f;
                float syl = Mathf.Sin(t * 13.1f) * 0.5f + 0.5f;
                float mod = Mathf.Sin(t * 3.7f + 1.3f) * 0.5f + 0.5f;
                target = Mathf.Clamp01(syl * (0.35f + 0.65f * mod));
                if (Mathf.Sin(t * 1.9f) > 0.85f) target *= 0.2f;   // little pauses between words
            }
            open = Mathf.MoveTowards(open, target, dt * 9f);
            if (jaw != null) jaw.localRotation = jawRest * Quaternion.AngleAxis(open * MaxJawDegrees, jawAxis);
            if (openShape >= 0) smr.SetBlendShapeWeight(openShape, open * 100f);
            if (visemes.Count > 0)
            {
                int k = talking >= 0f ? (int)Mathf.Repeat(Mathf.Floor(now * 7f + seed * 13f), visemes.Count) : -1;
                for (int i = 0; i < visemes.Count; i++) smr.SetBlendShapeWeight(visemes[i], i == k ? open * 100f : 0f);
            }
        }
    }
}
