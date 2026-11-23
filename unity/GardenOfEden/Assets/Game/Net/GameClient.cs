// The MonoBehaviour that owns the connection: connects to the game server, sends `hello`, pumps received messages
// onto Unity's main thread from Update(), keeps the Mirror, and raises one C# event per message kind.
// Put one on a GameObject; subscribe to its events (or to Mirror's change events) from your world builders.
// No game rules live here: it moves bytes and keeps what the server said.
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace GardenOfEden.Net
{
    public class GameClient : MonoBehaviour
    {
        [Header("Server")]
        public string host = "localhost";
        public int port = 3000;
        [Tooltip("Connect when enabled. Turn off to call Connect() yourself.")]
        public bool autoConnect = true;

        [Header("View")]
        [Tooltip("How many tiles the camera shows (width).")]
        public int viewW = 64;
        [Tooltip("How many tiles the camera shows (height).")]
        public int viewH = 44;
        public string engine = "unity";
        [Tooltip("Tell the server when the app loses or gains focus (time doesn't flow while hidden).")]
        public bool sendHiddenOnFocusLoss = true;

        /// <summary>The latest frame and UI, kept by Apply*. Subscribe to its events for fine-grained changes.</summary>
        public readonly Mirror Mirror = new Mirror();

        public ConnectionStatus Status { get; private set; } = new ConnectionStatus { state = ConnState.Connecting };
        public string SessionId { get; private set; }
        public bool IsOpen => connection != null && connection.IsOpen;
        public string Url => "ws://" + host + ":" + port + "/ws";

        // One event per message kind in server-msg.json (the mirror is already updated when these fire).
        public event Action<HelloMsg> OnHello;
        public event Action<Frame, FrameChange> OnFrame;
        /// <summary>A game event as JSON (events.ts): read ev["type"] etc.</summary>
        public event Action<JObject> OnEvent;
        public event Action<SpeechMsg> OnSpeech;
        /// <summary>The UI model and the panels (UiKeys) that changed.</summary>
        public event Action<UiModel, IReadOnlyList<string>> OnUi;
        /// <summary>New lines at the end of the feed (they are in Mirror.ui.feed too).</summary>
        public event Action<List<FeedLine>> OnFeed;
        public event Action<PromptMsg> OnPrompt;
        public event Action<ReplacedMsg> OnReplaced;
        public event Action<ErrorMsg> OnError;
        /// <summary>A message kind this client doesn't know.</summary>
        public event Action<UnknownMsg> OnUnknown;
        /// <summary>Connecting, open, replaced by another window, or a problem to show.</summary>
        public event Action<ConnectionStatus> OnStatus;

        GameConnection connection;

        void OnEnable()
        {
            if (autoConnect) Connect();
        }

        void OnDisable() => Disconnect();

        void OnDestroy() => Disconnect();

        public void Connect()
        {
            if (connection != null) return;
            connection = new GameConnection(Url, () => Intents.Hello(viewW, viewH, engine));
            connection.Start();
        }

        public void Disconnect()
        {
            connection?.Dispose();
            connection = null;
        }

        /// <summary>Send an intent (see Intents). Ignored until the server has said hello.</summary>
        public void Send(JObject intent)
        {
            // Keep our remembered viewport in step so a reconnect's hello carries it.
            if (intent != null && (string)intent["t"] == "view" && intent["w"] != null && intent["h"] != null)
            {
                viewW = (int)intent["w"];
                viewH = (int)intent["h"];
            }
            connection?.Send(intent);
        }

        /// <summary>Press a UI button: sends its intent (with the text box's value when it has an input).</summary>
        public void Press(UiAction action, string inputText = null) => Send(Intents.Press(action, inputText));

        public void SetView(int w, int h) => Send(Intents.View(w, h));

        void Update()
        {
            if (connection == null) return;
            while (connection.TryDequeue(out var item))
            {
                try { Dispatch(item); }
                catch (Exception e) { Debug.LogException(e); }
            }
        }

        void OnApplicationFocus(bool focus)
        {
            if (sendHiddenOnFocusLoss && IsOpen) Send(Intents.View(hidden: !focus));
        }

        void Dispatch(object item)
        {
            if (item is ConnectionStatus s)
            {
                Status = s;
                OnStatus?.Invoke(s);
                return;
            }
            switch (item)
            {
                case HelloMsg m:
                    SessionId = m.session;
                    OnHello?.Invoke(m);
                    break;
                case FrameMsg m:
                    var change = Mirror.ApplyFrame(m.frame, m.whole);
                    OnFrame?.Invoke(m.frame, change);
                    break;
                case UiMsg m:
                    var keys = Mirror.ApplyUi(m);
                    // Like the TS core, wait for the header before the first draw.
                    if (Mirror.ui?.header != null) OnUi?.Invoke(Mirror.ui, keys);
                    break;
                case FeedMsg m:
                    Mirror.AppendFeed(m.lines);
                    OnFeed?.Invoke(m.lines);
                    break;
                case EventMsg m:
                    if (m.@event != null) OnEvent?.Invoke(m.@event);
                    break;
                case SpeechMsg m:
                    OnSpeech?.Invoke(m);
                    break;
                case PromptMsg m:
                    OnPrompt?.Invoke(m);
                    break;
                case ReplacedMsg m:
                    OnReplaced?.Invoke(m);
                    break;
                case ErrorMsg m:
                    Status = new ConnectionStatus { state = ConnState.Error, text = m.text };
                    OnError?.Invoke(m);
                    OnStatus?.Invoke(Status);
                    break;
                case UnknownMsg m:
                    OnUnknown?.Invoke(m);
                    break;
            }
        }
    }
}
