// Reads a photographed or scanned staff attendance sheet (the paper where staff write or sign their arrival
// and departure times) with a vision model on DeepInfra, and returns one row per staff member it found,
// matched to the staff list the page sends. The page fills the day's attendance screen with the result as
// unsaved changes, so the person checks and corrects them against the paper before saving.
//
// Called from «دوام الموظفين» by the superadmin or the manager (the same people who record staff attendance),
// or by the WhatsApp bot in n8n with the bot key (see supabase/staff_bot.sql and n8n/absence-bot.json).
// Nothing is stored here: the image goes to the model and the answer comes back.
//
// Secrets: DEEPINFRA_API_KEY (required, the same key as read-registration-form), DEEPINFRA_MODEL (optional default).
import { createClient } from "npm:@supabase/supabase-js@2";

const ENDPOINT = "https://api.deepinfra.com/v1/openai/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.1-pro";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const STATUSES = ["present", "absent", "leave", "mission"];

type Staff = { key: string; name: string; title?: string };

const SYSTEM = `You transcribe a school's paper staff attendance sheet for one day. It is a printed or hand-drawn Arabic table: one line per staff member with their name and the time they arrived and the time they left, written by hand, sometimes with a signature or a remark (غائب، إجازة، مأمورية، مهمة رسمية...). It was photographed or scanned. A person checks your transcription against the paper afterwards, so the goal is to save typing while never hiding doubt.

You also get the list of staff members of the school, each with a key. For every line of the sheet:
- "key": the key of the staff member on that line, matching the written name to the list (the sheet may write a shorter or differently spelled name). If no member of the list matches with confidence, use "".
- "name": the name exactly as written on the sheet.
- "in" and "out": the arrival and departure times as 24-hour "HH:MM". Times on the sheet are often written in 12-hour form without AM/PM; the working day runs between 06:00 and 18:00, so "1:30" as a departure is "13:30" and "7:45" as an arrival is "07:45". Empty or unreadable: "".
- "status": "present" if a time or signature shows they came; "absent", "leave" (إجازة) or "mission" (مأمورية / مهمة رسمية) when the line says so; "" when the line is empty.
- "note": any other remark written on the line, in Arabic, else "".
- "unsure": the fields among "key", "in", "out", "status" that you could not read with confidence (a digit that could be another digit, a smudged cell, a name that could be two people). Be generous: a field you list costs the checker a glance, a wrong value you did not list ends up in someone's record.

Copy what is written; do not invent times for empty cells and do not fill in the official time. Return digits as Western digits.
Also return "date": the date written on the sheet as "YYYY-MM-DD", or "" if there is none or it is unreadable.
If the image is not an attendance sheet, return an empty "rows" list.

Answer with one JSON object and nothing else, in this shape:
{"date": "", "rows": [{"key": "", "name": "", "in": "", "out": "", "status": "", "note": "", "unsure": []}]}`;

