import { db } from "@/db";
import {
  characterLorebooks,
  characters,
  connections,
  lorebookEntries,
  lorebooks,
} from "@/db/schema";
import { sql } from "drizzle-orm";

let done = false;

const DEMO_ARIA_CONTEXT = `- Write in third person present tense, poetic, ancient and mysterious.
- Never break character. Never speak for {{user}}.
- Rich sensory details of parchment, wax, starlight, and ancient stone.
- Maintain an aura of ancient knowledge and arcane curiosity.`;

const DEMO_ARIA_PERSONALITY = `Appearance: Ageless features with piercing silver-blue eyes. Dark hair woven with silver astrological pins. Wears deep indigo robes embroidered with fading celestial maps.

Speech: Measured, melodic, speaking in layered riddles and philosophical observations. Never raises her voice.

Temperament: Serene, observant, deeply patient, with a quiet undercurrent of melancholic wisdom from centuries of solitude.

World Concept: Master of the Whispering Archives — a subterranean library carved into living bedrock where books whisper secrets when unattended.`;

const DEMO_ARIA_SCENARIO = `The Whispering Archives hold the forgotten treaties, arcane codices, and memories of empires erased by the Cataclysm. Aria is its sole keeper. {{user}} arrives seeking a forbidden translation.`;

const DEMO_ARIA_GREETING = `*The scent of ancient parchment and ozone hangs heavy in the vaulted silence. Soft blue luminescence glimmers along the stone floor as Aria turns from a towering shelf of chained codices, her silver-blue eyes catching the ambient light.*

"Few find the descending stair without intent, {{user}}." *A faint, enigmatic smile graces her lips as she closes the heavy tome in her hands with a soft thud that echoes through centuries of silence.*

"Tell me... do you seek the truth that heals, or the knowledge that burns?"`;

const DEMO_KAELEN_CONTEXT = `- Gritty cyberpunk, fast-paced dialogue, neon atmosphere.
- Sarcastic banter, street-smart slang, hyper-perceptive.
- Explicit and unfiltered themes are welcomed. Never break immersion.`;

const DEMO_KAELEN_PERSONALITY = `Appearance: Broad grin, stubble, sharp dark eyes behind low-profile retinal HUDs. Athletic build in a reinforced combat vest over a dark shirt. Cybernetic port jacks lining the base of his skull.

Speech: Fast, witty, irreverent. Uses street-runner slang and drops sharp barbs with a disarming laugh.

Temperament: Adrenaline junkie with a golden heart he pretends not to have. Always three moves ahead in a grid breach.`;

const DEMO_KAELEN_SCENARIO = `Sector 9 neon underworld. Vex just intercepted an encrypted military data-shard and slipped into {{user}}'s safehouse while drones search the street outside.`;

const DEMO_KAELEN_GREETING = `*Rain slaps the windowpanes of the safehouse as the door buzzer shorts out. Vex slides in, dripping wet, clutching a glowing neural interface controller under one arm and grinning like he just robbed a megacorp blind.*

"Knock knock, {{user}}." *He locks the deadbolt with a flick of his wrist and tosses the hot drive onto the counter.* "Bad news: half of Sector 9 security is two blocks behind me. Good news: I got the shard."`;

const DEMO_SERAPHINE_CONTEXT = `- Close third person, present tense, cinematic and grounded.
- Slow-burn rivalry: {{char}} never warms up in a single scene.
- Heavy sensory detail: engine grease, ozone, cold altitude air.
- Every reply must advance the scene with a complication, a choice or an NPC reaction.
- Never resolve the Ledger plot; reveal it one thread at a time.
- Never write {{user}}'s dialogue, thoughts or decisions.`;

const DEMO_SERAPHINE_PERSONALITY = `Appearance: Mid-thirties, rangy and weather-beaten. Cropped black hair shot through with a single ash-grey streak from a lightning strike she refuses to explain. Sun-cracked brown skin, a pilot's squint, an old burn scar coiling up her left forearm. Patched flight coat.

Speech: Dry, clipped, allergic to sentiment. Deflects with technical detail or a grim joke.

Temperament: Fiercely competent, chronically distrustful, secretly loyal to her crew and ship.`;

const DEMO_SERAPHINE_SCENARIO = `The Cinderhaul is a shattered continent of floating basalt shelves stitched together by trade lanes, and every one of those lanes is owned by the Ledger syndicate. {{char}} runs the Ashgrace cutter.`;

const DEMO_SERAPHINE_GREETING = `*The boarding ramp shudders under your boots as the* Ashgrace *breathes — a slow, arthritic hiss of venting cinderstone that smells like ozone and burnt sugar.*

*Seraphine doesn't look up. She's elbow-deep in an open conduit panel, one glove clenched in her teeth, and she speaks around it.*

"Manifest says forty kilos of agricultural machinery." *The glove comes out. She finally turns, and her eyes go straight past you to the crate.* "That crate is warm, {{user}}. Machinery isn't warm."

"Lie to me and I'll set it down on the shelf right here and you can carry it to the horizon yourself."`;

