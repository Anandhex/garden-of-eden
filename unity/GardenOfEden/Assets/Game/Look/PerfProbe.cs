using UnityEngine;

namespace GardenOfEden.Look
{
    /// <summary>
    /// A tiny frame-time probe: <see cref="Report"/> gives the average and worst frame time over the last ~3 s of unscaled
    /// frames. Created automatically in play mode; query it from the editor (unity command eval) to compare looks.
    /// </summary>
    public sealed class PerfProbe : MonoBehaviour
    {
        const int N = 180;
        static readonly float[] ring = new float[N];
        static int count, head;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (!Application.isPlaying || FindFirstObjectByType<PerfProbe>() != null) return;
            var go = new GameObject("PerfProbe") { hideFlags = HideFlags.HideAndDontSave };
            go.AddComponent<PerfProbe>();
        }

        void Update()
        {
            ring[head] = Time.unscaledDeltaTime * 1000f;
            head = (head + 1) % N;
            if (count < N) count++;
        }

        public static string Report
        {
            get
            {
                if (count == 0) return "no frames";
                float sum = 0f, max = 0f;
                for (int i = 0; i < count; i++) { sum += ring[i]; if (ring[i] > max) max = ring[i]; }
                return $"{sum / count:F2} ms avg ({1000f * count / sum:F0} fps), worst {max:F1} ms over {count} frames";
            }
        }
    }
}
