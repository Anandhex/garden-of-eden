// Input -> intents. The server owns the rules and moves the player in tiles; this class only turns "I hold W with the
// camera facing here" into the nearest of the 8 tile directions and sends `step` at the avatar's walking pace
// (never faster than Mirror.stepMs), and forwards
// E / F / R / Esc as interact / fight / flee / close-or-cancel. No pathfinding, no reach checks, no game text.
using GardenOfEden.Net;
using GardenOfEden.World;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GardenOfEden.Play
{
    public class PlayerControl : MonoBehaviour
    {
        public GameClient client;
        public WorldView world;
        public CameraRig cameraRig;
        public Hud hud;
        public Camera cam;

        [Header("Movement")]
        [Tooltip("Stick/keys below this are ignored.")]
        public float deadZone = 0.3f;
        [Tooltip("Send the next step when this fraction of the avatar's walk to the current tile is done (a little under 1 keeps it walking without a pause).")]
        [Range(0.5f, 1.5f)] public float cadenceFactor = 0.9f;
        public float minStepSeconds = 0.05f;

        PlayInput input;
        float nextStep;

        void Start()
        {
            input = PlayInput.Get();
            if (client == null) client = FindFirstObjectByType<GameClient>();
            if (world == null) world = FindFirstObjectByType<WorldView>();
            if (cameraRig == null) cameraRig = FindFirstObjectByType<CameraRig>();
            if (hud == null) hud = FindFirstObjectByType<Hud>();
            if (cam == null) cam = Camera.main;
        }

        void Update()
        {
            if (client == null || input == null || input.Move == null) return;
            bool typing = hud != null && hud.IsTyping;
            bool blocked = hud != null && hud.BlocksGameInput;

            // Escape: leave the text box, else close what's open, else close the chat, else cancel a walk.
            if (input.Cancel.WasPressedThisFrame())
            {
                if (typing) hud.Blur();
                else if (hud != null && hud.HandleCancel()) { }
                else if (client.Mirror.ui != null && client.Mirror.ui.chat != null && client.Mirror.ui.chat.open) client.Send(Intents.Close());
                else client.Send(Intents.Cancel());
            }
            if (typing || blocked) { nextStep = 0f; return; }

            if (input.Interact.WasPressedThisFrame()) client.Send(Intents.Interact());
            if (input.Fight.WasPressedThisFrame()) client.Send(Intents.Fight());
            if (input.Flee.WasPressedThisFrame()) client.Send(Intents.Flee());

            HandleMovement();
        }

        // ---------- movement ----------

        void HandleMovement()
        {
            Vector2 m = input.Move.ReadValue<Vector2>();
            if (m.magnitude < deadZone) { nextStep = 0f; return; }
            if (Time.unscaledTime < nextStep) return;
            if (!TryTileStep(m, out int dx, out int dy)) return;
            client.Send(Intents.Step(dx, dy));
            // One tile takes 1 / pace seconds to walk on screen; send the next step a little before the avatar gets there
            // (cadenceFactor < 1) so it never stops between tiles, and never faster than the server accepts (stepMs).
            float pace = world != null ? world.WalkTilesPerSecond(true, "player") : 1000f / Mathf.Max(30f, (float)client.Mirror.stepMs);
            float stepSeconds = Mathf.Max((float)client.Mirror.stepMs / 1000f, cadenceFactor / pace);
            nextStep = Time.unscaledTime + Mathf.Max(minStepSeconds, stepSeconds);
        }

        /// <summary>The ground direction (x, z) of tile steps (1,0) and (0,1), measured from WorldView so no axis convention is assumed here.</summary>
        static void Basis(out Vector2 ex, out Vector2 ey)
        {
            Vector3 o = WorldView.TileToWorld(0f, 0f, 0f);
            Vector3 a = WorldView.TileToWorld(1f, 0f, 0f) - o;
            Vector3 b = WorldView.TileToWorld(0f, 1f, 0f) - o;
            ex = new Vector2(a.x, a.z);
            ey = new Vector2(b.x, b.z);
        }

        bool TryTileStep(Vector2 move, out int dx, out int dy)
        {
            dx = dy = 0;
            float camYaw = cameraRig != null ? cameraRig.Yaw : (cam != null ? cam.transform.eulerAngles.y : 0f);
            float yaw = camYaw * Mathf.Deg2Rad;
            Vector2 fwd = new Vector2(Mathf.Sin(yaw), Mathf.Cos(yaw));
            Vector2 right = new Vector2(Mathf.Cos(yaw), -Mathf.Sin(yaw));
            Vector2 want = right * move.x + fwd * move.y;
            if (want.sqrMagnitude < 1e-6f) return false;
            want.Normalize();

            Basis(out var ex, out var ey);
            float best = 0.3f; // some agreement is needed or we don't step
            bool found = false;
            for (int ix = -1; ix <= 1; ix++)
            {
                for (int iy = -1; iy <= 1; iy++)
                {
                    if (ix == 0 && iy == 0) continue;
                    Vector2 w = ex * ix + ey * iy;
                    if (w.sqrMagnitude < 1e-6f) continue;
                    float dot = Vector2.Dot(w.normalized, want);
                    if (dot > best) { best = dot; dx = ix; dy = iy; found = true; }
                }
            }
            return found;
        }
    }
}
