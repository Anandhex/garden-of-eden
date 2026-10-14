[← Plans](README.md) · [Stage 2: N29](../stage-2-everyone-lives.md#n29-a-soundscape)

# N29 plan: A soundscape

**In one line:** the browser picks a mix of sound **beds** (always-on loops) and **spots** (one-off sounds at a place on the map) from what it already knows: the place, the area, the hour, the weather, the crowd near the player, the wildlife, the mood. A pure function in shared code decides *what should be heard*, and a small Web Audio engine in the client plays it, so the server does no work.

**Read first:** [plans README](README.md) sections 7 (shared code), 9 (performance), 18 (client layers). Needs N16 (the crowd), N26 (road chunks, weather on the road). Uses N28 (species calls), N36 (mood), N58 (curfew), N62 (fires) and N41 (music) **when they exist**. Until then those inputs are simply absent, and the mix works without them.

## What exists

- **No game sound at all.** The only audio is speech: [`voice/speaker.ts`](../../../packages/client/src/voice/speaker.ts) plays Piper or system voices through `new Audio(url)` / `speechSynthesis`. Voice prefs are in [`voice/prefs.ts`](../../../packages/client/src/voice/prefs.ts) (localStorage).
- **What the client knows each frame:** the clock (`store.ts`), the site map and its buildings (`SiteMap` with `kind` per building: smithy, inn, temple, market…), the crowd's positions and activities (`CrowdSim` in [`shared/crowd.ts`](../../../packages/shared/src/crowd.ts): who is working, chatting, at the market), weather (sent in the state; `weatherOn(day)` in [`weather.ts`](../../../packages/server/src/game/weather.ts): clear, cloudy, rain, storm, snow, fog…), road chunks with biome tiles (`chunkAt`), travellers (`travellers.ts`), and realm packs near the player (their ground, N26 `threats.ts`).
- Today's town events ([`events-calendar.ts`](../../../packages/server/src/game/events-calendar.ts): market day, festival, raid night) are in the state the client gets.

## Decisions made in this plan

1. **Two kinds of sound.** **Beds** are looping layers with a target volume (rain, wind, crowd murmur, night insects, birdsong, river). **Spots** are short one-shots placed on the map (a hammer on the anvil, a dog barking, a bell, an owl, a cart), panned and attenuated by distance from the player. The mix changes by fading beds toward new targets over 2–4 seconds, never by cutting.
2. **A pure "what should be heard" function in shared code.** `soundscape(input) → { beds: Record<BedId, number /*0..1*/>, spots: SpotRule[] }` in `packages/shared/src/sound/scape.ts`. The input is plain data (place kind, area, biome under the player, minute of day, weather, season, counts of people near by activity, buildings near with distance, wildlife near, mood, curfew, events). This function is unit-tested without a browser. The client engine only plays what it returns.
3. **Synthesis first, samples where synthesis sounds bad.** Rain, wind, river, fire, crowd murmur and insects are made from filtered noise in Web Audio (no files, no licences, tiny). Birdsong, owls, bells, hammer, dog, horse, cart, crowd shouts, music are **CC0 samples** in `packages/client/public/audio/` with a `manifest.json` (`id, file, licence, source, gain, variants`). Keep the total under ~3 MB (ogg/opus, mono, short). **Question 1** asks the user about this.
4. **Spots are seeded, not random.** Which spot plays when comes from `hashStr(placeId, minute, source)` (the crowd's own hash), so two players standing in the same spot hear the same things, and tests are deterministic. The smith hammers only while the smith's crowd activity is `work` in the smithy.
5. **Off by default in tests and headless runs.** The engine starts only after a user gesture (browsers require it) and only if `prefs.sound.enabled`. Tests use the shared function and a fake engine.
6. **The mix has four channels** (ambience, life, events, music) plus the existing voices, with a master volume. Voices duck the others by 40% while someone speaks (`speaker.ts` emits start/end).

## Data shapes

```ts
// packages/shared/src/sound/types.ts
export const BEDS = ["wind", "rain_roof", "rain_open", "storm", "snow_hush", "river", "sea", "crowd_murmur", "market", "insects_night", "frogs", "birds_day", "birds_dawn", "fire_hearth", "tavern"] as const;
export interface ScapeInput {
  where: { kind: "site" | "road" | "interior"; area?: string; biome?: string; building?: string };
  minute: number; season: Season; weather: Weather;
  near: { people: number; working: Record<string, number>; chatting: number; children: number; livestock: number };
  buildings: Array<{ kind: string; d: number; dx: number }>;     // within 20 tiles
  wildlife?: Array<{ species: string; d: number; dx: number }>;   // N28
  predatorsNear?: boolean;                                          // a pack's ground (N26 threats) or N28's predator radius
  mood?: { grief: number; fear: number; joy: number };              // N36
  curfew?: boolean; events?: Array<"market" | "festival" | "raid" | "battle" | "fire" | "bard">;
}
export interface SpotRule { id: string; source: string; every: [number, number] /* seconds */; gain: number; dx: number; d: number; }
```

## Steps

### Step 1: the shared scape function
- `shared/src/sound/scape.ts` with tables in `shared/src/sound/tables.ts`: bed targets by weather, biome, hour band (dawn 4–7, day, dusk 18–21, night), crowd size (murmur ∝ log of people near), and the building spot table (smithy → hammer while working, mill → wheel, temple → bell on the hour from 6 to 20, inn → tavern bed when inside or within 6 tiles at evening, stable → horse).
- Rules from the stage file: birdsong at dawn; market bed on market days in the market zone by day; crickets/owls at night; under a curfew the murmur and tavern go to 0 and a "watch" spot (footsteps, a call of the hour) plays; grief lowers the murmur and the tavern; a predator near silences small birds (`birds_day` → 0.1).
- Test (`shared/tests/sound.test.ts`): dawn vs noon vs midnight in the same square give different beds; rain gives `rain_roof` in a village and `rain_open` on the road; curfew silences the murmur; a predator near takes birds down.

### Step 2: the client engine
- `client/src/audio/engine.ts`: one `AudioContext`, channel gains, a bed per id (noise-synth or looped sample) with `setTarget(v, seconds)`; a spot player with `StereoPannerNode` and distance gain; a voice-duck hook from `speaker.ts`.
- `client/src/audio/synth.ts`: noise generators for rain (band-passed noise with random droplet clicks), wind (low-passed noise with slow gusts), river, fire, crowd murmur (several band-passed noises modulated at speech rates), insects.
- `client/src/audio/samples.ts`: loads `manifest.json` lazily, decodes on first use, caches buffers.
- Starts on the first click/key after the page loads; resumes on tab focus; stops in hidden tabs.

### Step 3: wiring the inputs
- `client/src/audio/inputs.ts` builds `ScapeInput` once a second from the store, the crowd (counts within 12 tiles by activity), the site map (buildings within 20 tiles), road chunk biome, travellers near, threats near, weather and the day's events. Cheap: one pass over people already positioned for drawing.
- Interiors (N32) and road mode change `where`.

### Step 4: settings
- A Sound section in the settings modal ([`ui/modals.ts`](../../../packages/client/src/ui/modals.ts)): on/off, master, ambience, life, events, music, voice duck on/off. Stored like voice prefs. Default **on in the browser** after the first gesture, off in tests (`import.meta.env.MODE === "test"`).

### Step 5: events and later inputs
- Battle at a distance (a war battle at or near this place today), fire's roar and shouting (N62 when built, or a raid's burning: the raid night from `events-calendar`), festival music (N30's festivals or today's `festival`), a bard in the inn (N41 when built; until then a lute bed in the inn on evenings).
- N28 calls: each species file gets an optional `calls: { id, file, when: "dawn" | "day" | "dusk" | "night" }`, and the wildlife near the player plays them as spots. Until N28, a small fixed table by biome (forest: woodpecker, cuckoo; marsh: frogs; hills: hawk).

### Step 6: docs and play
- README: what the player hears and the settings; `public/audio/LICENCES.md` listing every sample's source and licence (CC0 only).
- Play: stand in the start town's square from 05:00 to 23:00 with time sped up (admin fast-forward), walk into the woods, wait for rain. Write what was heard.

## Edge cases and traps

- **Autoplay rules:** never create the `AudioContext` before a user gesture; the first click starts it. Safari needs `webkitAudioContext` fallback and `resume()` on each gesture until it runs.
- **CPU on the M2 with the model loaded:** at most ~8 beds running (the rest at gain 0 are *stopped*, not silent), at most 6 spots at once, synth nodes reused. Measure in `bench` with the frame budget (N19): sound must not cost frames.
- **Time sped up** (admin fast-forward, fast travel): the scape function is called once a second of real time, not per game minute, and spots are throttled, or a fast-forwarded day sounds like a machine gun.
- **Speech must stay clear:** the duck applies to every channel but voices.
- **Don't send sound state from the server.** If something new needs a sound, the client needs the fact (an event, a flag), not a "play this" message.

## Tests

`packages/shared/tests/sound.test.ts` (the function), `packages/client/tests/audio.test.ts` (inputs from a fake store; the engine with a fake `AudioContext` that records `setTarget` calls).

The done-when ones:
- The start town's square at 05:30, 12:00 and 23:00: birds_dawn, then crowd_murmur/market by day (rising with crowd size), then insects/owls at night.
- A storm day: `rain_roof` high in the village, plus storm spots.
- Woods (forest chunk or the woods area): birds by day, owls by night; with a wolf pack's ground near, birds drop.
- A curfew night (a fake `curfew: true` until N58): murmur 0, the watch's spot only.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| standing in Millbrook's square from dawn to night the sound changes with the hour and the crowd | step 1 test + play |
| rain is heard on the roofs in a storm | step 1 test + play |
| the woods have birdsong by day and owls by night and go quiet when wolves are near | step 1 test (predatorsNear) + play |
| a curfew night is silent but for the watch | step 1 test with the curfew flag; real once N58 sets it |

## Questions for the user

1. Samples: OK to add ~3 MB of CC0 sound files to the repo (birds, bells, hammer, animals, music), or synthesis only?
2. Music: a quiet ambient music channel at all, or only diegetic music (festivals, the inn's bard)? Default: diegetic only.

**Save:** nothing (client only, prefs in localStorage).

## Slice cut

Not in the slice.

## Out of scope

Sound for combat hits and UI clicks (could follow, same engine). Spoken barks from the crowd (voices are for talkers only). Positional sound inside interiors beyond one room bed.
