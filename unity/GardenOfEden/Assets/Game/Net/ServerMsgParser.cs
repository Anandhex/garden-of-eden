// Parsing: JObject dispatch on `t`, plus the one non-obvious shape (actor `move` tuples).
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace GardenOfEden.Net
{
    /// <summary>Reads the compact `[id, x, y]` actor move tuple (and writes it back).</summary>
    public class MoveEntryConverter : JsonConverter
    {
        public override bool CanConvert(Type objectType) => objectType == typeof(MoveEntry);

        public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
        {
            if (reader.TokenType == JsonToken.Null) return null;
            var a = JArray.Load(reader);
            if (a.Count < 3) throw new JsonSerializationException("actor move tuple needs [id, x, y]");
            return new MoveEntry { id = (string)a[0], x = (double)a[1], y = (double)a[2] };
        }

        public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
        {
            var m = (MoveEntry)value;
            writer.WriteStartArray();
            writer.WriteValue(m.id);
            writer.WriteValue(m.x);
            writer.WriteValue(m.y);
            writer.WriteEndArray();
        }
    }

    public static class ServerMsgParser
    {
        static readonly JsonSerializer Serializer = JsonSerializer.Create(new JsonSerializerSettings
        {
            MissingMemberHandling = MissingMemberHandling.Ignore,
            NullValueHandling = NullValueHandling.Include,
            // Replace (not append to) the lists that the field initialisers start with.
            ObjectCreationHandling = ObjectCreationHandling.Replace,
        });

        /// <summary>Parse one message. Throws JsonException when it isn't JSON or has no `t`.</summary>
        public static ServerMsg Parse(string json) => Parse(JObject.Parse(json));

        public static ServerMsg Parse(JObject o)
        {
            string t = (string)o["t"];
            if (t == null) throw new JsonSerializationException("message has no `t`");
            ServerMsg m;
            switch (t)
            {
                case "hello": m = o.ToObject<HelloMsg>(Serializer); break;
                case "frame": m = o.ToObject<FrameMsg>(Serializer); break;
                case "event": m = new EventMsg { @event = o["event"] as JObject }; break;
                case "speech": m = o.ToObject<SpeechMsg>(Serializer); break;
                case "ui": m = ParseUi(o); break;
                case "feed": m = o.ToObject<FeedMsg>(Serializer); break;
                case "prompt": m = o.ToObject<PromptMsg>(Serializer); break;
                case "replaced": m = new ReplacedMsg(); break;
                case "error": m = o.ToObject<ErrorMsg>(Serializer); break;
                default: m = new UnknownMsg { raw = o }; break;
            }
            m.t = t;
            return m;
        }

        static UiMsg ParseUi(JObject o)
        {
            var ui = o["ui"] as JObject ?? new JObject();
            var keys = new List<string>();
            foreach (var p in ui.Properties()) keys.Add(p.Name);
            return new UiMsg { ui = ui.ToObject<UiModel>(Serializer) ?? new UiModel(), keys = keys };
        }

        /// <summary>Deserialise any JSON into one of the protocol types (for tests and tools).</summary>
        public static T To<T>(JToken token) => token.ToObject<T>(Serializer);
    }
}
