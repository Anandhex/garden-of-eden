// The game's WebSocket (ws://<host>:3000/ws), reconnecting with backoff. Receives and parses on a background
// task and queues the results; the main thread drains the queue with TryDequeue (GameClient.Update does).
// Mirrors packages/client/src/core/connection.ts: `hello` is sent on every (re)connect, intents are only sent
// once the server's `hello` has come, and a `replaced` message stops reconnecting.
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace GardenOfEden.Net
{
    public enum ConnState { Connecting, Open, Replaced, Error }

    /// <summary>Connected, reconnecting, replaced by another window, or a problem to show.</summary>
    public class ConnectionStatus
    {
        public ConnState state;
        /// <summary>Connecting: how many tries so far (0 on the first).</summary>
        public int attempt;
        /// <summary>Error: what went wrong.</summary>
        public string text;

        public override string ToString() => state == ConnState.Error ? "error: " + text : state == ConnState.Connecting ? "connecting (" + attempt + ")" : state.ToString().ToLowerInvariant();
    }

    public sealed class GameConnection : IDisposable
    {
        readonly Uri uri;
        readonly Func<JObject> hello;
        readonly ConcurrentQueue<object> inbound = new ConcurrentQueue<object>();
        readonly ConcurrentQueue<string> outbound = new ConcurrentQueue<string>();
        readonly SemaphoreSlim outSignal = new SemaphoreSlim(0);
        CancellationTokenSource cts;
        Task runTask;
        volatile bool open;
        volatile bool replaced;

        /// <param name="url">e.g. ws://localhost:3000/ws</param>
        /// <param name="hello">Builds the `hello` intent; called on every (re)connect.</param>
        public GameConnection(string url, Func<JObject> hello)
        {
            uri = new Uri(url);
            this.hello = hello;
        }

        public bool IsOpen => open;

        public void Start()
        {
            if (cts != null) return;
            replaced = false;
            cts = new CancellationTokenSource();
            var token = cts.Token;
            runTask = Task.Run(() => RunAsync(token));
        }

        public void Stop()
        {
            if (cts == null) return;
            cts.Cancel();
            open = false;
            cts = null;
        }

        public void Dispose() => Stop();

        /// <summary>Queue an intent. Dropped unless the connection is open (as the TS core does).</summary>
        public void Send(JObject intent)
        {
            if (!open || intent == null) return;
            outbound.Enqueue(intent.ToString(Formatting.None));
            outSignal.Release();
        }

        /// <summary>The next received message (a ServerMsg) or status change (a ConnectionStatus), in order.</summary>
        public bool TryDequeue(out object item) => inbound.TryDequeue(out item);

        void Status(ConnState s, int attempt = 0, string text = null) =>
            inbound.Enqueue(new ConnectionStatus { state = s, attempt = attempt, text = text });

        async Task RunAsync(CancellationToken ct)
        {
            int attempt = 0;
            while (!ct.IsCancellationRequested && !replaced)
            {
                Status(ConnState.Connecting, attempt);
                bool fatal = false;
                try
                {
                    using (var ws = new ClientWebSocket())
                    {
                        await ws.ConnectAsync(uri, ct).ConfigureAwait(false);
                        attempt = 0;
                        fatal = await SessionAsync(ws, ct).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception e)
                {
                    // Server not there yet: say so once per try, then back off.
                    if (attempt == 0 || attempt % 4 == 0) Status(ConnState.Error, 0, e.GetBaseException().Message);
                }
                open = false;
                if (ct.IsCancellationRequested || replaced || fatal) break;
                // Back off: 0.5 s, 1 s, 2 s ... up to 8 s.
                int wait = (int)Math.Min(8000, 500 * Math.Pow(2, Math.Min(attempt, 4)));
                attempt++;
                try { await Task.Delay(wait, ct).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
            }
        }

        /// <summary>Runs one connection until it closes. Returns true if reconnecting would be pointless (version refused).</summary>
        async Task<bool> SessionAsync(ClientWebSocket ws, CancellationToken ct)
        {
            while (outbound.TryDequeue(out _)) { }       // stale intents from before
            while (outSignal.CurrentCount > 0) outSignal.Wait(0);
            using (var link = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                await SendTextAsync(ws, hello().ToString(Formatting.None), link.Token).ConfigureAwait(false);
                var sender = Task.Run(() => SendLoopAsync(ws, link.Token));
                bool fatal = false;
                try
                {
                    var buf = new byte[64 * 1024];
                    var ms = new MemoryStream();
                    while (ws.State == WebSocketState.Open && !link.IsCancellationRequested)
                    {
                        var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), link.Token).ConfigureAwait(false);
                        if (r.MessageType == WebSocketMessageType.Close) break;
                        ms.Write(buf, 0, r.Count);
                        if (!r.EndOfMessage) continue;
                        string text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                        ms.SetLength(0);
                        if (r.MessageType == WebSocketMessageType.Text) Handle(text);
                    }
                    int? code = ws.CloseStatus.HasValue ? (int?)(int)ws.CloseStatus.Value : null;
                    if (code == 4001)
                    {
                        fatal = true;
                        Status(ConnState.Error, 0, ws.CloseStatusDescription ?? "The server refused this protocol version.");
                    }
                }
                finally
                {
                    open = false;
                    link.Cancel();
                    try { await sender.ConfigureAwait(false); } catch { }
                }
                return fatal;
            }
        }

        void Handle(string text)
        {
            ServerMsg m;
            try { m = ServerMsgParser.Parse(text); }
            catch (Exception e)
            {
                Status(ConnState.Error, 0, "Bad message from the server: " + e.Message);
                return;
            }
            if (m is HelloMsg)
            {
                open = true;
                Status(ConnState.Open);
            }
            else if (m is ReplacedMsg)
            {
                replaced = true;
                Status(ConnState.Replaced);
            }
            inbound.Enqueue(m);
        }

        async Task SendLoopAsync(ClientWebSocket ws, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    await outSignal.WaitAsync(ct).ConfigureAwait(false);
                    while (outbound.TryDequeue(out var json))
                    {
                        if (ws.State != WebSocketState.Open) return;
                        await SendTextAsync(ws, json, ct).ConfigureAwait(false);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception) { /* the receive loop notices the dead socket */ }
        }

        static Task SendTextAsync(ClientWebSocket ws, string json, CancellationToken ct) =>
            ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)), WebSocketMessageType.Text, true, ct);
    }
}