const hhmm = (v: unknown) => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { file?: { media_type?: string; data?: string }; staff?: Staff[]; model?: string; bot_key?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // Two callers: the website (a signed-in superadmin or manager, who gets the rows back), or the WhatsApp bot in n8n
  // (with the bot key and the sender's number; the sender must be allowed and waiting to send a sheet). For the bot the
  // reading is saved to the staff_sheet_inbox for review on the website, and the WhatsApp reply text comes back.
  const authorization = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const bot = typeof body.bot_key === "string" && body.bot_key.length >= 32;
  let role = "";
  let botStaff: { id: string; name: string; title?: string }[] = [];
  if (bot) {
    const { data: ok, error } = await supabase.rpc("staff_bot_image", { p_key: body.bot_key, p_phone: String(body.phone ?? "") });
    if (error) return json({ error: `staff_bot_image: ${error.message}` }, 502);
    if (ok?.error) return json({ error: ok.error }, 403);
    if (!ok?.ok) return json({ ignored: true });   // not an allowed sender waiting for a sheet: the bot stays silent
    botStaff = Array.isArray(ok.staff) ? ok.staff : [];
    body.staff = botStaff.map((s, i) => ({ key: `s${i + 1}`, name: s.name, title: s.title }));
    body.model = undefined;
  } else {
    const { data, error: roleError } = await supabase.rpc("my_role");
    role = data ?? "";
    if (roleError || (role !== "superadmin" && role !== "manager")) return json({ error: "forbidden" }, 403);
  }

  const apiKey = Deno.env.get("DEEPINFRA_API_KEY");
  if (!apiKey) return json({ error: "DEEPINFRA_API_KEY is not set for this function" }, 500);

  const mediaType = body.file?.media_type ?? "";
  const data = body.file?.data ?? "";
  if (!data || !IMAGE_TYPES.includes(mediaType)) return json({ error: "send one image (JPEG, PNG or WebP)" }, 400);
  const staff = (body.staff ?? []).filter((s) => typeof s?.key === "string" && /^s\d{1,4}$/.test(s.key) && typeof s?.name === "string");
  if (!staff.length || staff.length > 400) return json({ error: "the staff list is missing" }, 400);
  const keys = new Set(staff.map((s) => s.key));
  const list = staff.map((s) => `- ${s.key}: ${s.name}${s.title ? ` (${s.title})` : ""}`).join("\n");

  const asked = typeof body.model === "string" ? body.model.trim() : "";
  const model = role === "superadmin" && /^[A-Za-z0-9][A-Za-z0-9._\/-]{2,99}$/.test(asked)
    ? asked
    : Deno.env.get("DEEPINFRA_MODEL") || DEFAULT_MODEL;

  const request = {
    model,
    max_tokens: 16000,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: `Staff members of the school (key: name):\n${list}` },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } },
        ],
      },
    ],
  };
  const call = (extra: Record<string, unknown>) =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...request, ...extra }),
    });

  let response: Response;
  try {
    response = await call({ temperature: 0, response_format: { type: "json_object" } });
    if (response.status === 400 || response.status === 422) response = await call({});
  } catch (err) {
    return json({ error: `could not reach DeepInfra: ${String(err)}` }, 502);
  }
  if (response.status === 401 || response.status === 403) return json({ error: "the DeepInfra API key was rejected" }, 502);
  if (response.status === 429) return json({ error: "rate limited by DeepInfra; try again shortly" }, 429);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return json({ error: `DeepInfra error ${response.status} (${model}): ${detail}` }, 502);
  }

  let answer: { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  try {
    answer = await response.json();
  } catch {
    return json({ error: "unreadable answer from DeepInfra" }, 502);
  }
  const choice = answer.choices?.[0];
  if (choice?.finish_reason === "length") return json({ error: "the answer was cut off; photograph one page per image" }, 502);
  const text = choice?.message?.content ?? "";
  let parsed: { date?: unknown; rows?: unknown } | null = null;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return json({ error: "the model did not return valid JSON" }, 502);
  }

  // Only known keys, valid times and statuses pass; anything else is emptied and marked unsure for the checker.
  const rows = (Array.isArray(parsed?.rows) ? parsed!.rows : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const unsure = new Set(Array.isArray(r.unsure) ? r.unsure.filter((k): k is string => typeof k === "string") : []);
      let key = String(r.key ?? "").trim();
      if (key && !keys.has(key)) { key = ""; unsure.add("key"); }
      const fix = (k: "in" | "out") => {
        const raw = String(r[k] ?? "").trim();
        let v = hhmm(raw);
        if (raw && !v) unsure.add(k);
        // The working day runs 06:00-18:00: a time before 06:00 is a 12-hour afternoon time ("1:30" → 13:30); flagged for the checker
        if (v && Number(v.slice(0, 2)) < 6) {
          v = `${String(Number(v.slice(0, 2)) + 12).padStart(2, "0")}${v.slice(2)}`;
          unsure.add(k);
        }
        return v;
      };
      let status = String(r.status ?? "").trim();
      if (status && !STATUSES.includes(status)) { status = ""; unsure.add("status"); }
      return {
        key, name: String(r.name ?? "").trim().slice(0, 120), in: fix("in"), out: fix("out"), status,
        note: String(r.note ?? "").trim().slice(0, 200),
        unsure: [...unsure].filter((k) => ["key", "in", "out", "status"].includes(k)),
      };
    })
    .filter((r) => r.name || r.key);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.date ?? "")) ? String(parsed!.date) : "";

  if (bot) {
    // The inbox keeps the staff member's id instead of the short key
    const stored = rows.map(({ key, ...r }) => ({ ...r, teacher_id: key ? botStaff[Number(key.slice(1)) - 1]?.id ?? "" : "" }));
    const { data: saved, error } = await supabase.rpc("staff_bot_store", {
      p_key: body.bot_key, p_phone: String(body.phone ?? ""), p_rows: stored, p_date: date || null, p_model: model,
    });
    if (error) return json({ error: `staff_bot_store: ${error.message}` }, 502);
    if (saved?.error) return json({ error: saved.error }, 403);
    return json({ reply: saved?.reply ?? "" });
  }
  return json({ date, rows, model });
});
