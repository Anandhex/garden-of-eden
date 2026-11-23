// Who is talking right now, for the faces (jaw and visemes, PersonFace): NPC speech streaming in (`speech` messages), the
// townsfolk's chatter lines and gossip (frame.chatter / frame.gossip). Pure bookkeeping by actor id; no game rules.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public static class Speaking
    {
        static readonly Dictionary<string, float> until = new Dictionary<string, float>();
        static readonly Dictionary<string, float> start = new Dictionary<string, float>();

        /// <summary>Mark an actor as talking for `seconds` from now (extends, never shortens).</summary>
        public static void Mark(string id, float seconds)
        {
            if (string.IsNullOrEmpty(id)) return;
            float now = Time.time, end = now + Mathf.Clamp(seconds, 0.3f, 30f);
            if (!until.TryGetValue(id, out var u) || u < now) start[id] = now;
            if (!until.TryGetValue(id, out u) || u < end) until[id] = end;
        }

        /// <summary>Seconds this actor has been talking, or -1 when silent.</summary>
        public static float Talking(string id)
        {
            if (id == null || !until.TryGetValue(id, out var u) || u < Time.time) return -1f;
            return Time.time - (start.TryGetValue(id, out var s) ? s : Time.time);
        }

        /// <summary>Roughly how long a line takes to say aloud (about 14 characters a second).</summary>
        public static float Duration(string text) => string.IsNullOrEmpty(text) ? 0f : 0.6f + text.Length / 14f;

        public static void FromFrame(Frame f)
        {
            if (f == null) return;
            if (f.chatter != null)
                foreach (var c in f.chatter)
                {
                    if (c?.lines == null) continue;
                    float d0 = c.lines.Length > 0 ? Duration(c.lines[0]) : 0f;
                    if (d0 > 0f) Mark(c.a, d0);
                    // b answers after a: approximate by a delayed, overlapping window (the jaw only needs to move while bubbles show)
                    if (c.lines.Length > 1 && !string.IsNullOrEmpty(c.lines[1])) Mark(c.b, d0 + Duration(c.lines[1]));
                }
            if (f.gossip != null) foreach (var g in f.gossip) if (g != null) Mark(g.who, Duration(g.text));
        }

        public static void FromSpeech(SpeechMsg s)
        {
            if (s == null || string.IsNullOrEmpty(s.npc)) return;
            if (!string.IsNullOrEmpty(s.delta)) Mark(s.npc, Duration(s.delta) + 0.8f);
            if (!string.IsNullOrEmpty(s.filler)) Mark(s.npc, Duration(s.filler));
            if (s.done && until.TryGetValue(s.npc, out var u)) until[s.npc] = Mathf.Min(u, Time.time + 1.2f);
        }
    }
}
