// The HUD, drawn with UI Toolkit. It shows what the server's ui model says and nothing else: every string (place,
// clock, prompt line, feed, chat, panel rows, button labels) comes from the model. Buttons send the intent the model
// attached to them (GameClient.Press). Put it on a GameObject with a UIDocument (one is added if missing).
using System;
using System.Collections.Generic;
using System.Text;
using GardenOfEden.Net;
using GardenOfEden.World;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace GardenOfEden.Play
{
    [RequireComponent(typeof(UIDocument))]
    public class Hud : MonoBehaviour
    {
        [Header("Wiring (found automatically when empty)")]
        public GameClient client;
        public WorldView world;
        public Camera cam;

        [Header("Assets (Resources/Hud and Resources/Hud fallbacks)")]
        public PanelSettings panelSettings;
        public VisualTreeAsset uxml;
        public StyleSheet uss;

        [Header("Feed")]
        public int feedLines = 8;
        public float feedHoldSeconds = 10f;
        public float feedFadeSeconds = 4f;

        [Header("Bubbles")]
        public float bubbleHeight = 2.3f;
        public int bubbleMaxChars = 140;

        UIDocument doc;
        PlayInput input;
        VisualElement root;
        bool bound;

        // Elements
        Label headerPlace, headerClock, headerToday, headerStats, headerStatus, banner, prompt, chatTitle, chatStats;
        VisualElement header, headerActions, roadbar, feed, chat, chatOffers, chatTools, chatInputRow, sheet, sheetTabs, modal, modalCard, question, questionCard, bubbles;
        ScrollView chatLog, sheetBody;
        DropdownField chatMode;
        TextField chatLine;
        Button chatSend;

        // State
        bool sheetOpen;
        string sheetTab;
        readonly List<string> modeIds = new List<string>();
        readonly List<FeedItem> feedItems = new List<FeedItem>();
        readonly Dictionary<string, Bubble> bubbleMap = new Dictionary<string, Bubble>();
        string streamNpc;
        readonly StringBuilder streamText = new StringBuilder();
        string connectionText;
        bool questionOpen;

        class FeedItem { public Label label; public float born; }
        class Bubble { public Label label; public float until; }

        /// <summary>The chat or another text box has the keyboard.</summary>
        public bool IsTyping
        {
            get
            {
                if (!bound || root.panel == null) return false;
                var f = root.panel.focusController != null ? root.panel.focusController.focusedElement as VisualElement : null;
                return f != null && (f is TextField || f.GetFirstAncestorOfType<TextField>() != null);
            }
        }

        /// <summary>A question (prompt) is waiting: the world input pauses until it is answered.</summary>
        public bool BlocksGameInput => questionOpen;

        public bool SheetOpen => sheetOpen;

        public void Blur()
        {
            if (!bound || root.panel == null || root.panel.focusController == null) return;
            var f = root.panel.focusController.focusedElement as VisualElement;
            if (f != null) f.Blur();
        }

        /// <summary>Esc closes the sheet. Returns true if it used the key.</summary>
        public bool HandleCancel()
        {
            if (sheetOpen) { SetSheet(false); return true; }
            return false;
        }

        /// <summary>True if the screen point (Input System coordinates, origin bottom-left) is over a HUD element.</summary>
        public bool PointerOverUi(Vector2 screen)
        {
            if (!bound || root.panel == null) return false;
            Vector2 p = RuntimePanelUtils.ScreenToPanel(root.panel, new Vector2(screen.x, Screen.height - screen.y));
            return root.panel.Pick(p) != null;
        }

        void Awake()
        {
            doc = GetComponent<UIDocument>();
        }

        void Start()
        {
            input = PlayInput.Get();
            if (client == null) client = FindFirstObjectByType<GameClient>();
            if (world == null) world = FindFirstObjectByType<WorldView>();
            if (cam == null) cam = Camera.main;

            if (doc.panelSettings == null) doc.panelSettings = panelSettings != null ? panelSettings : MakePanelSettings();
            if (uxml == null) uxml = Resources.Load<VisualTreeAsset>("Hud");
            if (uss == null) uss = Resources.Load<StyleSheet>("Hud");
            if (doc.visualTreeAsset == null) doc.visualTreeAsset = uxml;
        }

        static PanelSettings MakePanelSettings()
        {
            var ps = ScriptableObject.CreateInstance<PanelSettings>();
            ps.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            ps.referenceResolution = new Vector2Int(1920, 1080);
            ps.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            ps.match = 0.5f;
            // Prefer a theme asset if the project has one at Resources/HudTheme; else an empty one (inline styles still work).
            var theme = Resources.Load<ThemeStyleSheet>("HudTheme");
            ps.themeStyleSheet = theme != null ? theme : ScriptableObject.CreateInstance<ThemeStyleSheet>();
            return ps;
        }

        void OnDisable() => Unbind();

        void Unbind()
        {
            if (!bound) return;
            bound = false;
            if (client != null)
            {
                client.OnFrame -= OnFrame;
                client.OnSpeech -= OnSpeech;
                client.OnUi -= OnUi;
                client.OnFeed -= OnFeed;
                client.OnPrompt -= OnPrompt;
                client.OnStatus -= OnStatus;
            }
        }

        void Update()
        {
            if (!bound) { TryBind(); return; }
            float now = Time.unscaledTime;
            UpdateFeedFade(now);
            UpdateBubbles(now);
            UpdatePrompt();
            if (input != null && input.ToggleMenu != null && input.ToggleMenu.WasPressedThisFrame() && !IsTyping) SetSheet(!sheetOpen);
        }

        // ---------- binding ----------

        void TryBind()
        {
            if (client == null || doc == null) return;
            var r = doc.rootVisualElement;
            if (r == null) return;
            var hudRoot = r.Q<VisualElement>("hud-root");
            if (hudRoot == null) return; // the uxml hasn't been built yet
            root = hudRoot;
            r.pickingMode = PickingMode.Ignore;
            root.pickingMode = PickingMode.Ignore;
            if (uss != null && !r.styleSheets.Contains(uss)) r.styleSheets.Add(uss);
            TrySerifFont(root);

            header = root.Q("header"); headerPlace = root.Q<Label>("header-place"); headerClock = root.Q<Label>("header-clock");
            headerToday = root.Q<Label>("header-today"); headerStats = root.Q<Label>("header-stats"); headerStatus = root.Q<Label>("header-status");
            headerActions = root.Q("header-actions"); banner = root.Q<Label>("banner"); roadbar = root.Q("roadbar");
            feed = root.Q("feed"); prompt = root.Q<Label>("prompt"); chat = root.Q("chat"); chatTitle = root.Q<Label>("chat-title");
            chatStats = root.Q<Label>("chat-stats"); chatLog = root.Q<ScrollView>("chat-log"); chatOffers = root.Q("chat-offers");
            chatTools = root.Q("chat-tools"); chatInputRow = root.Q("chat-input-row"); chatMode = root.Q<DropdownField>("chat-mode");
            chatLine = root.Q<TextField>("chat-line"); chatSend = root.Q<Button>("chat-send"); sheet = root.Q("sheet");
            sheetTabs = root.Q("sheet-tabs"); sheetBody = root.Q<ScrollView>("sheet-body"); modal = root.Q("modal"); modalCard = root.Q("modal-card");
            question = root.Q("question"); questionCard = root.Q("question-card"); bubbles = root.Q("bubbles");

            // Scrims block clicks when shown; everything that is only decoration ignores the pointer.
            bubbles.pickingMode = PickingMode.Ignore;
            feed.pickingMode = PickingMode.Ignore;
            prompt.pickingMode = PickingMode.Ignore;
            banner.pickingMode = PickingMode.Ignore;

            chatSend.text = "➤";
            chatSend.clicked += SendLine;
            chatLine.RegisterCallback<KeyDownEvent>(e =>
            {
                if (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter) { SendLine(); e.StopPropagation(); }
            }, TrickleDown.TrickleDown);
            chatMode.RegisterValueChangedCallback(_ => UpdatePlaceholder());

            client.OnFrame += OnFrame;
            client.OnSpeech += OnSpeech;
            client.OnUi += OnUi;
            client.OnFeed += OnFeed;
            client.OnPrompt += OnPrompt;
            client.OnStatus += OnStatus;
            bound = true;

            // Catch up with what the mirror already holds.
            if (client.Mirror.ui != null && client.Mirror.ui.header != null)
            {
                OnUi(client.Mirror.ui, new List<string> { UiKeys.Header, UiKeys.Feed, UiKeys.Chat, UiKeys.Sheet, UiKeys.Roadbar, UiKeys.Modal });
            }
            OnStatus(client.Status);
        }

        static void TrySerifFont(VisualElement el)
        {
            try
            {
                var font = Font.CreateDynamicFontFromOSFont(new[] { "Georgia", "Palatino", "Palatino Linotype", "Times New Roman", "Times", "Serif" }, 16);
                if (font != null) el.style.unityFontDefinition = new StyleFontDefinition(FontDefinition.FromFont(font));
            }
            catch (Exception) { /* keep the default font */ }
        }

        // ---------- model -> UI ----------

        void OnUi(UiModel ui, IReadOnlyList<string> keys)
        {
            if (!bound) return;
            bool Has(string k) { foreach (var x in keys) if (x == k) return true; return false; }
            if (Has(UiKeys.Header)) RenderHeader(ui.header);
            if (Has(UiKeys.Roadbar)) RenderRoadbar(ui.roadbar);
            if (Has(UiKeys.Chat)) RenderChat(ui.chat);
            if (Has(UiKeys.Sheet)) RenderSheet(ui.sheet);
            if (Has(UiKeys.Modal)) RenderModal(ui.modal);
            if (Has(UiKeys.Feed) && feedItems.Count == 0 && ui.feed != null) SeedFeed(ui.feed.lines);
            if (Has(UiKeys.Header) || Has(UiKeys.Chat)) ApplyBusy();
        }

        void RenderHeader(HeaderPanel h)
        {
            if (h == null) return;
            headerPlace.text = h.place ?? "";
            headerPlace.tooltip = h.placeTip ?? "";
            headerClock.text = h.clock ?? "";
            headerToday.text = h.today ?? "";
            headerToday.tooltip = h.todayTip ?? "";
            headerStats.text = JoinNonEmpty("   ", h.hp, h.mp, h.coin);
            string note = h.simulate != null ? h.simulate.note : null;
            headerStatus.text = JoinNonEmpty("   ", h.model != null ? h.model.text : null, note, h.busy ? "…" : null);

            headerActions.Clear();
            if (h.actions != null) foreach (var a in h.actions) headerActions.Add(MakeAction(a));
            if (h.time != null && h.time.shown)
            {
                bool flows = h.time.flows;
                var b = new Button(() => client.Send(Intents.Time(!flows))) { text = flows ? "⏸" : "▶" };
                b.AddToClassList("btn");
                headerActions.Add(b);
            }
            if (h.simulate != null && h.simulate.speeds != null)
            {
                foreach (var s in h.simulate.speeds)
                {
                    string id = s.id;
                    var b = new Button(() => client.Send(Intents.Simulate(id))) { text = s.label };
                    b.AddToClassList("btn");
                    if (id == h.simulate.speed) b.AddToClassList("selected");
                    headerActions.Add(b);
                }
            }
            string bn = h.model != null ? h.model.banner : null;
            ShowBanner(bn);
        }

        void ShowBanner(string text)
        {
            string shown = !string.IsNullOrEmpty(connectionText) ? connectionText : text;
            banner.text = shown ?? "";
            banner.style.display = string.IsNullOrEmpty(shown) ? DisplayStyle.None : DisplayStyle.Flex;
        }

        void RenderRoadbar(RoadbarPanel r)
        {
            roadbar.Clear();
            if (r == null || !r.shown) { roadbar.style.display = DisplayStyle.None; return; }
            roadbar.style.display = DisplayStyle.Flex;
            if (r.items != null)
            {
                foreach (var i in r.items)
                {
                    var l = new Label(i.need.HasValue ? i.text + " " + i.need.Value.ToString("0.##") : i.text);
                    l.style.marginRight = 10;
                    if (i.dim == true) l.AddToClassList("dim");
                    roadbar.Add(l);
                }
            }
            if (r.actions != null) foreach (var a in r.actions) roadbar.Add(MakeAction(a));
        }

        void RenderChat(ChatPanel c)
        {
            bool wasOpen = chat.style.display == DisplayStyle.Flex;
            if (c == null || !c.open)
            {
                chat.style.display = DisplayStyle.None;
                if (wasOpen) Blur();
                return;
            }
            chat.style.display = DisplayStyle.Flex;
            chatTitle.text = JoinNonEmpty("  ", c.name, c.role);
            chatStats.text = c.stats != null ? string.Join("  ", c.stats) : "";

            chatLog.Clear();
            if (c.log != null)
            {
                foreach (var l in c.log)
                {
                    var lab = new Label(l.text);
                    string kind = l.kind ?? "";
                    lab.AddToClassList(kind == "you" ? "chat-line-you" : kind.StartsWith("note") ? "chat-line-note" : "chat-line-npc");
                    chatLog.Add(lab);
                }
            }
            chatLog.schedule.Execute(() => chatLog.scrollOffset = new Vector2(0, 100000f)).ExecuteLater(30);

            chatOffers.Clear();
            if (c.offers != null)
            {
                foreach (var o in c.offers)
                {
                    var box = new VisualElement();
                    box.Add(new Label(o.text) { name = "offer-text" });
                    var rowEl = new VisualElement();
                    rowEl.AddToClassList("row-wrap");
                    foreach (var a in o.actions) rowEl.Add(MakeAction(a));
                    box.Add(rowEl);
                    chatOffers.Add(box);
                }
            }

            chatTools.Clear();
            if (c.quick != null) foreach (var a in c.quick) chatTools.Add(MakeAction(a));
            if (c.tools != null) foreach (var a in c.tools) chatTools.Add(MakeAction(a));
            var close = new Button(() => client.Send(Intents.Close())) { text = "✕" };
            close.AddToClassList("btn");
            chatTools.Add(close);

            // Modes: rebuild the list only when it changed so the player's choice sticks.
            var ids = new List<string>();
            var labels = new List<string>();
            if (c.modes != null) foreach (var m in c.modes) { ids.Add(m.id); labels.Add(m.label); }
            if (!SameList(ids, modeIds))
            {
                modeIds.Clear(); modeIds.AddRange(ids);
                chatMode.choices = labels;
                if (labels.Count > 0) chatMode.index = 0;
            }
            chatMode.style.display = labels.Count > 1 ? DisplayStyle.Flex : DisplayStyle.None;
            UpdatePlaceholder();

            if (!wasOpen) chatLine.schedule.Execute(() => chatLine.Focus()).ExecuteLater(60);
        }

        void UpdatePlaceholder()
        {
            var c = client.Mirror.ui != null ? client.Mirror.ui.chat : null;
            if (c == null || c.modes == null) return;
            int i = chatMode.index;
            string ph = (i >= 0 && i < modeIds.Count) ? c.modes.Find(m => m.id == modeIds[i])?.placeholder : null;
            chatLine.textEdition.placeholder = ph ?? "";
        }

        void ApplyBusy()
        {
            var h = client.Mirror.ui != null ? client.Mirror.ui.header : null;
            bool busy = h != null && h.busy;
            chatInputRow.SetEnabled(!busy);
        }

        void SendLine()
        {
            var h = client.Mirror.ui != null ? client.Mirror.ui.header : null;
            if (h != null && h.busy) return;
            string mode = "say";
            int i = chatMode.index;
            if (i >= 0 && i < modeIds.Count) mode = modeIds[i];
            string text = chatLine.value ?? "";
            if (mode == "say" && string.IsNullOrWhiteSpace(text)) return;
            client.Send(Intents.Say(mode, text));
            chatLine.value = "";
            if (modeIds.Count > 0) chatMode.index = 0;
            chatLine.schedule.Execute(() => chatLine.Focus()).ExecuteLater(30);
        }

        // ---------- sheet and modal ----------

        void SetSheet(bool open)
        {
            sheetOpen = open;
            sheet.style.display = open ? DisplayStyle.Flex : DisplayStyle.None;
            if (open) RenderSheet(client.Mirror.ui != null ? client.Mirror.ui.sheet : null);
        }

        void RenderSheet(SheetPanel s)
        {
            if (!sheetOpen) return; // rendered when opened
            sheetTabs.Clear();
            sheetBody.Clear();
            if (s == null || s.tabs == null || s.tabs.Count == 0) return;
            SheetTab current = s.tabs.Find(t => t.id == sheetTab) ?? s.tabs[0];
            sheetTab = current.id;
            foreach (var t in s.tabs)
            {
                string id = t.id;
                var b = new Button(() => { sheetTab = id; RenderSheet(client.Mirror.ui.sheet); }) { text = t.label };
                b.AddToClassList("btn");
                if (id == sheetTab) b.AddToClassList("selected");
                sheetTabs.Add(b);
            }
            RenderSections(sheetBody, current.sections);
        }

        void RenderModal(ModalPanel m)
        {
            modalCard.Clear();
            if (m == null) { modal.style.display = DisplayStyle.None; return; }
            modal.style.display = DisplayStyle.Flex;
            modalCard.Add(new Label(m.title ?? "") { name = "modal-title" });
            modalCard[0].AddToClassList("title");
            if (!string.IsNullOrEmpty(m.body))
            {
                var body = new Label(m.body);
                body.AddToClassList("card-body");
                modalCard.Add(body);
            }
            var scroll = new ScrollView();
            scroll.style.maxHeight = 360;
            RenderSections(scroll, m.sections);
            modalCard.Add(scroll);
            var row = new VisualElement();
            row.AddToClassList("row-wrap");
            if (m.actions != null) foreach (var a in m.actions) row.Add(MakeAction(a));
            if (m.kind != "situation")
            {
                var close = new Button(() => client.Send(Intents.Panel(null))) { text = "✕" };
                close.AddToClassList("btn");
                row.Add(close);
            }
            modalCard.Add(row);
        }

        /// <summary>Generic panel body: sections of rows (text, value, bar, action buttons). New panels need no code.</summary>
        void RenderSections(VisualElement parent, List<UiSection> sections)
        {
            if (sections == null) return;
            foreach (var s in sections)
            {
                if (!string.IsNullOrEmpty(s.title))
                {
                    var t = new Label(s.title);
                    t.AddToClassList("section-title");
                    parent.Add(t);
                }
                if (s.rows == null) continue;
                foreach (var r in s.rows)
                {
                    var row = new VisualElement();
                    row.AddToClassList("ui-row");
                    var text = new Label(r.text ?? "");
                    text.AddToClassList("ui-row-text");
                    row.Add(text);
                    if (r.bar.HasValue)
                    {
                        var bar = new VisualElement();
                        bar.AddToClassList("bar");
                        var fill = new VisualElement();
                        fill.AddToClassList("bar-fill");
                        fill.style.width = Length.Percent(Mathf.Clamp01((float)r.bar.Value) * 100f);
                        bar.Add(fill);
                        row.Add(bar);
                    }
                    if (!string.IsNullOrEmpty(r.value))
                    {
                        var v = new Label(r.value);
                        v.AddToClassList("ui-row-value");
                        row.Add(v);
                    }
                    if (r.actions != null) foreach (var a in r.actions) row.Add(MakeAction(a));
                    parent.Add(row);
                }
            }
        }

        /// <summary>A UiAction as a button (or a text box plus button when the action takes input). Disabled shows `why`.</summary>
        VisualElement MakeAction(UiAction a)
        {
            var b = new Button { text = a.label };
            b.AddToClassList("btn");
            if (!string.IsNullOrEmpty(a.style)) b.AddToClassList(a.style);
            b.tooltip = a.why ?? "";
            b.SetEnabled(a.enabled);
            if (a.input == null)
            {
                b.clicked += () => client.Press(a);
                return b;
            }
            var wrap = new VisualElement();
            wrap.style.flexDirection = FlexDirection.Row;
            wrap.style.alignItems = Align.Center;
            var tf = new TextField();
            tf.style.minWidth = 110;
            tf.textEdition.placeholder = a.input.placeholder ?? "";
            tf.SetEnabled(a.enabled);
            b.clicked += () =>
            {
                if (string.IsNullOrWhiteSpace(tf.value)) return;
                client.Press(a, tf.value.Trim());
            };
            wrap.Add(tf);
            wrap.Add(b);
            return wrap;
        }

        // ---------- the question (prompt message) ----------

        void OnPrompt(PromptMsg p)
        {
            if (!bound) return;
            questionCard.Clear();
            var title = new Label(p.title ?? "");
            title.AddToClassList("title");
            questionCard.Add(title);
            if (!string.IsNullOrEmpty(p.body))
            {
                var body = new Label(p.body);
                body.AddToClassList("card-body");
                questionCard.Add(body);
            }
            var row = new VisualElement();
            row.AddToClassList("row-wrap");
            string promptId = p.id;
            if (p.options != null)
            {
                foreach (var o in p.options)
                {
                    string optId = o.id;
                    var b = new Button(() =>
                    {
                        question.style.display = DisplayStyle.None;
                        questionOpen = false;
                        client.Send(Intents.Answer(promptId, optId));
                    }) { text = o.label };
                    b.AddToClassList("btn");
                    row.Add(b);
                }
            }
            questionCard.Add(row);
            question.style.display = DisplayStyle.Flex;
            questionOpen = true;
        }

        // ---------- prompt line (frame.prompt) ----------

        void UpdatePrompt()
        {
            var p = client.Mirror.prompt;
            if (p == null || string.IsNullOrEmpty(p.text) || questionOpen)
            {
                if (prompt.style.display != DisplayStyle.None) prompt.style.display = DisplayStyle.None;
                return;
            }
            if (prompt.text != p.text) prompt.text = p.text;
            bool danger = p.tone == "danger" || p.tone == "fight";
            prompt.EnableInClassList("danger", danger);
            if (prompt.style.display != DisplayStyle.Flex) prompt.style.display = DisplayStyle.Flex;
        }

        // ---------- feed ----------

        void SeedFeed(List<FeedLine> lines)
        {
            if (lines == null) return;
            int from = Math.Max(0, lines.Count - feedLines);
            for (int i = from; i < lines.Count; i++) AddFeed(lines[i], Time.unscaledTime - feedHoldSeconds * 0.5f);
        }

        void OnFeed(List<FeedLine> lines)
        {
            if (!bound || lines == null) return;
            foreach (var l in lines) AddFeed(l, Time.unscaledTime);
        }

        void AddFeed(FeedLine l, float born)
        {
            var lab = new Label(l.text ?? "");
            lab.AddToClassList("feed-line");
            if (l.kind == "danger" || l.kind == "bad") lab.AddToClassList("danger");
            lab.pickingMode = PickingMode.Ignore;
            feed.Add(lab);
            feedItems.Add(new FeedItem { label = lab, born = born });
            while (feedItems.Count > feedLines)
            {
                feedItems[0].label.RemoveFromHierarchy();
                feedItems.RemoveAt(0);
            }
        }

        void UpdateFeedFade(float now)
        {
            for (int i = feedItems.Count - 1; i >= 0; i--)
            {
                var it = feedItems[i];
                float age = now - it.born;
                if (age > feedHoldSeconds + feedFadeSeconds)
                {
                    it.label.RemoveFromHierarchy();
                    feedItems.RemoveAt(i);
                    continue;
                }
                float o = age <= feedHoldSeconds ? 1f : 1f - (age - feedHoldSeconds) / feedFadeSeconds;
                it.label.style.opacity = o;
            }
        }

        // ---------- speech bubbles ----------

        void OnFrame(Frame f, FrameChange change)
        {
            if (!bound || f == null) return;
            if (f.chatter != null)
            {
                foreach (var c in f.chatter)
                {
                    if (c.lines == null) continue;
                    if (c.lines.Length > 0 && !string.IsNullOrEmpty(c.lines[0])) SetBubble(c.a, c.lines[0], 3.5f);
                    if (c.lines.Length > 1 && !string.IsNullOrEmpty(c.lines[1])) SetBubble(c.b, c.lines[1], 3.5f);
                }
            }
            if (f.gossip != null) foreach (var g in f.gossip) SetBubble(g.who, g.text, 5f);
        }

        void OnSpeech(SpeechMsg s)
        {
            if (!bound || s == null || string.IsNullOrEmpty(s.npc)) return;
            if (s.thinking) SetBubble(s.npc, "…", 60f);
            if (!string.IsNullOrEmpty(s.filler)) SetBubble(s.npc, s.filler, 4f);
            if (s.delta != null)
            {
                if (streamNpc != s.npc) { streamNpc = s.npc; streamText.Clear(); }
                streamText.Append(s.delta);
                SetBubble(s.npc, streamText.ToString(), 60f);
            }
            if (s.done)
            {
                if (streamNpc == s.npc && streamText.Length > 0) SetBubble(s.npc, streamText.ToString(), 4f + streamText.Length * 0.03f);
                else RemoveBubble(s.npc);
                streamNpc = null;
                streamText.Clear();
            }
        }

        void SetBubble(string actorId, string text, float seconds)
        {
            if (string.IsNullOrEmpty(actorId) || string.IsNullOrEmpty(text)) return;
            if (text.Length > bubbleMaxChars) text = "…" + text.Substring(text.Length - (bubbleMaxChars - 1));
            if (!bubbleMap.TryGetValue(actorId, out var b))
            {
                var lab = new Label();
                lab.AddToClassList("bubble");
                lab.pickingMode = PickingMode.Ignore;
                lab.style.display = DisplayStyle.None; // shown once positioned
                bubbles.Add(lab);
                b = new Bubble { label = lab };
                bubbleMap[actorId] = b;
            }
            b.label.text = text;
            b.until = Time.unscaledTime + seconds;
        }

        void RemoveBubble(string actorId)
        {
            if (bubbleMap.TryGetValue(actorId, out var b))
            {
                b.label.RemoveFromHierarchy();
                bubbleMap.Remove(actorId);
            }
        }

        readonly List<string> expired = new List<string>();

        void UpdateBubbles(float now)
        {
            if (bubbleMap.Count == 0) return;
            if (cam == null) cam = Camera.main;
            expired.Clear();
            foreach (var kv in bubbleMap)
            {
                var b = kv.Value;
                if (now > b.until) { expired.Add(kv.Key); continue; }
                if (cam == null || world == null || !world.TryGetActor(kv.Key, out var t) || t == null)
                {
                    b.label.style.display = DisplayStyle.None;
                    continue;
                }
                Vector3 pos = t.position + Vector3.up * bubbleHeight;
                Vector3 vp = cam.WorldToViewportPoint(pos);
                if (vp.z <= 0f || vp.x < -0.1f || vp.x > 1.1f || vp.y < -0.1f || vp.y > 1.1f)
                {
                    b.label.style.display = DisplayStyle.None;
                    continue;
                }
                Vector2 p = RuntimePanelUtils.CameraTransformWorldToPanel(root.panel, pos, cam);
                b.label.style.display = DisplayStyle.Flex;
                b.label.style.left = p.x;
                b.label.style.top = p.y;
                b.label.style.translate = new Translate(Length.Percent(-50), Length.Percent(-100));
            }
            foreach (var id in expired) RemoveBubble(id);
        }

        // ---------- connection ----------

        void OnStatus(ConnectionStatus s)
        {
            if (!bound || s == null) return;
            // Connection trouble is a client concern, not a game sentence; the server's own text (error/banner) is shown when present.
            connectionText = s.state == ConnState.Open ? null : (s.state == ConnState.Error ? s.text : null);
            var h = client.Mirror.ui != null ? client.Mirror.ui.header : null;
            ShowBanner(h != null && h.model != null ? h.model.banner : null);
        }

        // ---------- helpers ----------

        static string JoinNonEmpty(string sep, params string[] parts)
        {
            var sb = new StringBuilder();
            foreach (var p in parts)
            {
                if (string.IsNullOrEmpty(p)) continue;
                if (sb.Length > 0) sb.Append(sep);
                sb.Append(p);
            }
            return sb.ToString();
        }

        static bool SameList(List<string> a, List<string> b)
        {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
            return true;
        }
    }
}
