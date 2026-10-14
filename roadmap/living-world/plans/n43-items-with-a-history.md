[← Plans](README.md) · [Stage 3: N43](../stage-3-npcs-choose.md#n43-items-with-a-history)

# N43 plan: Items with a history

**In one line:** most items stay fungible stacks (`"iron sword [D]": 2`), but a **notable** item gets its own id and a row in a `notable_items` table with its maker, owners, deeds, losses and finds; an item becomes notable when it's made well, named, stolen, used in a notable event or passed down; people who knew it or heard of it recognise it; its fame grows with its deeds and it can earn a name and a legend.

**Read first:** [plans README](README.md) sections 2, 9, 15, 19 (`item-name`, `item-legend`). Needs N20 step 1 (deeds are event refs, step 0 if missing), N33 (knowledge refs: hearing of an item is a knowledge row `i:<itemId>`). Uses N42 (loot from jobs), N45 (heirlooms), N48 (stolen goods as evidence), N51 (enchantments), N54 (hoards), N68 (songs that name items).

## What exists

- **Items are keys with counts:** `inventory: Record<string, number>` on the player and NPC states ([`npc/types.ts`](../../../packages/server/src/npc/types.ts)); keys like `"iron sword [D] (30/50)"` parsed by `parseItem` ([`items.ts`](../../../packages/server/src/game/items.ts)) into name, tier and durability; `ITEMS` defines the kinds.
- **Stolen goods:** `player.stolen: Array<{ item, from }>`; `recognisableLoot`, `recognisesStolen` ([`stealth.ts`](../../../packages/server/src/game/stealth.ts)): an owner or friend recognises it.
- **Makers:** smiths craft ([`crafting.ts`](../../../packages/server/src/game/crafting.ts)), masterwork rolls ([`signature.ts`](../../../packages/server/src/game/signature.ts) `applyMasterwork`), commissions ([`commissions.ts`](../../../packages/server/src/game/commissions.ts)).
- **Gear** ([`gear.ts`](../../../packages/server/src/game/gear.ts)): equipped weapon/armour with durability; loot from creatures ([`loot.ts`](../../../packages/server/src/game/loot.ts)); figures don't carry items (their wealth is coin).

## Decisions made in this plan

1. **A notable item is a stack of one with an id in its key.** Key form `"iron sword [D] (30/50) #i123"`; `parseItem` learns the `#id` suffix. Everything that handles keys (inventories, trade, equip, loot) keeps working; code that needs the history looks up `notable_items` by id. Ordinary items never get an id.
2. **The table** `notable_items(id, base, tier, name, named_by, maker, made_day, made_site, holder, holder_since, fame, history JSON, lost JSON)`. `history` is a short list of entries `{ day, kind: "made" | "given" | "sold" | "stolen" | "looted" | "found" | "lost" | "used" | "inherited" | "named", who, ref?, site? }`, capped (keep the first, the last 12 and every entry with a deed event). `holder` is a person ref, a place (`site:<id>`: a hoard, a grave, a ruin) or null (lost).
3. **What makes an item notable** (`becomeNotable(itemKey, why)`): a masterwork (signature roll), tier B or above, a commission for a named person, being named, being stolen (the moment it's stolen: so it can be recognised later), being used in a notable event (a killing of a named person or a beast with renown, a duel, a coronation, a tournament win: N41), an heirloom (N45 marks family weapons when a parent dies), anything from a dungeon hoard or a dragon's hoard (N54), any enchanted item (N51).
4. **Figures and townsfolk carry notable items** (not their whole kit): a figure's `items: string[]` (notable ids only), a row's notable items via `holder`. So a knight's sword exists as a row and can be taken from his body, inherited, or stolen.
5. **Deeds raise fame.** `fame` 0..100: + by the renown of the deed's other party (a dragon slain: a lot; a bandit: a little), decays very slowly. Above a threshold the item gets a **name**: from templates ("Greyfang's Bane" = the slain's name + a kind word; "the Knight of Ashby's Sword") or the model (`item-name`, through the invented-name check). Named items above a higher fame get a short **legend** (N68 later sings it; `item-legend` now as two sentences from the facts, template fallback).
6. **Recognition is knowledge.** People who held, saw it used, or were told of it have a knowledge row `i:<id>` (N33): the holder's household and friends, witnesses of its deeds, and anyone the news of a famous item reached. When the player (or anyone) shows, wears or sells a notable item where someone knows it: `recognise(item, viewer)` with a chance by the viewer's knowledge accuracy and the item's fame. Recognition triggers by case: stolen → the owner or their friends know it (today's `recognisesStolen`, generalised to any notable item stolen from anyone, and to guards who know the theft from gossip); heirloom → the family wants it back (an N38 action `reclaim`: ask, offer coin, sue (N48), steal back); a dead hero's sword → grief and a claim by the heir.
7. **Loss and finding:** an item left on a body in the wild, on a battlefield, in a ruin, dropped in a river: `holder = site:<poi>` or null with `lost` (where and how). N27's POIs can hold lost notable items so the player can find them years later, with the history intact.
8. **Two views:** the player sees the history **as far as they know it** (what they were told, what they saw, what an appraiser or the previous owner said); the admin sees all of it.

## Data shapes

```ts
interface NotableItem { id: string; base: string; tier: ItemTier; name?: string; maker?: string; made: { day: number; site?: string }; holder: string | null; holderSince: number; fame: number; history: ItemHistoryEntry[]; lost?: { day: number; where: string | null; how: string } }
// Figure gains items?: string[] (notable ids); knowledge refs "i:<id>"
```

## Steps

### Step 1: ids in keys and the table
- `parseItem` with `#id`; `game/items/notable.ts` (create, move, add history, lookup); migration; every inventory move of a key with an id calls `move` (give, sell, loot, steal, drop, equip unaffected).
- Test: a notable sword keeps its id through trade, loot and equip; its history lists each move.

### Step 2: becoming notable
- Hooks: masterwork, high tier, commissions, theft (becomes notable at the moment of theft, with the owner), notable deeds (a kill of a renowned target with an equipped notable-or-not weapon makes it notable), hoards.
- Test: stealing a knight's family sword makes it notable with the knight's family as earlier holders.

### Step 3: figures and townsfolk carry them
- Figure `items`; rows as holders; death drops items on the body (to the killer if they loot, or to the heir: N45, or to the place).
- Test: a knight figure killed by bandits: the bandit chief now holds the sword (history: looted).

### Step 4: fame, names and legends
- Fame from deeds; naming threshold; `item-name` and `item-legend` kinds with fallbacks.
- Test: an item that kills a renowned beast gets a name.

### Step 5: recognition
- Knowledge rows `i:<id>` (holders' households, witnesses, news of famous items); `recognise`; the cases (stolen, heirloom, hero's sword); the `reclaim` action (N38).
- Test (done-when part): the player takes a named sword from a bandit; a guard recognises it as one stolen from a knight's family; the family wants it back (a reclaim action or a talker's request to the player).

