// The UI model: every panel is data and every sentence is already written (schema.ts UiModelSchema).
// A `ui` message holds only the panels that changed; absent panels are null here (see UiMsg.keys, which says which
// were present, since `modal` and `realm` may be present and null).
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace GardenOfEden.Net
{
    public class ActionInput
    {
        /// <summary>The key in intent.args that receives the text box's value.</summary>
        public string arg;
        public string placeholder;
    }

    /// <summary>A button. Pressing it sends `intent` as it is (see Intents.Press for the `input` case).</summary>
    public class UiAction
    {
        public string id;
        public string label;
        public bool enabled;
        public string why;
        /// <summary>danger, yes, ghost, or null.</summary>
        public string style;
        public ActionInput input;
        /// <summary>An intent object, passed through untouched.</summary>
        public JObject intent;
    }

    public class UiRow
    {
        public string text;
        public string value;
        /// <summary>0..1, or null.</summary>
        public double? bar;
        public List<UiAction> actions;
    }

    public class UiSection
    {
        public string title;
        public List<UiRow> rows = new List<UiRow>();
    }

    public class FeedLine
    {
        public int id;
        public string kind;
        public string text;
    }

    public class ModelState { public bool ready; public string text; public string banner; }
    public class TimeState { public bool flows; public bool shown; }
    public class SpeedOption { public string id; public string label; }
    public class SimulateState
    {
        public string speed;
        public string note;
        public List<SpeedOption> speeds = new List<SpeedOption>();
    }

    public class HeaderPanel
    {
        public string place, placeTip, clock, today, todayTip, hp, mp, coin;
        public ModelState model = new ModelState();
        /// <summary>An action is running: grey the inputs.</summary>
        public bool busy;
        public List<UiAction> actions = new List<UiAction>();
        public TimeState time = new TimeState();
        public SimulateState simulate = new SimulateState();
    }

    public class FeedPanel { public List<FeedLine> lines = new List<FeedLine>(); }

    public class ChatLogLine { public string kind; public string text; }
    public class ChatOffer { public string text; public List<UiAction> actions = new List<UiAction>(); }
    public class ChatMode { public string id; public string label; public string placeholder; }

    /// <summary>`{ open: false }` or the open conversation (the other fields are empty when closed).</summary>
    public class ChatPanel
    {
        public bool open;
        public string npc, name, role;
        public List<string> stats = new List<string>();
        public List<ChatLogLine> log = new List<ChatLogLine>();
        public List<ChatOffer> offers = new List<ChatOffer>();
        public List<UiAction> quick = new List<UiAction>();
        public List<ChatMode> modes = new List<ChatMode>();
        public List<UiAction> tools = new List<UiAction>();
    }

    public class SheetTab
    {
        public string id, label;
        public List<UiSection> sections = new List<UiSection>();
    }
    public class SheetPanel { public List<SheetTab> tabs = new List<SheetTab>(); }

    public class RoadItem { public string text; public bool? dim; public double? need; }
    public class RoadbarPanel
    {
        public bool shown;
        public List<RoadItem> items = new List<RoadItem>();
        public List<UiAction> actions = new List<UiAction>();
    }

    public class ModalPanel
    {
        public string kind, title, body;
        public List<UiSection> sections = new List<UiSection>();
        public List<UiAction> actions = new List<UiAction>();
    }

    public class CastEntry
    {
        public string id, name, sample;
        /// <summary>NpcVoice (language, pitch, rate, piper model/speaker): free-form.</summary>
        public JObject voice;
    }

    public class UiModel
    {
        public HeaderPanel header;
        public FeedPanel feed;
        public ChatPanel chat;
        public SheetPanel sheet;
        public RoadbarPanel roadbar;
        /// <summary>The realm view (RealmView plus here and selected), free-form; null in worlds without one.</summary>
        public JObject realm;
        /// <summary>A dialog the server opened, or null.</summary>
        public ModalPanel modal;
        public List<CastEntry> cast;
    }

    public static class UiKeys
    {
        public const string Header = "header", Feed = "feed", Chat = "chat", Sheet = "sheet", Roadbar = "roadbar", Realm = "realm", Modal = "modal", Cast = "cast";
    }
}
