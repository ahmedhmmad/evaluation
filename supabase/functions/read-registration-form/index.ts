// Reads a scanned or photographed registration form that a guardian filled in by hand, using Claude,
// and returns its fields so the registrar only has to check them instead of typing everything.
//
// Called from the student registration page by the superadmin or a registrar. The page sends one file
// (an image, or a PDF that may hold several forms) and the list of fields on the form. The Anthropic API
// key stays here on the server as the ANTHROPIC_API_KEY secret and never reaches the browser.
// Nothing is stored by this function: the file is passed to the model and the answer is returned.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Field = { k: string; label: string; type?: string; options?: string[] };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const SYSTEM = `You transcribe paper registration forms of a school. Each form is a printed Arabic table that a guardian filled in by hand, then it was scanned or photographed. Your transcription is checked by a person against the paper afterwards, so the goal is to save them typing while never hiding doubt.

For every filled form in the file, return one entry with the value written next to each printed label.

- Copy what is written. Do not correct, complete, translate or guess a value from other fields. Names stay exactly as written, in Arabic.
- A field that is empty on the paper is an empty string. A dash or "لا يوجد" written by the guardian is kept as "لا يوجد".
- Numbers (ID numbers, phone numbers, counts, amounts) are returned in Western digits 0-9 without spaces, whatever digits the guardian used. Keep every digit you can read; never pad or drop digits to reach an expected length.
- Dates are returned as YYYY-MM-DD. The guardian writes day/month/year. If part of the date is unreadable, return an empty string.
- A field with printed choices (tick boxes) returns exactly one of the listed choices: the ticked, circled or underlined one. If none or several are marked, return an empty string.
- A field whose choices are not printed as boxes (the guardian wrote the answer) but that lists allowed choices here: return the listed choice that matches what was written, or an empty string if none matches.
- "unsure" lists the keys of the fields in that form whose handwriting you could not read with confidence: a digit that could be another digit, a name with an ambiguous letter, a smudged or cut-off cell, a tick between two boxes. Still give your best reading for such a field. Be generous with this list: a field you list costs the checker a glance, a wrong value you did not list can end up in a child's record.
- A page that is not this form, or a form with no handwriting at all, produces no entry.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // The same people who may edit student records: the superadmin and registrars.
  const authorization = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: role, error: roleError } = await supabase.rpc("my_role");
  if (roleError || (role !== "superadmin" && role !== "registrar")) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set for this function" }, 500);

  let body: { file?: { media_type?: string; data?: string }; fields?: Field[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const mediaType = body.file?.media_type ?? "";
  const data = body.file?.data ?? "";
  const isPdf = mediaType === "application/pdf";
  if (!data || (!isPdf && !IMAGE_TYPES.includes(mediaType as ImageType))) {
    return json({ error: "send one image (JPEG, PNG, WebP) or one PDF" }, 400);
  }
  const fields = (body.fields ?? []).filter(
    (f) => typeof f?.k === "string" && /^[a-z_]{1,40}$/.test(f.k) && typeof f?.label === "string",
  );
  if (!fields.length || fields.length > 80) return json({ error: "the list of form fields is missing" }, 400);

  // One object per form: every field is a string (one of its choices, or empty, for fields with choices),
  // plus the keys the model was not sure about.
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    const options = (f.options ?? []).filter((o) => typeof o === "string" && o);
    properties[f.k] = options.length ? { type: "string", enum: [...options, ""] } : { type: "string" };
  }
  properties.unsure = { type: "array", items: { type: "string", enum: fields.map((f) => f.k) } };
  const schema = {
    type: "object",
    properties: {
      forms: {
        type: "array",
        items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
      },
    },
    required: ["forms"],
    additionalProperties: false,
  };

  const fieldList = fields
    .map((f) => {
      const options = (f.options ?? []).filter(Boolean);
      const kind = f.type === "date" ? " (date)" : f.type === "number" ? " (number)" : "";
      return `- ${f.k}: «${f.label}»${kind}${options.length ? ` — choices: ${options.join(" | ")}` : ""}`;
    })
    .join("\n");

  const source = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as ImageType, data } };

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If a safety classifier declines the request, the API re-runs it on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Handwriting is the hard part of this job, so the model is given room to look carefully.
      output_config: { effort: "high", format: { type: "json_schema", schema } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            source,
            { type: "text", text: `The fields of the form (key: printed label):\n${fieldList}` },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return json({ error: "the model declined this request" }, 502);
    if (response.stop_reason === "max_tokens") {
      return json({ error: "the answer was cut off; send fewer pages in one file" }, 502);
    }

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