### Step 6: the views
- Journal: the player's known history of each notable item they've held or seen; admin: full history and every hand it passed through.
- Test (done-when part): the admin view shows every hand it passed through.

### Step 7: songs; docs
- Hook for N68: a song about a knight's last fight names the sword (N68's song facts include notable items in the deed events). Until N68: the item's legend line is told by bards' template lines in inns.
- README.

## Balance bounds

- `notables-bounded`: notable items per thousand people under a cap; most fame stays low.
- `named-rare`: named items are rare.

## Edge cases and traps

- **Stacks of one:** code that sums inventories by name (e.g. "has 2 iron swords") must count `#id` keys as their base; fix `parseItem` users that compare names exactly.
- **Selling notable items to traders:** traders' stock (N10) must keep the id (a trader holding a famous sword is a holder; a buyer later gets the history).
- **Old `player.stolen`:** move it to the notable table at load (a migration) and delete the field.
- **Don't make every bandit's dagger notable:** only the thresholds above.

## Tests (`packages/server/tests/n43.test.ts`)

The done-when ones:
- The player takes a named sword from a bandit, a guard recognises it as one stolen from a knight's family, and the family wants it back.
- A bard's song about the knight's last fight names the sword (template line until N68).
- The admin view shows every hand it passed through.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| the player takes a named sword from a bandit | steps 2–4 setup |
| a guard recognises it as one stolen from a knight's family, and the family wants it back | step 5 test |
| a bard's song about the knight's last fight names the sword | step 7 (template; real with N68) |
| the admin view shows every hand it passed through | step 6 test |

**Save:** the next schema version (`notable_items`); the next save version (figures' `items`, `player.stolen` moved).

## Slice cut

Not in the slice.

## Out of scope

Crafting famous items on purpose (commissions already exist). Enchanting (N51). Items in dragons' hoards (N54). Inheritance law (N45).
