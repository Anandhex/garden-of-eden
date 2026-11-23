// Who a person is (PersonSpec, straight from the frame's actor look) and what they are made of (PersonRecipe): every pick of the
// character system, made deterministically from the stable id plus species, sex, age band, class/job and culture. Same inputs, same
// person, on every machine. Each category draws from its own random stream (seeded by the id and the category name), so changing
// the outfit does not reshuffle the face. Pure logic: no Unity objects are touched here.
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public struct PersonSpec
    {
        public string id, species, sex, age, cls, job, culture, tint, trim;
        public bool noble, lowborn, hostile, player;

        public static PersonSpec From(Actor a, bool player)
        {
            var l = a.look ?? new ActorLook();
            return new PersonSpec
            {
                id = a.id, species = l.species, sex = l.sex, age = l.age, cls = l.cls, job = !string.IsNullOrEmpty(l.job) ? l.job : a.label,
                culture = l.culture, tint = l.tint, trim = l.trim, player = player,
                noble = a.HasFlag(ActorFlag.Noble), lowborn = a.HasFlag(ActorFlag.Lowborn), hostile = a.HasFlag(ActorFlag.Hostile),
            };
        }

        /// <summary>Everything that changes how the person is built (the cache key).</summary>
        public string Key() => id + "|" + species + "|" + sex + "|" + age + "|" + cls + "|" + job + "|" + culture + "|" + tint + "|" + trim + "|" + noble + lowborn + hostile + player;
    }

    public sealed class Rng
    {
        uint s;
        public Rng(uint seed) { s = seed == 0 ? 0x9e3779b9u : seed; Next(); Next(); }
        public uint Next() { unchecked { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; } }
        public float F() => (Next() & 0xFFFFFF) / 16777216f;
        public float R(float a, float b) => a + (b - a) * F();
        public bool Chance(float p) => F() < p;
        public int I(int n) => n <= 1 ? 0 : (int)(Next() % (uint)n);
        public T Pick<T>(IList<T> l) => l.Count == 0 ? default : l[I(l.Count)];
    }

    public sealed class PersonRecipe
    {
        public PersonSpec spec;
        public string species = "human", ageBand = "adult", cls = "labourer";
        public bool female;
        public readonly Dictionary<string, float> shapes = new Dictionary<string, float>();
        public float rootScale = 1f, height = 1.75f;
        // parts
        public string noseFbx = "base_body", noseObj = "Part_Nose", earFbx = "base_body", earL = "Part_Ear_L", earR = "Part_Ear_R", hairObj, beardObj;
        public readonly List<string> extraBody = new List<string>();
        public PartEntry eye, brow, mouth, beardDecal;
        // colours (display values)
        public Color skin, hair, iris, lip, tint, trim;
        // outfit
        public Outfit outfit;
        public readonly List<ClothPiece> pieces = new List<ClothPiece>();
        public readonly HashSet<string> hides = new HashSet<string>();
        public bool headwear;
        public string describe;

        // ------------------------------------------------------------------ job and class words

        static readonly string[][] ClassWords =
        {
            new[] { "child", "child", "kid" }, new[] { "elder", "elder" }, new[] { "slave", "slave", "beggar" },
            new[] { "guard", "guard", "watch", "sentry", "constable", "warden", "knight", "courier", "captain", "sheriff", "militia" },
            new[] { "soldier", "soldier", "sellsword", "adventurer", "mercenary", "bandit", "raider", "patrol" },
            new[] { "smith", "smith", "forge", "armourer", "blacksmith" },
            new[] { "priest", "priest", "acolyte", "cleric", "monk", "pilgrim", "shrine", "healer" },
            new[] { "scholar", "scholar", "clerk", "scribe", "sage", "herbalist", "official" },
            new[] { "noble", "noble", "royal", "courtier", "lord", "lady", "mayor", "king", "queen", "gentry", "baron", "duke" },
            new[] { "merchant", "merchant", "stallholder", "innkeeper", "baker", "weaver", "tailor", "cobbler", "potter", "trader", "shopkeeper", "tavern", "caravan", "market" },
            new[] { "farmer", "farmer", "fisher", "hunter", "shepherd", "serf", "villager", "peasant" },
            new[] { "labourer", "labourer", "porter", "washer", "carpenter", "miner", "apprentice", "server", "servant", "commoner", "worker", "herder" },
            new[] { "traveller", "traveller", "refugee", "migrant", "kin", "coach", "tourney" },
        };

        public static string ClassOf(string job, string cls, bool noble, bool lowborn, bool hostile, string age)
        {
            if (age == "child") return "child";
            string t = ((job ?? "") + " " + (cls ?? "")).ToLowerInvariant();
            if (cls == "slave" || lowborn) return "slave";
            foreach (var row in ClassWords)
                for (int i = 1; i < row.Length; i++) if (t.Contains(row[i])) return row[0];
            if (hostile) return "soldier";
            if (noble || cls == "noble" || cls == "gentry" || cls == "royal") return "noble";
            if (cls == "merchant" || cls == "artisan") return "merchant";
            if (cls == "clergy") return "priest";
            if (cls == "serf") return "farmer";
            if (age == "elder" || age == "venerable") return "elder";
            return "labourer";
        }

        static readonly Dictionary<string, string[]> ClassTags = new Dictionary<string, string[]>
        {
            { "child", new[] { "child", "rustic" } }, { "elder", new[] { "elder", "frail", "common" } }, { "slave", new[] { "rustic", "frail", "outcast" } },
            { "guard", new[] { "soldier", "stern", "fighter", "worker" } }, { "soldier", new[] { "soldier", "fighter", "stern", "rogue" } },
            { "smith", new[] { "smith", "worker", "masculine", "brute" } }, { "priest", new[] { "monk", "scholar", "gentle" } },
            { "scholar", new[] { "scholar", "gentle", "courtly" } }, { "noble", new[] { "noble", "courtly", "performer" } },
            { "merchant", new[] { "merchant", "common", "courtly" } }, { "farmer", new[] { "rustic", "worker", "common" } },
            { "labourer", new[] { "worker", "rustic", "common" } }, { "traveller", new[] { "wanderer", "rogue", "common" } },
        };

        // ------------------------------------------------------------------ the recipe

        public static PersonRecipe Make(PersonSpec spec, PersonCatalog cat)
        {
            var r = new PersonRecipe { spec = spec };
            uint seed = Hash.Str(spec.id ?? "?");
            Rng Stream(string name) => new Rng(seed ^ Hash.Str(name) * 2654435761u);

            // ---- the basics
            r.species = !string.IsNullOrEmpty(spec.species) && cat.species.ContainsKey(spec.species) ? spec.species : "human";
            var sp = cat.species[r.species];
            var rs = Stream("basics");
            r.female = spec.sex == "f" || (spec.sex != "m" && (rs.Next() & 1) == 1);
            string age = spec.age ?? "adult";
            r.ageBand = age == "child" ? "child" : age == "elder" || age == "venerable" ? "elder" : "adult";
            r.cls = ClassOf(spec.job, spec.cls, spec.noble, spec.lowborn, spec.hostile, age);
            string cultureKey = string.IsNullOrEmpty(spec.culture) ? "any" : spec.culture;
            string sexWord = r.female ? "feminine" : "masculine";
            string ageWord = r.ageBand;
            var tags = new HashSet<string>(ClassTags.TryGetValue(r.cls, out var ct) ? ct : new string[0]) { sexWord, r.species };
            if (r.ageBand == "adult" && rs.Chance(0.4f)) tags.Add("young");
            if (r.ageBand != "child") tags.Remove("child");
            if (spec.hostile) { tags.Add("outcast"); tags.Add("rogue"); tags.Add("brute"); }
            r.describe = r.species + " " + sexWord + " " + age + " " + r.cls;

            // ---- body and face shape weights
            r.MakeShapes(sp, Stream("shape"), cat);

            float jitter = 0.97f + Stream("height").F() * 0.06f;
            r.rootScale = (r.female ? sp.rootScaleF : sp.rootScaleM) * jitter;
            r.height = (r.female ? sp.heightF : sp.heightM) * jitter;
            if (r.ageBand == "child") { r.rootScale *= 0.74f; r.height *= 0.74f; }
            else if (r.ageBand == "elder") { r.rootScale *= 0.97f; r.height *= 0.97f; }

            // ---- colours
            r.skin = SkinColour(sp, Stream("skin"));
            if (r.ageBand == "elder") r.skin = Color.Lerp(r.skin, new Color(0.85f, 0.78f, 0.72f), 0.12f);
            r.hair = HairColour(r.species, r.ageBand, spec.age == "venerable", Stream("haircolour"), cat);

            // ---- outfit (decides whether headwear is worn: hair must then be a hat variant)
            r.PickOutfit(cat, cultureKey, Stream("outfit"));

            // ---- parts
            var pr = Stream("parts");
            r.eye = Choose(cat.parts["eyes"], r, tags, Stream("eyes"));
            r.brow = Choose(cat.parts["eyebrows"], r, tags, Stream("brows"));
            r.mouth = Choose(cat.parts["mouths"], r, tags, Stream("mouth"));
            var nose = Choose(cat.parts["noses"], r, tags, Stream("nose"));
            if (nose != null && nose.meshObjects.Length > 0) { r.noseObj = nose.meshObjects[0]; r.noseFbx = FbxKey(nose.file); }
            else r.noseObj = sp.nose;
            var ears = Choose(cat.parts["ears"], r, tags, Stream("ears"));
            if (ears != null && ears.meshObjects.Length >= 2) { r.earL = ears.meshObjects[0]; r.earR = ears.meshObjects[1]; r.earFbx = FbxKey(ears.file); }
            else if (sp.ears.Length >= 2) { r.earL = sp.ears[0]; r.earR = sp.ears[1]; }

            // hair: not for the shaven-headed, always a hat variant under a hat
            var hairPool = cat.parts["hair"].Where(h => h.meshObjects.Length > 0).ToList();
            var hair = Choose(hairPool, r, tags, Stream("hair"), skipVariants: true);
            if (hair != null)
            {
                string obj = hair.meshObjects[0];
                if (r.headwear && !hair.hatCompatible && !string.IsNullOrEmpty(hair.hatVariant)) obj = hair.hatVariant;
                r.hairObj = obj;
            }

            // beards: men (and the odd dwarven woman), by species, age and trade
            float beardChance = 0f;
            if (!r.female && r.ageBand != "child")
            {
                switch (r.species)
                {
                    case "dwarf": beardChance = 0.92f; break;
                    case "elf": beardChance = 0.05f; break;
                    case "orc": beardChance = 0.25f; break;
                    case "halfling": beardChance = 0.2f; break;
                    default: beardChance = r.ageBand == "elder" ? 0.6f : 0.42f; break;
                }
                if (r.cls == "smith" || r.cls == "soldier" || r.cls == "labourer" || r.cls == "farmer") beardChance += 0.15f;
                if (r.cls == "noble" || r.cls == "scholar") beardChance -= 0.1f;
            }
            else if (r.female && r.species == "dwarf" && r.ageBand != "child") beardChance = 0.15f;
            var rb = Stream("beard");
            if (rb.F() < beardChance)
            {
                var beards = Choose(cat.parts["beards"], r, tags, rb);
                if (beards != null)
                {
                    if (beards.decal) r.beardDecal = beards;
                    else if (beards.meshObjects.Length > 0) r.beardObj = beards.meshObjects[0];
                }
            }

            // orc tusks (an extra body part of the preset)
            if (r.species == "orc" && sp.extra.Length >= 2 && r.ageBand != "child")
            {
                string v = pr.Chance(0.6f) ? "A" : "B";
                r.extraBody.Add("Part_Tusk_" + v + "_L"); r.extraBody.Add("Part_Tusk_" + v + "_R");
            }

            // iris and lips
            r.iris = r.eye != null && cat.irisPalette.TryGetValue(r.eye.defaultColour ?? "brown", out var ic) ? ic : new Color(0.45f, 0.27f, 0.13f);
            var ri = Stream("iris");
            if (r.species != "orc" && r.eye != null && !r.eye.HasTag("elf") && !r.eye.HasTag("rogue") && ri.Chance(0.3f))
            {
                string[] natural = { "brown", "dark_brown", "hazel", "green", "blue", "grey", "amber" };
                r.iris = cat.irisPalette[ri.Pick(natural)];
            }
            r.lip = r.mouth != null && cat.lipPalette.TryGetValue(r.mouth.defaultColour ?? "natural", out var lc) ? lc : new Color(0.8f, 0.42f, 0.4f);

            // garment colours: the server's look.tint / look.trim, else the outfit's own
            var rt = Stream("tint");
            Color tint = r.outfit != null ? r.outfit.tint : new Color(0.5f, 0.45f, 0.4f);
            if (!string.IsNullOrEmpty(spec.tint) && ColorUtility.TryParseHtmlString(spec.tint, out var st)) tint = st;
            // the server's tint is per class or trade (everyone of a class would match): mix it with a hashed earthy dye (G8: olive, navy,
            // oxblood, leather browns, slate, rust, moss, mustard...), so the class still reads but no two neighbours dress alike
            Color dye = Earthy[rt.I(Earthy.Length)];
            tint = Color.Lerp(tint, dye, rt.R(0.35f, 0.7f));
            if (spec.lowborn) tint = Color.Lerp(tint, new Color(0.54f, 0.48f, 0.38f), 0.5f);
            // people of one trade share a tint on the server (caravan orange...): a little hashed variety keeps a crowd from looking uniform
            Color.RGBToHSV(tint, out float th, out float ts, out float tv);
            th = Mathf.Repeat(th + rt.R(-0.03f, 0.03f), 1f); ts = Mathf.Clamp01(ts * rt.R(0.85f, 1.1f)); tv = Mathf.Clamp01(tv * rt.R(0.88f, 1.08f));
            r.tint = Color.HSVToRGB(th, ts, tv);
            Color trim = r.outfit != null ? r.outfit.trim : new Color(0.75f, 0.58f, 0.3f);
            if (rt.Chance(0.45f)) trim = Accents[rt.I(Accents.Length)];
            if (!string.IsNullOrEmpty(spec.trim) && ColorUtility.TryParseHtmlString(spec.trim, out var tr)) trim = tr;
            r.trim = trim;
            return r;
        }

        static readonly Color[] Earthy =
        {
            new Color(0.42f, 0.44f, 0.27f), new Color(0.22f, 0.27f, 0.40f), new Color(0.45f, 0.20f, 0.18f), new Color(0.40f, 0.29f, 0.19f),
            new Color(0.33f, 0.37f, 0.40f), new Color(0.55f, 0.32f, 0.20f), new Color(0.30f, 0.38f, 0.28f), new Color(0.62f, 0.50f, 0.26f),
            new Color(0.36f, 0.28f, 0.36f), new Color(0.58f, 0.54f, 0.44f), new Color(0.24f, 0.34f, 0.36f), new Color(0.50f, 0.42f, 0.32f),
        };
        static readonly Color[] Accents = { new Color(0.80f, 0.62f, 0.28f), new Color(0.72f, 0.36f, 0.22f), new Color(0.86f, 0.80f, 0.66f), new Color(0.50f, 0.18f, 0.20f), new Color(0.70f, 0.56f, 0.36f) };

        static string FbxKey(string file) => string.IsNullOrEmpty(file) ? "base_body" : System.IO.Path.GetFileNameWithoutExtension(file);

        // ------------------------------------------------------------------ choosing parts

        static bool Fits(PartEntry p, PersonRecipe r)
        {
            if (!p.Has(p.species, r.species)) return false;
            if (!p.Has(p.sexes, r.female ? "F" : "M")) return false;
            if (!p.Has(p.ages, r.ageBand)) return false;
            return true;
        }

        static readonly HashSet<string> SpeciesTags = new HashSet<string> { "elf", "dwarf", "orc", "halfling", "human" };

        static PartEntry Choose(IList<PartEntry> pool, PersonRecipe r, HashSet<string> tags, Rng rng, bool skipVariants = false)
        {
            PartEntry best = null; float total = 0f;
            var w = new List<(PartEntry, float)>();
            foreach (var p in pool)
            {
                if (skipVariants && p.HasTag("hat-variant")) continue;
                if (!Fits(p, r)) continue;
                float score = 1f;
                foreach (var t in p.tags)
                {
                    if (tags.Contains(t)) score += 2.2f;
                    else if (SpeciesTags.Contains(t)) score *= 0.06f;      // an elf's ears are not for a human
                    else if (t == "child" || t == "elder") score *= 0.35f;
                    else if (t == "masculine" || t == "feminine") score *= 0.6f;
                }
                if (p.HasTag("common") || p.HasTag("any")) score += 1.2f;
                w.Add((p, score)); total += score;
            }
            if (w.Count == 0)
            {
                // nothing fits all filters: relax sex and age, keep the species
                foreach (var p in pool) if (p.Has(p.species, r.species) && !p.HasTag("hat-variant")) { w.Add((p, 1f)); total += 1f; }
                if (w.Count == 0) return pool.Count > 0 ? pool[0] : null;
            }
            float roll = rng.F() * total;
            foreach (var (p, s) in w) { roll -= s; if (roll <= 0f) { best = p; break; } }
            return best ?? w[w.Count - 1].Item1;
        }

        // ------------------------------------------------------------------ shapes

        void MakeShapes(SpeciesPreset sp, Rng r, PersonCatalog cat)
        {
            void Set(string n, float v) { if (v > 0.001f) shapes[n] = Mathf.Clamp01(v); }
            foreach (var kv in sp.shapes) shapes[kv.Key] = kv.Value;
            Set("Sex", female ? 1f : 0f);
            bool child = ageBand == "child", elder = ageBand == "elder";
            string c = cls;
            bool heavyWork = c == "smith" || c == "guard" || c == "soldier" || c == "labourer" || c == "farmer";
            float muscle = heavyWork ? r.R(0.4f, 0.9f) : r.R(0.02f, 0.3f);
            if (female) muscle *= 0.55f;
            if (elder) muscle *= 0.5f;
            if (child)
            {
                Set("Child", 1f);
                Set("Height_Legs", r.R(0f, 0.3f));
            }
            else
            {
                Set("Age_Old", elder ? (spec.age == "venerable" ? r.R(0.85f, 1f) : r.R(0.5f, 0.85f)) : r.R(0f, 0.2f));
                if (!female) { Set("Shoulders", r.R(0.15f, 0.7f)); Set("Chest_Muscle", muscle * 0.9f); }
                else { Set("Breast", r.R(0.15f, 0.85f)); Set("Hips", r.R(0.3f, 0.85f)); Set("Butt", r.R(0.2f, 0.8f)); }
                float build = r.F();
                if (build < 0.22f) Set("Thin", r.R(0.3f, 0.8f));
                else if (build > 0.72f) { Set("Heavy", r.R(0.3f, 0.8f)); Set("Belly", r.R(female ? 0.1f : 0.25f, female ? 0.45f : 0.75f)); }
                if (r.Chance(0.3f)) Set(r.Chance(0.5f) ? "Waist_Slim" : "Waist_Wide", r.R(0.2f, 0.55f));
                Set("Muscle", muscle);
                Set("Arms_Thick", muscle * 0.6f + r.R(0f, 0.2f));
                Set("Legs_Thick", muscle * 0.4f + r.R(0f, 0.25f));
                Set("Height_Legs", r.R(0.05f, 0.75f));
                if (elder) { shapes.Remove("Chest_Muscle"); }
            }
            Set("Neck_Long", r.R(0.05f, 0.55f));

            // face
            float fl = r.F();
            if (fl < 0.28f) Set("Face_Long", r.R(0.25f, 0.8f)); else if (fl < 0.55f) Set("Face_Short", r.R(0.25f, 0.8f));
            if (r.Chance(0.5f)) Set(r.Chance(0.5f) ? "Jaw_Wide" : "Jaw_Square", r.R(0.2f, female ? 0.45f : 0.8f));
            Set("Cheeks_Full", shapes.ContainsKey("Heavy") ? r.R(0.3f, 0.8f) : r.R(0f, 0.45f));
            if (r.Chance(0.55f)) Set("Cheekbones", shapes.ContainsKey("Thin") ? r.R(0.4f, 0.8f) : r.R(0.1f, 0.5f));
            Set("Forehead_High", r.R(0f, 0.5f));
            Set("Brow_Ridge", female ? r.R(0f, 0.25f) : r.R(0.15f, 0.65f));
            Set("Nose_Bridge", r.R(0f, 0.5f));
            Set("Ears_Back", r.R(0f, 0.4f));
            // eyes
            Set("Eye_Big", female ? r.R(0.15f, 0.75f) : r.R(0.05f, 0.5f));
            Set("Eye_Spacing", r.R(0f, 0.5f));
            string[] eyeShapes = { "Eye_Round", "Eye_Almond", "Eye_Narrow", "Eye_Hooded", "Eye_Monolid", null, null };
            string es = r.Pick(eyeShapes);
            if (es != null) Set(es, r.R(0.35f, 0.9f));
            if (r.Chance(0.35f)) Set(r.Chance(0.5f) ? "Eye_TiltUp" : "Eye_TiltDown", r.R(0.2f, 0.6f));
            Set("Eye_Deep", r.R(0f, 0.45f)); Set("Eye_Protrude", r.R(0f, 0.25f)); Set("Eye_Height", r.R(0f, 0.45f));
            // chin: up to two of four independent groups
            string[][] chin = { new[] { "Chin_Small", "Chin_Big" }, new[] { "Chin_Wide", "Chin_Narrow" }, new[] { "Chin_Forward", "Chin_Back" }, new[] { "Chin_Pointed", "Chin_Long", "Chin_Cleft" } };
            int picks = r.I(3);
            var used = new HashSet<int>();
            for (int i = 0; i < picks; i++)
            {
                int g = r.I(chin.Length);
                if (!used.Add(g)) continue;
                Set(r.Pick(chin[g]), r.R(0.3f, 0.85f));
            }
            // lips and mouth
            Set("Lips_Full", female ? r.R(0.2f, 0.85f) : r.R(0f, 0.5f));
            if (r.Chance(0.35f)) Set("Lips_UpperFull", r.R(0.2f, 0.6f));
            if (r.Chance(0.35f)) Set("Lips_LowerFull", r.R(0.2f, 0.6f));
            if (!shapes.ContainsKey("Lips_Full") && r.Chance(0.3f)) Set("Lips_Thin", r.R(0.3f, 0.8f));
            if (r.Chance(0.3f)) Set("Lips_CupidBow", r.R(0.2f, 0.6f));
            if (r.Chance(0.15f)) Set("Lips_Pout", r.R(0.2f, 0.6f));
            if (r.Chance(0.3f)) Set(r.Chance(0.5f) ? "Mouth_Wide" : "Mouth_Narrow", r.R(0.2f, 0.6f));
            if (r.Chance(0.35f)) Set(r.Chance(0.6f) ? "Mouth_CornersUp" : "Mouth_CornersDown", r.R(0.2f, 0.55f));
        }

        // ------------------------------------------------------------------ colours

        static Color SkinColour(SpeciesPreset sp, Rng r)
        {
            if (sp.skin.Length == 0) return new Color(0.9f, 0.7f, 0.58f);
            // a blend of two of the species' three anchor colours, plus a little value jitter
            var a = sp.skin[r.I(sp.skin.Length)]; var b = sp.skin[r.I(sp.skin.Length)];
            var c = Color.Lerp(a, b, r.F());
            float v = r.R(0.95f, 1.04f);
            return new Color(Mathf.Clamp01(c.r * v), Mathf.Clamp01(c.g * v), Mathf.Clamp01(c.b * v));
        }

        static Color HairColour(string species, string age, bool venerable, Rng r, PersonCatalog cat)
        {
            string[] pool;
            switch (species)
            {
                case "orc": pool = new[] { "black", "black", "green_orc", "blue_black", "dark_brown", "grey" }; break;
                case "elf": pool = new[] { "blonde", "platinum", "silver", "black", "chestnut", "copper_red", "white" }; break;
                case "dwarf": pool = new[] { "brown", "dark_brown", "ginger", "copper_red", "black", "auburn", "grey" }; break;
                case "halfling": pool = new[] { "brown", "chestnut", "blonde", "dark_brown", "ginger", "auburn" }; break;
                default: pool = new[] { "black", "dark_brown", "dark_brown", "brown", "brown", "chestnut", "auburn", "blonde", "ginger", "blue_black" }; break;
            }
            string pick = r.Pick(pool);
            if (age == "elder") { float g = venerable ? 0.9f : 0.55f; if (r.Chance(g)) pick = r.Pick(new[] { "grey", "grey", "silver", "white" }); }
            return cat.hairPalette.TryGetValue(pick, out var c) ? c : new Color(0.3f, 0.2f, 0.1f);
        }

        // ------------------------------------------------------------------ outfits

        static bool Contains(string[] l, string v) { if (l == null) return false; foreach (var x in l) if (x == v) return true; return false; }

        void PickOutfit(PersonCatalog cat, string culture, Rng rng)
        {
            string sexWord = female ? "feminine" : "masculine";
            string ageWord = ageBand;
            // score every outfit, then pick among the near-best by a hashed weight (not always the single best: a street of farmers
            // should not all wear the same clothes)
            var scored = new List<(Outfit o, float s)>();
            float bestScore = float.MinValue;
            foreach (var o in cat.outfits)
            {
                float s = 0f;
                if (o.cls == cls) s += 10f; else if (cls == "elder" && o.age == "elder") s += 6f; else if (SimilarClass(cls, o.cls)) s += 5f; else s -= 6f;
                if (o.culture == culture) s += 3f; else if (o.culture == "any") s += 1f; else if (culture == "any") s += 1f;
                if (o.sex == sexWord) s += 3f;
                else if (o.sex != null && o.sex != "" && o.sex != "any") s -= AllPiecesFit(o, cat) ? 1f : 4f;
                if (o.age == ageWord) s += 2f; else if (ageWord == "child" || o.age == "child") s -= 8f;
                scored.Add((o, s));
                if (s > bestScore) bestScore = s;
            }
            Outfit best = null; float tot = 0f;
            foreach (var x in scored) if (x.s >= bestScore - 5.5f) tot += 1f + (x.s - bestScore + 5.5f);
            float roll = rng.F() * tot;
            foreach (var x in scored)
            {
                if (x.s < bestScore - 5.5f) continue;
                roll -= 1f + (x.s - bestScore + 5.5f);
                if (roll <= 0f) { best = x.o; break; }
            }
            if (best == null && scored.Count > 0) best = scored[0].o;
            outfit = best;
            if (best == null) return;
            foreach (var pid in best.pieces)
            {
                if (!cat.pieces.TryGetValue(pid, out var p)) continue;
                // pieces of the outfit for this person's sex, age and species (a kilt on a woman stays; a codpiece would not)
                if (p.sexes.Length > 0 && !Contains(p.sexes, sexWord)) continue;
                if (p.species.Length > 0 && !Contains(p.species, species)) continue;
                if (p.ages.Length > 0 && !Contains(p.ages, ageWord)) continue;
                // some of the working folk go bare-headed
                if (p.slot == "headwear" && (cls == "farmer" || cls == "labourer" || cls == "merchant" || cls == "traveller" || cls == "child" || cls == "elder" || cls == "slave") && rng.Chance(0.6f)) continue;
                if (p.slot == "headwear" && (cls == "scholar" || cls == "noble" || cls == "priest") && rng.Chance(0.35f)) continue;
                if ((p.slot == "overlay" || p.slot == "headwear") && rng.Chance(0.3f))
                {
                    // borrow the same kind of piece from another outfit of a similar class (a sash for an apron, a hood for a cap)
                    ClothPiece alt = null; int seen = 0;
                    foreach (var o in cat.outfits)
                    {
                        if (o == best || !(o.cls == cls || SimilarClass(cls, o.cls))) continue;
                        foreach (var q in o.pieces)
                            if (cat.pieces.TryGetValue(q, out var cp) && cp.slot == p.slot && cp.id != p.id && (cp.species.Length == 0 || Contains(cp.species, species)) && (cp.sexes.Length == 0 || Contains(cp.sexes, sexWord)))
                            { seen++; if (rng.I(seen) == 0) alt = cp; }
                    }
                    if (alt != null) p = alt;
                }
                pieces.Add(p);
                foreach (var h in p.hides) hides.Add(h);
                if (p.slot == "headwear") headwear = true;
            }
        }

        static bool SimilarClass(string a, string b)
        {
            string[][] groups = { new[] { "guard", "soldier" }, new[] { "farmer", "labourer", "traveller" }, new[] { "merchant", "noble", "scholar" }, new[] { "priest", "scholar", "elder" }, new[] { "slave", "labourer" } };
            foreach (var g in groups) if (Array.IndexOf(g, a) >= 0 && Array.IndexOf(g, b) >= 0) return true;
            return false;
        }

        bool AllPiecesFit(Outfit o, PersonCatalog cat)
        {
            string sexWord = female ? "feminine" : "masculine";
            foreach (var pid in o.pieces) if (cat.pieces.TryGetValue(pid, out var p) && p.sexes.Length > 0 && !Contains(p.sexes, sexWord)) return false;
            return true;
        }
    }
}
