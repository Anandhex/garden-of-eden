// Server -> adapter messages (server-msg.json): a tagged union on `t`. Parse with ServerMsgParser.
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace GardenOfEden.Net
{
    public abstract class ServerMsg
    {
        public string t;
    }

    public class HelloMsg : ServerMsg
    {
        public int version;
        public string session;
    }

    /// <summary>Whole on connect and on a new map (`whole: true`), changes after.</summary>
    public class FrameMsg : ServerMsg
    {
        public int seq;
        public bool whole;
        public Frame frame;
    }

    /// <summary>A typed game event (packages/shared/src/events.ts), kept as JSON: read `event["type"]` etc.</summary>
    public class EventMsg : ServerMsg
    {
        public JObject @event;
    }

    /// <summary>An NPC talking: `thinking`, then `delta` text as it streams, then `done`. `filler` is a stopgap line.</summary>
    public class SpeechMsg : ServerMsg
    {
        public string npc;
        public string name;
        /// <summary>NpcVoice (language, pitch, rate, piper model and speaker), or null.</summary>
        public JObject voice;
        public string delta;
        public string filler;
        public bool done;
        public bool thinking;
    }

    /// <summary>Changed panels only. `keys` lists the panels present in the message (a present panel may be null).</summary>
    public class UiMsg : ServerMsg
    {
        public UiModel ui;
        public List<string> keys = new List<string>();
    }

    public class FeedMsg : ServerMsg
    {
        public List<FeedLine> lines = new List<FeedLine>();
    }

    public class PromptOption { public string id; public string label; }

    /// <summary>A modal question: answer with Intents.Answer(id, option).</summary>
    public class PromptMsg : ServerMsg
    {
        public string id, title, body;
        public List<PromptOption> options = new List<PromptOption>();
    }

    public class ReplacedMsg : ServerMsg { }

    public class ErrorMsg : ServerMsg
    {
        public string text;
    }

    /// <summary>A message kind this client doesn't know (a newer server); the raw JSON is kept.</summary>
    public class UnknownMsg : ServerMsg
    {
        public JObject raw;
    }
}
