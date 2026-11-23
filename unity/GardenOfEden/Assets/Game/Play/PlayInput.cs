// Loads GardenOfEdenInput.inputactions (Play/Resources) through InputActionAsset and exposes the actions by name.
// No generated C# wrapper: the code only knows the action names, so rebinding in the asset needs no code change.
using UnityEngine;
using UnityEngine.InputSystem;

namespace GardenOfEden.Play
{
    public class PlayInput : MonoBehaviour
    {
        [Tooltip("Leave empty to load Resources/GardenOfEdenInput.")]
        public InputActionAsset asset;

        static PlayInput instance;

        public InputAction Move, Look, Zoom, Interact, Cancel, ToggleMenu, Fight, Flee;
        bool ready;

        /// <summary>The one PlayInput in the scene (created if there is none).</summary>
        public static PlayInput Get()
        {
            if (instance == null) instance = FindFirstObjectByType<PlayInput>();
            if (instance == null) instance = new GameObject("PlayInput").AddComponent<PlayInput>();
            instance.Init();
            return instance;
        }

        void Awake()
        {
            if (instance == null) instance = this;
            Init();
        }

        void Init()
        {
            if (ready) return;
            if (asset == null) asset = Resources.Load<InputActionAsset>("GardenOfEdenInput");
            if (asset == null)
            {
                Debug.LogError("PlayInput: GardenOfEdenInput.inputactions not found (assign it or keep it in Play/Resources).");
                return;
            }
            var map = asset.FindActionMap("Player", true);
            Move = map.FindAction("Move", true);
            Look = map.FindAction("Look", true);
            Zoom = map.FindAction("Zoom", true);
            Interact = map.FindAction("Interact", true);
            Cancel = map.FindAction("Cancel", true);
            ToggleMenu = map.FindAction("ToggleMenu", true);
            Fight = map.FindAction("Fight", true);
            Flee = map.FindAction("Flee", true);
            map.Enable();
            ready = true;
        }

        void OnEnable() { if (ready) asset.FindActionMap("Player").Enable(); }
        void OnDisable() { if (ready) asset.FindActionMap("Player").Disable(); }
    }
}
