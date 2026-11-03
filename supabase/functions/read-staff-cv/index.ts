// Reads one staff member's documents (CVs, degree certificates, experience letters ... in any layout and language)
// with a vision model on DeepInfra and returns one unified qualifications card. The page sends the pages as images
// (PDF pages are drawn in the browser) and Word files as text; it shows the card for review before saving it.
// Nothing is stored here.
//
// Called from «بيانات العاملين» by the superadmin or the manager.
// Secrets: DEEPINFRA_API_KEY (the same key as read-registration-form), DEEPINFRA_MODEL (optional).
import { createClient } from "npm:@supabase/supabase-js@2";

const ENDPOINT = "https://api.deepinfra.com/v1/openai/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.1-pro";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You read the documents a school keeps for one of its staff members: CVs, university degree certificates, transcripts, experience letters, training certificates, ID cards. They come in any layout, in Arabic or English, typed, scanned or photographed, sometimes several documents in one file. You get each page as an image, and Word files as text, each labelled with its file name and page number.

Build one qualifications card for this person, in Arabic (keep names of universities and places as written, translated to Arabic when the document is in English, with the original in brackets if useful). A person reviews the card against the documents, so never invent: leave a field empty when the documents do not say it, and list doubtful fields in "unsure".

Answer with one JSON object and nothing else, in this shape:
{
 "full_name": "",                 // as on the documents
 "degree": "",                    // highest degree: دكتوراه / ماجستير / دبلوم عالٍ / بكالوريوس / دبلوم متوسط / ثانوية عامة / أخرى
 "major": "",                     // its specialisation
 "university": "",
 "grad_year": "",                 // four digits
 "grade": "",                     // التقدير or GPA, as written
 "other_degrees": [{"degree": "", "major": "", "university": "", "year": ""}],
 "experience_years": "",          // total years of work experience, a number, computed from the dates when not stated
 "experience": [{"place": "", "role": "", "from": "", "to": ""}],   // newest first; years or "YYYY-MM"
 "courses": [""],                 // training courses and certificates, short
 "languages": [""],
 "skills": [""],                  // short, at most 8
 "birth_date": "",                // YYYY-MM-DD or YYYY
 "phone": "",
 "email": "",
 "address": "",
 "summary": "",                   // two or three Arabic sentences on who this teacher is professionally
 "has": {"cv": false, "degree_certificate": false, "transcript": false, "experience_letter": false, "id": false},
 "pages": [{"file": "", "page": 1, "what": ""}],                    // what each page is, in Arabic, e.g. "سيرة ذاتية", "شهادة بكالوريوس"
 "unsure": [""]                   // names of the fields above you are not sure about
}
Use Western digits. If a page belongs to another person, say so in its "what" and do not use it.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: role, error: roleError } = await supabase.rpc("my_role");
  if (roleError || (role !== "superadmin" && role !== "manager")) return json({ error: "forbidden" }, 403);
  const { data: readOnly } = await supabase.rpc("my_read_only");
  if (readOnly === true) return json({ error: "forbidden" }, 403);
  const apiKey = Deno.env.get("DEEPINFRA_API_KEY");
  if (!apiKey) return json({ error: "DEEPINFRA_API_KEY is not set for this function" }, 500);

  type Part = { file: string; page?: number; media_type?: string; data?: string; text?: string };
  let body: { name?: string; parts?: Part[] };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const parts = (body.parts ?? []).filter((p) => p && typeof p.file === "string" && ((p.data && IMAGE_TYPES.includes(p.media_type ?? "")) || typeof p.text === "string"));
  if (!parts.length || parts.length > 40) return json({ error: "send 1 to 40 pages" }, 400);

  const content: unknown[] = [{ type: "text", text: `The staff member's name in the school's records: ${String(body.name ?? "").slice(0, 120)}` }];
  for (const p of parts) {
    const label = `File «${p.file.slice(0, 150)}»${p.page ? `, page ${p.page}` : ""}:`;
    if (p.text != null) content.push({ type: "text", text: `${label}\n${p.text.slice(0, 30000)}` });
    else content.push({ type: "text", text: label }, { type: "image_url", image_url: { url: `data:${p.media_type};base64,${p.data}` } });
  }
  const model = Deno.env.get("DEEPINFRA_MODEL") || DEFAULT_MODEL;
  const request = { model, max_tokens: 12000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] };
  const call = (extra: Record<string, unknown>) => fetch(ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ ...request, ...extra }),
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
  if (!response.ok) return json({ error: `DeepInfra error ${response.status} (${model}): ${(await response.text()).slice(0, 300)}` }, 502);

  const answer = await response.json().catch(() => null);
  const choice = answer?.choices?.[0];
  if (choice?.finish_reason === "length") return json({ error: "the answer was cut off" }, 502);
  const text: string = choice?.message?.content ?? "";
  try {
    const card = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return json({ card, model });
  } catch {
    return json({ error: "the model did not return valid JSON" }, 502);
  }
});
