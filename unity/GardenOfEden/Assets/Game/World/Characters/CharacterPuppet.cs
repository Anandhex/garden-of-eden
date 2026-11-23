// One animated 3D character in the world: the prefab instance, its Animator, and the per-actor look (tint, hair, skin).
// ActorAvatar owns position and facing; this only feeds the Animator (never root motion) and colours the material slots
// with MaterialPropertyBlocks (no material instances, so every townsperson shares the same few materials).
//
// Animator parameters (all controllers built by CharacterSetup have them; a missing one is skipped):
//   Speed (float, m/s, damped)   Dead, Down, Talking, Sitting, Armed (bool)   Wave, Attack, Hit (trigger)
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class CharacterPuppet
    {
        static readonly int pSpeed = Animator.StringToHash("Speed"), pDead = Animator.StringToHash("Dead"), pDown = Animator.StringToHash("Down"),
            pTalking = Animator.StringToHash("Talking"), pSitting = Animator.StringToHash("Sitting"), pArmed = Animator.StringToHash("Armed"),
            pWave = Animator.StringToHash("Wave"), pAttack = Animator.StringToHash("Attack"), pHit = Animator.StringToHash("Hit");
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), ColorId = Shader.PropertyToID("_Color");
        static MaterialPropertyBlock mpb;

        static readonly int[] SkinTones = { 0xf1c9a5, 0xe0ac84, 0xc68863, 0x9a6a47, 0x6f4a32 };
        static readonly int[] HairTones = { 0x2b2118, 0x5a3a22, 0x8a5a2b, 0xc9a24f, 0x8d8d90, 0x3a2a2a, 0x1a1512 };

        public readonly GameObject instance;
        public readonly Animator animator;
        public readonly CharacterBody body;
        public bool IsAnimal => body.kind == BodyKind.Animal;
        /// <summary>The smoothed ground speed (m/s) last fed to the Animator.</summary>
        public float SpeedParam => speed;

        struct Slot { public Renderer r; public int index; public string name; public Color baseColor; }
        readonly List<Slot> slots = new List<Slot>();
        readonly Renderer[] renderers;
        readonly HashSet<int> hasParam = new HashSet<int>();
        readonly float jitter, phase;
        float speed, speedVel, attackAt, waveCooldown, hitAt;
        bool wasEngaged;
        readonly CreatureLayers layers;
        /// <summary>The look is already in the mesh (baked people): ApplyLook does nothing.</summary>
        public bool baked;

        public CharacterPuppet(CharacterBody body, Transform parent, uint seed) : this(body, Object.Instantiate(body.prefab, parent), seed)
        {
            instance.name = body.id;
        }

        /// <summary>A puppet around an instance that is already built and parented (the baked people of PersonFactory, whose scale is set already).</summary>
        public CharacterPuppet(CharacterBody body, GameObject existing, uint seed)
        {
            this.body = body;
            instance = existing;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            layers = instance.GetComponentInChildren<CreatureLayers>(true);
            animator = instance.GetComponentInChildren<Animator>();
            renderers = instance.GetComponentsInChildren<Renderer>(true);
            foreach (var r in renderers)
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    var m = mats[i];
                    if (m == null) continue;
                    string n = m.name;
                    int dot = n.LastIndexOf('.');
                    Color c = m.HasProperty(BaseColorId) ? m.GetColor(BaseColorId) : Color.white;
                    slots.Add(new Slot { r = r, index = i, name = dot >= 0 ? n.Substring(dot + 1) : n, baseColor = c });
                }
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                r.receiveShadows = true;
            }
            jitter = 0.94f + (seed % 1000) / 1000f * 0.12f;
            phase = ((seed >> 5) % 1000) / 1000f;
            if (animator != null)
            {
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                foreach (var p in animator.parameters) hasParam.Add(p.nameHash);
                // Crowds must not breathe in step: start the idle loop at a different point for everyone.
                animator.Play("Locomotion", 0, phase);
                animator.speed = jitter;
                animator.Update(0f);
                if (hasParam.Contains(pArmed)) animator.SetBool(pArmed, body.armed);
            }
        }

        static void Paint(Renderer r, int index, Color c)
        {
            if (mpb == null) mpb = new MaterialPropertyBlock();
            mpb.Clear();
            mpb.SetColor(BaseColorId, c);
            mpb.SetColor(ColorId, c);
            r.SetPropertyBlock(mpb, index);
        }

        static bool Has(string[] names, string n)
        {
            for (int i = 0; i < names.Length; i++) if (names[i] == n) return true;
            return false;
        }

        /// <summary>Clothes from look.tint, trim as an accent, hair and skin from the actor id.</summary>
        public void ApplyLook(Actor a, uint seed)
        {
            if (baked) return;
            Color tint = ActorModels.ParseTint(a.look != null ? a.look.tint : null, seed);
            bool lowborn = a.HasFlag(ActorFlag.Lowborn);
            if (lowborn) tint = Color.Lerp(tint, Pal.Rgb(0x8a7a62), 0.5f);
            bool hasTrim = a.look != null && !string.IsNullOrEmpty(a.look.trim);
            Color trim = hasTrim ? ActorModels.ParseTint(a.look.trim, seed) : Pal.Mul(tint, 0.6f);
            Color pants = Color.Lerp(Pal.Mul(tint, 0.45f), Pal.Rgb(0x6a5440), 0.55f);
            Color skin = Pal.Rgb(SkinTones[(seed >> 3) % SkinTones.Length]);
            Color hair = Pal.Rgb(HairTones[(seed >> 7) % HairTones.Length]);
            if (IsAnimal)
            {
                // Animals keep their own colours; an explicit tint from the server recolours the main coat only.
                if (a.look != null && !string.IsNullOrEmpty(a.look.tint))
                    foreach (var s in slots)
                        if (s.name == "Main" || (s.r != null && s.r.name.EndsWith("_Body"))) Paint(s.r, s.index, Color.Lerp(s.baseColor, tint, 0.35f));
                return;
            }
            foreach (var s in slots)
            {
                if (Has(body.clothes, s.name)) Paint(s.r, s.index, tint);
                else if (Has(body.pants, s.name)) Paint(s.r, s.index, pants);
                else if (Has(body.trim, s.name)) Paint(s.r, s.index, trim);
                else if (Has(body.hair, s.name)) Paint(s.r, s.index, hair);
                else if (Has(body.skin, s.name)) Paint(s.r, s.index, s.name.Contains("Darker") ? Pal.Mul(skin, 0.9f) : skin);
            }
            if (body.tintRenderers.Length > 0)
            {
                foreach (var r in renderers)
                {
                    string rn = r.name;
                    if (rn.Contains("Cape")) { for (int i = 0; i < r.sharedMaterials.Length; i++) Paint(r, i, Color.Lerp(Color.white, hasTrim ? trim : tint, 0.75f)); continue; }
                    foreach (var token in body.tintRenderers)
                        if (rn.Contains(token)) { for (int i = 0; i < r.sharedMaterials.Length; i++) Paint(r, i, Color.Lerp(Color.white, tint, 0.45f)); break; }
                }
            }
        }

        /// <summary>
        /// Feed the Animator. groundSpeed is the actual smoothed velocity in m/s. Returns nothing; all state is in the Animator.
        /// </summary>
        public void Tick(float dt, float groundSpeed, Actor a, bool promptTarget, string promptTone)
        {
            if (animator == null || !animator.isActiveAndEnabled || dt <= 0f) return;
            speed = Mathf.SmoothDamp(speed, groundSpeed, ref speedVel, 0.12f, Mathf.Infinity, dt);
            if (speed < 0.02f && groundSpeed < 0.02f) speed = 0f;
            // A body bigger or smaller than the clips' 1.75 m human strides further or shorter: feed the blend tree the speed it would have at that size.
            float scale = Mathf.Max(0.2f, body.bodyScale);
            float nspeed = speed / scale;
            animator.SetFloat(pSpeed, nspeed);
            if (layers != null) layers.SetSpeed(speed);

            bool dead = a.HasFlag(ActorFlag.Dead), down = a.HasFlag(ActorFlag.Unconscious);
            bool engaged = a.HasFlag(ActorFlag.Engaged) && !dead && !down;
            bool talking = (a.HasFlag(ActorFlag.Busy) || Speaking.Talking(a.id) >= 0f) && !engaged && !dead && !down && !a.HasFlag(ActorFlag.Hostile) && groundSpeed < 0.05f;
            Set(pDead, dead);
            Set(pDown, down && !dead);
            Set(pTalking, talking);

            // Keep the feet planted: past the fastest clip, play it faster; below the walk threshold the blend tree does the rest.
            float rate = jitter;
            float top = Mathf.Max(0.1f, body.runSpeed);
            if (nspeed > top) rate *= nspeed / top;
            animator.speed = Mathf.Clamp(rate, 0.5f, 2.2f);

            // Fights: swing now and then while engaged, flinch in between.
            if (engaged)
            {
                if (!wasEngaged) { attackAt = Time.time + 0.4f + Random.value * 0.8f; hitAt = Time.time + 1.6f + Random.value * 1.5f; }
                if (speed < 0.3f && Time.time >= attackAt) { Trigger(pAttack); attackAt = Time.time + 1.3f + Random.value * 1.6f; }
                if (Time.time >= hitAt) { Trigger(pHit); hitAt = Time.time + 2.5f + Random.value * 3f; }
            }
            wasEngaged = engaged;

            // Greeting: someone you are about to talk to waves once (not in a fight, not the hostile ones).
            if (waveCooldown > 0f) waveCooldown -= dt;
            if (promptTarget && promptTone == "talk" && waveCooldown <= 0f && !engaged && !dead && !down && speed < 0.2f && !a.HasFlag(ActorFlag.Hostile))
            {
                Trigger(pWave);
                waveCooldown = 25f;
            }
        }

        void Set(int hash, bool v) { if (hasParam.Contains(hash)) animator.SetBool(hash, v); }
        void Trigger(int hash) { if (hasParam.Contains(hash)) animator.SetTrigger(hash); }
    }
}
