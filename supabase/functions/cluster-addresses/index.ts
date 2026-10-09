// Groups students' home addresses into transport assembly points using Claude.
//
// Called from the transport page by the superadmin. The page sends only a row number and the
// address text for each student (no names, IDs or phone numbers); the Anthropic API key stays
// here on the server as the ANTHROPIC_API_KEY secret and never reaches the browser.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You help a school organise student transport. Parents typed each student's home address as free text, mostly in Arabic: a district or neighbourhood, sometimes a street, a landmark or a compound, with inconsistent spelling.

Group the addresses into assembly points: places where students who live near each other can gather to be picked up together.

- Every place name that appears in the addresses (a neighbourhood, a compound, a landmark, a sub-district) is an assembly point, and every address that mentions that place belongs to it, however it is spelled. For example "حي السفارات" is an assembly point and every address containing "السفارات" joins it; "جاردينيا سيتي", "جاردينياسيتي" and "جاردينيا ستي" are one place.
- Create the group even when only one address mentions the place. Give each address the most specific place it names (the neighbourhood or compound, not the whole city). When an address names only the city or a very wide district, group it under that name.
- Use what you know of the local geography to recognise different names of the same place, and to keep apart places that only sound alike.
- Name each group as the parents wrote the place, in Arabic. Never invent a place that does not appear in the addresses.
- "area" is the wider district or city the group belongs to, so that neighbouring groups can be merged by a person later.
- If an existing assembly point already covers an address, reuse that assembly point's name exactly.
- "unclear" is only for an address that names no place at all. Do not use it for addresses that are merely short.

Every address number must appear exactly once, either in one group's "members" or in "unclear".`;

const SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          area: { type: "string" },
          members: { type: "array", items: { type: "integer" } },
        },
        required: ["name", "area", "members"],
        additionalProperties: false,
      },
    },
    unclear: { type: "array", items: { type: "integer" } },
  },
  required: ["clusters", "unclear"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Only the superadmin may run this (same rule as the student records themselves).
  const authorization = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: role, error: roleError } = await supabase.rpc("my_role");
  if (roleError || role !== "superadmin") return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set for this function" }, 500);

  let body: { addresses?: { n: number; a: string }[]; existing?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const addresses = (body.addresses ?? []).filter((x) => Number.isInteger(x?.n) && typeof x?.a === "string");
  if (!addresses.length) return json({ error: "no addresses" }, 400);
  if (addresses.length > 1500) return json({ error: "too many addresses in one request (limit 1500)" }, 400);

  const existing = (body.existing ?? []).filter((x) => typeof x === "string" && x.trim());
  const prompt =
    (existing.length ? `Existing assembly points:\n${existing.map((x) => `- ${x}`).join("\n")}\n\n` : "") +
    `Addresses (number: text):\n${addresses.map((x) => `${x.n}: ${x.a.replace(/\s+/g, " ").trim()}`).join("\n")}`;

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If a safety classifier declines the request, the API re-runs it on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") return json({ error: "the model declined this request" }, 502);
    if (response.stop_reason === "max_tokens") return json({ error: "the answer was cut off; send fewer addresses" }, 502);

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return json({ error: "empty answer from the model" }, 502);
    return json(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "the Anthropic API key was rejected" }, 502);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "rate limited by the Anthropic API; try again shortly" }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `Anthropic API error ${err.status}: ${err.message}` }, 502);
    return json({ error: String(err) }, 500);
  }
});
