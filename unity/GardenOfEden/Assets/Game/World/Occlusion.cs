// Keeps the player visible when a building is in the way (World side; Play/CameraRig also pulls the camera in front of walls).
//  1. Any building near the line from the camera to the player is dither-faded (ToonLit _Fade, per renderer through a
//     MaterialPropertyBlock; cleared at zero so unaffected buildings stay SRP-batched).
//  2. While the player is inside a building, the walls on the camera side are dithered away (ToonLit _CutPlane), on top
//     of the roof/upper-floor hiding WorldView already does.
//  3. The player's renderers are put on the "Player" layer; a URP Render Objects feature ("PlayerSilhouette", added by
//     SceneBootstrap) redraws that layer behind walls as a soft tinted shape. This component drives its strength through
//     the global _SilhouetteOn.
using System.Collections.Generic;
using UnityEngine;

namespace GardenOfEden.World
{
    [DefaultExecutionOrder(200)]
    public sealed class Occlusion : MonoBehaviour
    {
        public WorldView world;
        public Camera cam;
        [Range(0f, 1f)] public float fadeAmount = 0.82f;
        [Tooltip("How far (metres) beside the camera-player line a building still counts as in the way.")]
        public float lineRadius = 0.35f;
        public float fadeSpeed = 6f;
        public float playerHeight = 1.3f;

        static readonly int SilhouetteOn = Shader.PropertyToID("_SilhouetteOn");
        float silhouette;
        Transform playerRoot;
        int lastRenderers = -1, nextCheck;
        public bool PlayerOccluded { get; private set; }

        void Start()
        {
            if (world == null) world = FindFirstObjectByType<WorldView>();
            if (cam == null) cam = Camera.main;
        }

        void OnDisable() => Shader.SetGlobalFloat(SilhouetteOn, 0f);

        void LateUpdate()
        {
            if (world == null || cam == null || world.Buildings == null) return;
            float dt = Time.unscaledDeltaTime;
            string id = world.PlayerActorId;
            Transform t = null;
            if (string.IsNullOrEmpty(id) || !world.TryGetActor(id, out t) || t == null) { Shader.SetGlobalFloat(SilhouetteOn, 0f); return; }
            if (t != playerRoot) { playerRoot = t; lastRenderers = -1; }
            if (Time.frameCount >= nextCheck) { nextCheck = Time.frameCount + 20; TagPlayerLayer(t); }

            Vector3 head = t.position + Vector3.up * playerHeight;
            Vector3 camPos = cam.transform.position;
            Vector3 seg = head - camPos;
            float segLen = seg.magnitude;
            Ray ray = new Ray(camPos, segLen > 0.001f ? seg / segLen : Vector3.forward);
            Vector3 toCam = camPos - head; toCam.y = 0f;
            toCam = toCam.sqrMagnitude > 0.0001f ? toCam.normalized : Vector3.back;
            Vector4 plane = new Vector4(toCam.x, 0f, toCam.z, Vector3.Dot(head, toCam) + 0.7f);

            bool occluded = false;
            float step = fadeSpeed * dt;
            foreach (var v in world.Buildings.views.Values)
            {
                if (v.renderers.Count == 0 || !v.solid) continue;
                float fTarget = 0f, cTarget = 0f;
                if (v.Inside)
                {
                    cTarget = fadeAmount;
                    occluded = true;
                }
                else
                {
                    var b = new Bounds(new Vector3((v.box.x + v.box.z) * 0.5f, (v.top + t.position.y - 1f) * 0.5f, (v.box.y + v.box.w) * 0.5f),
                                       new Vector3(v.box.z - v.box.x + lineRadius * 2f, Mathf.Max(1f, v.top - t.position.y + 1f), v.box.w - v.box.y + lineRadius * 2f));
                    if (b.IntersectRay(ray, out float d) && d < segLen - 0.05f)
                    {
                        fTarget = fadeAmount;
                        occluded = true;   // really between the camera and the player: show the silhouette too
                    }
                    else if (b.Contains(camPos)) fTarget = fadeAmount;   // camera pressed against a wall: just fade it
                }
                float f = Mathf.MoveTowards(v.Fade, fTarget, step);
                float c = Mathf.MoveTowards(v.CutFade, cTarget, step);
                v.SetFade(f, cTarget > 0f ? plane : v.CutPlane, c);
            }
            PlayerOccluded = occluded;
            silhouette = Mathf.MoveTowards(silhouette, occluded ? 1f : 0f, dt * 5f);
            Shader.SetGlobalFloat(SilhouetteOn, silhouette);
        }

        void TagPlayerLayer(Transform root)
        {
            int layer = WorldLayers.Player;
            if (layer == 0) return;
            var rs = root.GetComponentsInChildren<Renderer>(true);
            if (rs.Length == lastRenderers) return;
            lastRenderers = rs.Length;
            foreach (var r in rs)
            {
                if (!(r is SkinnedMeshRenderer) && !(r is MeshRenderer)) continue;
                if (r.GetComponent<TextMesh>() != null) continue;
                r.gameObject.layer = layer;
            }
        }
    }
}