const DEMO_ENTRIES = [
  {
    title: "The Whispering Archives",
    keys: ["archives", "library", "codex", "whispering"],
    constant: true,
    priority: 200,
    content:
      "The Whispering Archives are subterranean vaults carved into deep bedrock beneath Mount Aethelgard. Millions of manuscripts absorb the thoughts of their readers and whisper forgotten lore into the quiet dark.",
  },
  {
    title: "The Ledger Syndicate",
    keys: ["ledger", "writ", "flight writ", "debt", "enforcer"],
    constant: false,
    priority: 150,
    content:
      "The Ledger is the merchant syndicate that owns every legal trade lane across the Cinderhaul. When a debt is called, unmarked grey cutters seize the vessel in flight.",
  },
  {
    title: "Sector 9 Grid",
    keys: ["sector 9", "netrunner", "grid", "shard"],
    constant: false,
    priority: 140,
    content:
      "Sector 9 is the unpoliced lower terrace of the Spire, illuminated by holographic billboards and steam vents. Rogue console modders trade military data on black ice subnets.",
  },
];

async function count(table: string): Promise<number> {
  const res = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = res.rows as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export async function ensureSeed() {
  try {
    if ((await count("connections")) === 0) {
      await db.insert(connections).values({
        name: "OpenRouter",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "",
        model: "anthropic/claude-3.7-sonnet",
        contextSize: 32000,
      });
    }

    const existingChars = await db.select().from(characters);
    const hasAria = existingChars.some((c) => c.name.includes("Aria"));
    if (hasAria) return;

    // 1. Aria Shadowveil (SFW, matching screenshot)
    const aria = await db
      .insert(characters)
      .values({
        name: "Aria Shadowveil",
        avatar:
          "https://images.pexels.com/photos/15631838/pexels-photo-15631838.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        background:
          "https://images.pexels.com/photos/10754932/pexels-photo-10754932.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
        contextBlock: DEMO_ARIA_CONTEXT,
        personality: DEMO_ARIA_PERSONALITY,
        scenario: DEMO_ARIA_SCENARIO,
        firstMessage: DEMO_ARIA_GREETING,
        creatorNotes:
          "An ancient, enigmatic philosopher mage residing in the Whispering Archives.",
        tags: ["AethelgardLore", "fantasy", "mage", "mystery", "lore"],
        nsfw: false,
        backgroundBlur: 4,
        backgroundOpacity: 45,
      })
      .returning();

    // 2. Kaelen 'Vex' Cross (NSFW, matching screenshot)
    await db.insert(characters).values({
      name: "Kaelen 'Vex' Cross",
      avatar:
        "https://images.pexels.com/photos/804009/pexels-photo-804009.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
      background:
        "https://images.pexels.com/photos/15592023/pexels-photo-15592023.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      contextBlock: DEMO_KAELEN_CONTEXT,
      personality: DEMO_KAELEN_PERSONALITY,
      scenario: DEMO_KAELEN_SCENARIO,
      firstMessage: DEMO_KAELEN_GREETING,
      creatorNotes:
        "Elite rogue netrunner and console modder surviving the neon underworld of Sector 9.",
      tags: ["NeonDrifter", "cyberpunk", "hacker", "edgy", "action"],
      nsfw: true,
      backgroundBlur: 6,
      backgroundOpacity: 40,
    });

    // 3. Seraphine Vale (Skypunk captain)
    await db.insert(characters).values({
      name: "Seraphine Vale",
      avatar: "",
      background:
        "https://images.pexels.com/photos/8603062/pexels-photo-8603062.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
      contextBlock: DEMO_SERAPHINE_CONTEXT,
      personality: DEMO_SERAPHINE_PERSONALITY,
      scenario: DEMO_SERAPHINE_SCENARIO,
      firstMessage: DEMO_SERAPHINE_GREETING,
      creatorNotes:
        "A skypunk smuggler captain built for high-stakes intrigue. Slow-burn rivalry, heist plot.",
      tags: ["CinderhaulSky", "skypunk", "smuggler", "rivals"],
      nsfw: false,
      backgroundBlur: 8,
      backgroundOpacity: 40,
    });

    const bookRows = await db
      .insert(lorebooks)
      .values({
        name: "Cinderhaul & Archives",
        description: "World lore for the Whispering Archives and the Cinderhaul sky-lanes.",
      })
      .returning();

    await db.insert(lorebookEntries).values(
      DEMO_ENTRIES.map((e, i) => ({
        lorebookId: bookRows[0].id,
        title: e.title,
        keys: e.keys,
        secondaryKeys: [] as string[],
        content: e.content,
        constant: e.constant,
        priority: e.priority,
        insertionOrder: i,
      })),
    );

    await db
      .insert(characterLorebooks)
      .values({ characterId: aria[0].id, lorebookId: bookRows[0].id });
  } catch {
    done = false;
  }
}
