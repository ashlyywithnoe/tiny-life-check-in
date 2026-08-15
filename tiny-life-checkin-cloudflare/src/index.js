import { CHECK_INS } from "./checkins.js";

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
    hour: Number(pieces.hour),
    minute: Number(pieces.minute),
  };
}

function scheduledPromptIndex(parts) {
  const localDayNumber = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
  const slot = parts.hour === 20 ? 1 : 0;
  const sequence = localDayNumber * 2 + slot;
  // 37 is coprime with 99, so the original 99-prompt bank cycles through
  // every prompt before repeating on scheduled sends.
  return ((sequence * 37 + 11) % CHECK_INS.length + CHECK_INS.length) % CHECK_INS.length;
}

function randomPrompt() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return CHECK_INS[values[0] % CHECK_INS.length];
}

function emojiNames(env) {
  return (env.EMOJI_NAMES || "")
    .split(",")
    .map((name) => name.trim().replace(/^:+|:+$/g, ""))
    .filter(Boolean);
}

async function resolveCustomEmoji(env) {
  const names = emojiNames(env);
  if (!names.length || !env.GUILD_ID || !env.DISCORD_TOKEN) return "";

  try {
    const response = await fetch(`${DISCORD_API}/guilds/${env.GUILD_ID}/emojis`, {
      headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
    });
    if (!response.ok) {
      console.warn("Could not list guild emojis", response.status, await response.text());
      return "";
    }

    const emojis = await response.json();
    const candidates = names
      .map((name) => emojis.find((emoji) => emoji.name === name))
      .filter(Boolean);
    if (!candidates.length) return "";

    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const emoji = candidates[values[0] % candidates.length];
    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  } catch (error) {
    console.error("Could not resolve custom emoji", error);
    return "";
  }
}

async function formatCheckin(prompt, env, { includePing = false } = {}) {
  const emoji = await resolveCustomEmoji(env);
  const ping = includePing && env.PING_USER_ID ? `<@${env.PING_USER_ID}>\n` : "";
  const emojiLine = emoji ? `\n${emoji}` : "";
  const siteUrl = env.SITE_URL || DEFAULT_SITE_URL;
  return `${ping}**Tiny Life Check-In**\n${prompt}${emojiLine}\n\n-# add yours: ${siteUrl}`;
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
      "Tiny Life Check-Ins are scheduled for **12:00 PM** and **8:00 PM Eastern** every day.",
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
      return new Response("Tiny Life Check-In is alive. Scheduled for 12 PM + 8 PM Eastern.");
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    const parts = easternParts(controller.scheduledTime);
    if (parts.minute !== 0 || ![12, 20].includes(parts.hour)) return;

    const prompt = CHECK_INS[scheduledPromptIndex(parts)];
    ctx.waitUntil((async () => {
      const content = await formatCheckin(prompt, env, { includePing: true });
      await sendChannelMessage(content, env);
      console.log(`Sent Tiny Life Check-In for ${parts.hour}:00 ${EASTERN}`);
    })());
  },
};
