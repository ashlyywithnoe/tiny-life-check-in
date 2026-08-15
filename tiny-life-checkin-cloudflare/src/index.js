import { CHECK_INS } from "./checkins.js";
import { HAPPY_JOKES, DAY_QUESTS, AS_ALWAYS } from "./happytimezone.js";

const DISCORD_API = "https://discord.com/api/v10";
const EASTERN = "America/New_York";
const DEFAULT_SITE_URL = "https://win-of-the-day.pages.dev/";

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(request, body, publicKeyHex) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !publicKeyHex) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      hexToBytes(signature),
      data,
    );
  } catch (error) {
    console.error("Discord signature verification failed", error);
    return false;
  }
}

function easternParts(timestamp) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const pieces = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(pieces.year),
    month: Number(pieces.month),
    day: Number(pieces.day),
    weekday: pieces.weekday,
    hour: Number(pieces.hour),
    minute: Number(pieces.minute),
  };
}

function localDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function scheduledPromptIndex(parts) {
  const slot = parts.hour === 20 ? 1 : 0;
  const sequence = localDayNumber(parts) * 2 + slot;
  return ((sequence * 37 + 11) % CHECK_INS.length + CHECK_INS.length) % CHECK_INS.length;
}

function randomPrompt() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return CHECK_INS[values[0] % CHECK_INS.length];
}

function deterministicIndex(seed, length, salt = 0) {
  if (!length) return 0;
  return Math.abs((seed * 1103515245 + 12345 + salt * 2654435761) >>> 0) % length;
}

function emojiNames(env) {
  return (env.EMOJI_NAMES || "")
    .split(",")
    .map((name) => name.trim().replace(/^:+|:+$/g, ""))
    .filter(Boolean);
}

async function getGuildEmojis(env) {
  if (!env.GUILD_ID || !env.DISCORD_TOKEN) return [];
  try {
    const response = await fetch(`${DISCORD_API}/guilds/${env.GUILD_ID}/emojis`, {
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
    });
    if (!response.ok) {
      console.warn("Could not list guild emojis", response.status, await response.text());
      return [];
    }
    return await response.json();
  } catch (error) {
    console.error("Could not resolve custom emojis", error);
    return [];
  }
}

function emojiMarkup(emoji) {
  return emoji ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : "";
}

async function resolveCustomEmoji(env) {
  const names = emojiNames(env);
  if (!names.length) return "";
  const emojis = await getGuildEmojis(env);
  const candidates = names.map((name) => emojis.find((emoji) => emoji.name === name)).filter(Boolean);
  if (!candidates.length) return "";
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return emojiMarkup(candidates[values[0] % candidates.length]);
}

async function resolveHappyEmojis(env) {
  const emojis = await getGuildEmojis(env);
  const heart = emojis.find((emoji) => emoji.name === "509898cutepixelheart");
  const preferredJokeNames = ["kibrytroll", ...emojiNames(env)];
  const jokeCandidates = preferredJokeNames
    .map((name) => emojis.find((emoji) => emoji.name === name))
    .filter(Boolean);
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return {
    heart: emojiMarkup(heart) || "♡",
    joke: jokeCandidates.length ? emojiMarkup(jokeCandidates[values[0] % jokeCandidates.length]) : "",
  };
}

async function formatCheckin(prompt, env, { includePing = false } = {}) {
  const emoji = await resolveCustomEmoji(env);
  const ping = includePing && env.PING_USER_ID ? `<@${env.PING_USER_ID}>\n` : "";
  const emojiLine = emoji ? `\n${emoji}` : "";
  const siteUrl = env.SITE_URL || DEFAULT_SITE_URL;
  return `${ping}**Tiny Life Check-In**\n${prompt}${emojiLine}\n\n-# add yours: ${siteUrl}`;
}

async function formatHappyTimezone(parts, env, { includePing = false } = {}) {
  const daySeed = localDayNumber(parts);
  const joke = HAPPY_JOKES[deterministicIndex(daySeed, HAPPY_JOKES.length, 17)];
  const variants = DAY_QUESTS[parts.weekday] || DAY_QUESTS.Monday;
  const quests = variants[deterministicIndex(daySeed, variants.length, 43)];
  const emoji = await resolveHappyEmojis(env);
  const ping = includePing && env.PING_USER_ID ? `<@${env.PING_USER_ID}>\n` : "";
  const jokeEmoji = emoji.joke ? ` ${emoji.joke}` : "";
  const questLines = quests.map((quest) => `> ${quest}`).join("\n");

  return `${ping}# ꒰ঌ ${emoji.heart} Happy Timezone! ${emoji.heart} ໒꒱\n` +
    `|| ${joke[0]}\n${joke[1]}${jokeEmoji} ||\n` +
    `-# i’ll see myself out\n\n` +
    `### Tis ${parts.weekday}!\n` +
    `**Today’s quest is simple:**\n${questLines}\n\n` +
    `♡ **As always** ♡\n` +
    AS_ALWAYS.map((line) => `> ${line}`).join("\n");
}

async function sendChannelMessage(content, env) {
  if (!env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is missing.");
  if (!env.TARGET_CHANNEL_ID) throw new Error("TARGET_CHANNEL_ID is missing.");

  const response = await fetch(`${DISCORD_API}/channels/${env.TARGET_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: env.PING_USER_ID ? [env.PING_USER_ID] : [] },
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord send failed (${response.status}): ${await response.text()}`);
  }
}

function interactionResponse(content, ephemeral = false) {
  return new Response(JSON.stringify({
    type: 4,
    data: {
      content,
      ...(ephemeral ? { flags: 64 } : {}),
      allowed_mentions: { parse: [] },
    },
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleDiscordInteraction(request, env) {
  const body = await request.text();
  const verified = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
  if (!verified) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body);
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (interaction.type !== 2) {
    return interactionResponse("Tiny Life only handles slash commands here.", true);
  }

  const command = interaction.data?.name;
  if (command === "tiny") {
    const content = await formatCheckin(randomPrompt(), env);
    return interactionResponse(content);
  }

  if (command === "tinystatus") {
    return interactionResponse(
      "Happy Timezone posts at **7:00 AM Eastern**. Tiny Life Check-Ins post at **12:00 PM** and **8:00 PM Eastern** every day.",
      true,
    );
  }

  return interactionResponse("Unknown Tiny Life command.", true);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/discord")) {
      return handleDiscordInteraction(request, env);
    }

    if (request.method === "GET") {
      return new Response("Happy Timezone: 7 AM ET. Tiny Life Check-In: 12 PM + 8 PM ET.");
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    const parts = easternParts(controller.scheduledTime);
    if (parts.minute !== 0) return;

    if (parts.hour === 7) {
      ctx.waitUntil((async () => {
        const content = await formatHappyTimezone(parts, env, { includePing: true });
        await sendChannelMessage(content, env);
        console.log(`Sent Happy Timezone for ${parts.weekday} at 7:00 ${EASTERN}`);
      })());
      return;
    }

    if ([12, 20].includes(parts.hour)) {
      const prompt = CHECK_INS[scheduledPromptIndex(parts)];
      ctx.waitUntil((async () => {
        const content = await formatCheckin(prompt, env, { includePing: true });
        await sendChannelMessage(content, env);
        console.log(`Sent Tiny Life Check-In for ${parts.hour}:00 ${EASTERN}`);
      })());
    }
  },
};
