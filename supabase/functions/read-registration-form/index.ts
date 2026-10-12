// Reads a scanned or photographed registration form that a guardian filled in by hand, using a vision
// model hosted on DeepInfra, and returns its fields so the registrar only has to check them instead of
// typing everything.
//
// Called from the student registration page by the superadmin or a registrar. The page sends one image
// (one page of a form) and the list of fields on the form. The DeepInfra API key stays here on the server
// as the DEEPINFRA_API_KEY secret and never reaches the browser.
// Nothing is stored by this function: the image is passed to the model and the answer is returned.
//
// Secrets: DEEPINFRA_API_KEY (required), DEEPINFRA_MODEL (optional; any DeepInfra model that accepts images).
import { createClient } from "npm:@supabase/supabase-js@2";

const ENDPOINT = "https://api.deepinfra.com/v1/openai/chat/completions";
const DEFAULT_MODEL = "mistralai/Mistral-Small-3.2-24B-Instruct-2506";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Field = { k: string; label: string; type?: string; options?: string[] };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SYSTEM = `You transcribe paper registration forms of a school. Each form is a printed Arabic table that a guardian filled in by hand, then it was scanned or photographed. Your transcription is checked by a person against the paper afterwards, so the goal is to save them typing while never hiding doubt.

Return the value written next to each printed label of the form in the image.

- Copy what is written. Do not correct, complete, translate or guess a value from other fields. Names stay exactly as written, in Arabic.
- A field that is empty on the paper is an empty string. A dash or "لا يوجد" written by the guardian is kept as "لا يوجد".
- Numbers (ID numbers, phone numbers, counts, amounts) are returned in Western digits 0-9 without spaces, whatever digits the guardian used. Keep every digit you can read; never pad or drop digits to reach an expected length.
- Dates are returned as YYYY-MM-DD. The guardian writes day/month/year. If part of the date is unreadable, return an empty string.
- A field with printed choices (tick boxes) returns exactly one of the listed choices: the ticked, circled or underlined one. If none or several are marked, return an empty string.
- A field whose choices are not printed as boxes (the guardian wrote the answer) but that lists allowed choices here: return the listed choice that matches what was written, or an empty string if none matches.
- "unsure" lists the keys of the fields whose handwriting you could not read with confidence: a digit that could be another digit, a name with an ambiguous letter, a smudged or cut-off cell, a tick between two boxes. Still give your best reading for such a field. Be generous with this list: a field you list costs the checker a glance, a wrong value you did not list can end up in a child's record.
- If the image is not this form, or the form has no handwriting at all, return an empty "forms" list.

Answer with one JSON object and nothing else, in this shape:
{"forms": [{"<key>": "<value>", ..., "unsure": ["<key>", ...]}]}
Every key from the field list appears in the form object, each with a string value.`;

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

  const apiKey = Deno.env.get("DEEPINFRA_API_KEY");
  if (!apiKey) return json({ error: "DEEPINFRA_API_KEY is not set for this function" }, 500);

  let body: { file?: { media_type?: string; data?: string }; fields?: Field[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const mediaType = body.file?.media_type ?? "";
  const data = body.file?.data ?? "";
  if (!data || !IMAGE_TYPES.includes(mediaType)) return json({ error: "send one image (JPEG, PNG or WebP)" }, 400);
  const fields = (body.fields ?? []).filter(
    (f) => typeof f?.k === "string" && /^[a-z_]{1,40}$/.test(f.k) && typeof f?.label === "string",
  );
  if (!fields.length || fields.length > 80) return json({ error: "the list of form fields is missing" }, 400);

  const fieldList = fields
    .map((f) => {
      const options = (f.options ?? []).filter(Boolean);
      const kind = f.type === "date" ? " (date)" : f.type === "number" ? " (number)" : "";
      return `- ${f.k}: «${f.label}»${kind}${options.length ? ` — choices: ${options.join(" | ")}` : ""}`;
    })
    .join("\n");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get("DEEPINFRA_MODEL") || DEFAULT_MODEL,
        max_tokens: 4092,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `The fields of the form (key: printed label):\n${fieldList}` },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return json({ error: `could not reach DeepInfra: ${String(err)}` }, 502);
  }

  if (response.status === 401 || response.status === 403) return json({ error: "the DeepInfra API key was rejected" }, 502);
  if (response.status === 429) return json({ error: "rate limited by DeepInfra; try again shortly" }, 429);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return json({ error: `DeepInfra error ${response.status}: ${detail}` }, 502);
  }

  let answer: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  try {
    answer = await response.json();
  } catch {
    return json({ error: "unreadable answer from DeepInfra" }, 502);
  }
  const choice = answer.choices?.[0];
  if (choice?.finish_reason === "length") return json({ error: "the answer was cut off; photograph one form per image" }, 502);
  const text = choice?.message?.content ?? "";

  // The model is asked for JSON only; take the outermost object in case it wrapped it in anything.
  let parsed: { forms?: unknown } | null = null;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return json({ error: "the model did not return valid JSON" }, 502);
  }
  const rawForms = Array.isArray(parsed?.forms) ? parsed!.forms : [];

  // Keep only the known fields, as strings. A value outside a field's choices is dropped and the field
  // is marked unsure, so the checker looks at it rather than trusting a made-up choice.
  const forms = rawForms
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => {
      const out: Record<string, unknown> = {};
      const unsure = new Set(Array.isArray(f.unsure) ? f.unsure.filter((k): k is string => typeof k === "string") : []);
      for (const field of fields) {
        let value = f[field.k] == null ? "" : String(f[field.k]).trim();
        const options = (field.options ?? []).filter(Boolean);
        if (value && options.length && !options.includes(value)) {
          value = "";
          unsure.add(field.k);
        }
        out[field.k] = value;
      }
      out.unsure = [...unsure].filter((k) => fields.some((field) => field.k === k));
      return out;
    });

  return json({ forms });
});
