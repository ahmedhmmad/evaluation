// Sends today's absence notices to parents on WhatsApp through SendWhats. Called from «الحضور والغياب» by the
// people who record attendance, after they have reviewed the day's list: nothing here runs on its own.
//
// The batch id is the day and the message id is the student, so pressing the button again never repeats a notice:
// SendWhats only queues the students it has not seen today. Excused students are not notified.
//
// The API key stays here, never in the page, because every visitor can read the page's source.
// Secrets: SENDWHATS_API_URL (e.g. https://api.example.com), SENDWHATS_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_PER_REQUEST = 500;   // the most SendWhats accepts in one request

const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const notice = (name: string, day: string) =>
  `السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بغياب الطالب/ـة ${name} عن المدرسة اليوم ${dmy(day)}.\nإدارة المدرسة`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SENDWHATS_API_URL");
  const key = Deno.env.get("SENDWHATS_API_KEY");
  if (!url || !key) return json({ error: "SENDWHATS_API_URL and SENDWHATS_API_KEY are not set for this function" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: role, error: roleError } = await supabase.rpc("my_role");
  if (roleError || (role !== "superadmin" && role !== "registrar")) return json({ error: "forbidden" }, 403);
  const { data: readOnly } = await supabase.rpc("my_read_only");
  if (readOnly === true) return json({ error: "forbidden" }, 403);

  // Always today: a late notice about an old day would read as a new absence.
  const day = cairoToday();
  // body { student_id } sends to that one student only (the per-row button); an empty body sends to everyone absent today
  const body = await req.json().catch(() => ({}));
  const only = typeof body?.student_id === "string" && body.student_id ? body.student_id : null;
  let q = supabase
    .from("attendance")
    .select("student_id, students(full_name, whatsapp, phone)")
    .eq("day", day)
    .eq("status", "absent");
  if (only) q = q.eq("student_id", only);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 502);

  const messages: { externalId: string; phone: string; text: string }[] = [];
  const noPhone: string[] = [];
  for (const row of rows ?? []) {
    const s = row.students as unknown as { full_name: string; whatsapp: string; phone: string } | null;
    const phone = (s?.whatsapp || s?.phone || "").trim();
    if (phone) messages.push({ externalId: row.student_id, phone, text: notice(s!.full_name, day) });
    else noPhone.push(s?.full_name ?? row.student_id);
  }
  if (!messages.length) return json({ day, queued: 0, alreadySent: 0, rejected: 0, noPhone });

  let queued = 0, alreadySent = 0, rejected = 0;
  for (let i = 0; i < messages.length; i += MAX_PER_REQUEST) {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/v1/external/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ batchId: `absence-${day}`, messages: messages.slice(i, i + MAX_PER_REQUEST) }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) return json({ error: out?.error?.message ?? `SendWhats answered ${res.status}`, queued }, 502);
    queued += out.queued;
    alreadySent += out.alreadyKnown;
    rejected += out.rejected.length;
  }
  return json({ day, queued, alreadySent, rejected, noPhone });
});
