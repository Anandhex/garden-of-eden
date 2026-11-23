// Third-person orbit camera that follows the player's actor. One zoom value (0..1) drives distance, pitch and focus
// height along a single curve: 0 is a close over-the-shoulder street-level view, 1 is a high tilted overview.
// Right mouse (held) or the right stick orbits; the scroll wheel zooms. The camera never goes under the terrain.
using GardenOfEden.World;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GardenOfEden.Play
{
    [DefaultExecutionOrder(100)]
    public class CameraRig : MonoBehaviour
    {
        public WorldView world;
        [Tooltip("The camera to drive. Defaults to the one on this object, else Camera.main.")]
        public Camera cam;

        [Header("Zoom curve")]
        public float closeDistance = 3.8f;
        public float farDistance = 40f;
        public float closePitch = 12f;
        public float farPitch = 55f;
        [Tooltip("Height above the actor's feet the camera looks at.")]
        public float closeFocusHeight = 1.45f;
        public float farFocusHeight = 0.5f;
        [Range(0f, 1f)] public float startZoom = 0.2f;
        public float zoomPerNotch = 0.06f;
        public float zoomSmoothing = 10f;

        [Header("Orbit")]
        public float startYaw = 45f;
        public float mouseDegreesPerPixel = 0.12f;
        public float stickDegreesPerSecond = 120f;
        public float minPitchOffset = -8f;
        public float maxPitchOffset = 25f;
        public bool invertY;

        [Header("Follow and collision")]
        public float followSmoothTime = 0.12f;
        public float rotationSmoothing = 14f;
        public float groundClearance = 0.6f;
        [Tooltip("Radius of the sphere swept from the player to the camera against building colliders.")]
        public float collisionRadius = 0.3f;
        [Tooltip("The camera never comes closer than this to the focus point because of a wall.")]
        public float minCollisionDistance = 1.4f;
        public float pullInTime = 0.06f, pushOutTime = 0.35f;

        float yaw, pitchOffset, zoom, zoomTarget;
        float smoothYaw, smoothZoom;
        Vector3 focus, focusVel;
        float boom = -1f, boomVel;
        bool haveFocus;
        bool orbiting;
        PlayInput input;

        /// <summary>The camera's yaw in degrees (movement input is relative to this).</summary>
        public float Yaw => smoothYaw;
        public bool Orbiting => orbiting;

        void Awake()
        {
            if (cam == null) cam = GetComponent<Camera>();
            if (cam == null) cam = Camera.main;
            yaw = smoothYaw = startYaw;
            zoom = zoomTarget = smoothZoom = startZoom;
        }

        void Start()
        {
            input = PlayInput.Get();
            if (world == null) world = FindFirstObjectByType<WorldView>();
        }

        void OnDisable() => SetOrbiting(false);

        void SetOrbiting(bool on)
        {
            if (orbiting == on) return;
            orbiting = on;
            Cursor.lockState = on ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !on;
        }

        void LateUpdate()
        {
            if (cam == null || world == null || input == null || input.Look == null) return;
            float dt = Time.unscaledDeltaTime;

            var mouse = Mouse.current;
            bool rmb = mouse != null && mouse.rightButton.isPressed;
            SetOrbiting(rmb);

            if (rmb && mouse != null)
            {
                // The Look action also carries the right stick; with the mouse held only count mouse pixels.
                Vector2 d = mouse.delta.ReadValue();
                yaw += d.x * mouseDegreesPerPixel;
                pitchOffset += d.y * mouseDegreesPerPixel * (invertY ? 1f : -1f);
            }
            var pad = Gamepad.current;
            if (pad != null)
            {
                Vector2 s = pad.rightStick.ReadValue();
                if (s.sqrMagnitude > 0.04f)
                {
                    yaw += s.x * stickDegreesPerSecond * dt;
                    pitchOffset += s.y * stickDegreesPerSecond * 0.6f * dt * (invertY ? 1f : -1f);
                }
            }
            pitchOffset = Mathf.Clamp(pitchOffset, minPitchOffset, maxPitchOffset);

            float scroll = input.Zoom.ReadValue<float>();
            if (Mathf.Abs(scroll) > 0.0001f)
            {
                // Mice report +-1 per notch on some platforms and +-120 on others.
                if (Mathf.Abs(scroll) > 10f) scroll /= 120f;
                // Scroll up = zoom in.
                zoomTarget = Mathf.Clamp01(zoomTarget - Mathf.Clamp(scroll, -3f, 3f) * zoomPerNotch);
            }

            float k = 1f - Mathf.Exp(-zoomSmoothing * dt);
            smoothZoom = Mathf.Lerp(smoothZoom, zoomTarget, k);
            smoothYaw = Mathf.LerpAngle(smoothYaw, yaw, 1f - Mathf.Exp(-rotationSmoothing * dt));

            // Follow the player actor.
            string id = world.PlayerActorId;
            if (!string.IsNullOrEmpty(id) && world.TryGetActor(id, out var t) && t != null)
            {
                Vector3 target = t.position;
                float focusH = Mathf.Lerp(closeFocusHeight, farFocusHeight, Smooth(smoothZoom));
                target.y += focusH;
                if (!haveFocus) { focus = target; haveFocus = true; }
                else focus = Vector3.SmoothDamp(focus, target, ref focusVel, followSmoothTime, Mathf.Infinity, dt);
            }
            if (!haveFocus) return;

            // One continuous curve: distance grows exponentially (equal scroll = equal ratio), pitch eases open.
            float dist = closeDistance * Mathf.Pow(farDistance / closeDistance, smoothZoom);
            float pitch = Mathf.Clamp(Mathf.Lerp(closePitch, farPitch, Smooth(smoothZoom)) + pitchOffset, 3f, 85f);

            var rot = Quaternion.Euler(pitch, smoothYaw, 0f);
            Vector3 back = rot * Vector3.back;
            // Building collision: sweep a sphere from the player to the desired spot and stop in front of the first wall.
            // Pulls in quickly, eases back out, so passing a corner does not make the camera jitter.
            float want = dist;
            int mask = WorldLayers.BuildingMask;
            if (mask != 0 && !world.PlayerInside)
            {
                if (Physics.SphereCast(focus, collisionRadius, back, out RaycastHit hit, dist, mask, QueryTriggerInteraction.Ignore))
                    want = Mathf.Max(Mathf.Min(minCollisionDistance, dist), hit.distance - 0.05f);
            }
            if (boom < 0f) boom = want;
            else boom = Mathf.SmoothDamp(boom, want, ref boomVel, want < boom ? pullInTime : pushOutTime, Mathf.Infinity, dt);
            dist = Mathf.Min(dist, boom);
            Vector3 pos = focus + back * dist;

            // Terrain collision: lift the camera so neither it nor points along its boom sink below the ground.
            float lift = world.GroundHeightAt(pos.x, pos.z) + groundClearance - pos.y;
            for (int i = 1; i <= 4; i++)
            {
                float s = i / 5f;
                Vector3 p = Vector3.Lerp(focus, pos, s);
                float need = (world.GroundHeightAt(p.x, p.z) + groundClearance * 0.5f - p.y) / s;
                if (need > lift) lift = need;
            }
            if (lift > 0f) pos.y += lift;

            var ct = cam.transform;
            ct.position = pos;
            ct.rotation = Quaternion.LookRotation(focus - pos, Vector3.up);
        }

        static float Smooth(float t) => t * t * (3f - 2f * t);
    }
}
