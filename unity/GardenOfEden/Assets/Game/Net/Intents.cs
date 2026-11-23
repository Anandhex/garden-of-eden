// Adapter -> server intents (intent.json). Each helper returns the intent as a JObject, ready for
// GameClient.Send / GameConnection.Send. Intents carry no rules: the server decides what each one means.
using Newtonsoft.Json.Linq;

namespace GardenOfEden.Net
{
    public static class Intents
    {
        public const int ProtocolVersion = 1;

        public static JObject Hello(int viewW, int viewH, string engine = "unity", int version = ProtocolVersion) =>
            new JObject { ["t"] = "hello", ["version"] = version, ["view"] = new JObject { ["w"] = viewW, ["h"] = viewH }, ["engine"] = engine };

        /// <summary>The viewport changed (w and h), and/or the window was hidden or shown. Time doesn't flow while hidden.</summary>
        public static JObject View(int? w = null, int? h = null, bool? hidden = null)
        {
            var o = new JObject { ["t"] = "view" };
            if (w.HasValue) o["w"] = w.Value;
            if (h.HasValue) o["h"] = h.Value;
            if (hidden.HasValue) o["hidden"] = hidden.Value;
            return o;
        }

        /// <summary>One step (arrow keys); dx and dy are -1, 0 or 1.</summary>
        public static JObject Step(int dx, int dy) => new JObject { ["t"] = "step", ["dx"] = Clamp1(dx), ["dy"] = Clamp1(dy) };

        /// <summary>Walk to a tile and do nothing else.</summary>
        public static JObject MoveTo(int x, int y) => new JObject { ["t"] = "moveTo", ["x"] = x, ["y"] = y };

        /// <summary>The player clicked a tile (add your origin if you rebased it). The server decides what it means.</summary>
        public static JObject Click(int x, int y) => new JObject { ["t"] = "click", ["x"] = x, ["y"] = y };

        /// <summary>E: talk to whoever is nearest in reach.</summary>
        public static JObject Interact() => new JObject { ["t"] = "interact" };
        public static JObject Fight() => new JObject { ["t"] = "fight" };
        public static JObject Flee() => new JObject { ["t"] = "flee" };

        /// <summary>A line in the open chat. mode: say, persuade, intimidate, haggle, lie (see chat.modes). Text is at most 500 characters.</summary>
        public static JObject Say(string mode, string text)
        {
            if (text != null && text.Length > 500) text = text.Substring(0, 500);
            return new JObject { ["t"] = "say", ["mode"] = mode, ["text"] = text ?? "" };
        }

        /// <summary>Any action, as the UI model's buttons send them.</summary>
        public static JObject Act(string action, JObject args = null)
        {
            var o = new JObject { ["t"] = "act", ["action"] = action };
            if (args != null) o["args"] = args;
            return o;
        }

        /// <summary>Open a dialog by name (train, wares, repair, give, favour, order, steal, ability, craft), or close it with null.</summary>
        public static JObject Panel(string panel, string arg = null)
        {
            var o = new JObject { ["t"] = "panel", ["panel"] = panel == null ? JValue.CreateNull() : new JValue(panel) };
            if (arg != null) o["arg"] = arg;
            return o;
        }

        /// <summary>Pick something in a panel (the realm map's place: Select("realm", id)); id may be null to clear.</summary>
        public static JObject Select(string what, string id) =>
            new JObject { ["t"] = "select", ["what"] = what, ["id"] = id == null ? JValue.CreateNull() : new JValue(id) };

        /// <summary>Leave the conversation.</summary>
        public static JObject Close() => new JObject { ["t"] = "close" };

        /// <summary>Answer a `prompt` message.</summary>
        public static JObject Answer(string prompt, string option) => new JObject { ["t"] = "answer", ["prompt"] = prompt, ["option"] = option };

        /// <summary>Let time flow while standing about, or make it wait.</summary>
        public static JObject Time(bool flow) => new JObject { ["t"] = "time", ["flow"] = flow };

        /// <summary>speed: off, slow, normal, fast or days.</summary>
        public static JObject Simulate(string speed) => new JObject { ["t"] = "simulate", ["speed"] = speed };

        /// <summary>Stop a walk or Simulate, close a dialog.</summary>
        public static JObject Cancel() => new JObject { ["t"] = "cancel" };

        /// <summary>Start again (the server asks first).</summary>
        public static JObject NewGame() => new JObject { ["t"] = "newGame" };

        /// <summary>
        /// The intent a pressed button sends: a copy of `action.intent`, with the text box's value put into
        /// `intent.args[input.arg]` when the action has an `input`. Returns null for a disabled action.
        /// </summary>
        public static JObject Press(UiAction action, string inputText = null)
        {
            if (action == null || !action.enabled || action.intent == null) return null;
            var intent = (JObject)action.intent.DeepClone();
            if (action.input != null && inputText != null)
            {
                var args = intent["args"] as JObject;
                if (args == null) { args = new JObject(); intent["args"] = args; }
                args[action.input.arg] = inputText;
            }
            return intent;
        }

        static int Clamp1(int v) => v < 0 ? -1 : v > 0 ? 1 : 0;
    }
}
