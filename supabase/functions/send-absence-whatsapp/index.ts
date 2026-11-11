// Sends absence notices to parents on WhatsApp through SendWhats. Called from «الحضور والغياب» by the
// people who record attendance, after they have reviewed the list: nothing here runs on its own.
//
// The wording comes from the templates «absence» and «repeat» (wa_templates, edited from the «رسائل واتساب» screen),
// and every notice is kept in the archive (wa_messages). Without whatsapp_messages.sql the built-in wording is used.
//
// The batch id is the day (or the period) and the message id is the student, so pressing the button again never repeats
// a notice: SendWhats only queues the students it has not seen. Excused students are not notified.
// Secrets: SENDWHATS_API_URL, SENDWHATS_API_KEY.
// ---- shared with the other WhatsApp function (kept in each file so it can be pasted into the dashboard editor) ----
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_PER_REQUEST = 500;   // the most SendWhats accepts in one request

export const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** {الاسم} and friends; an unknown name is left as written so a typo shows in the archive instead of vanishing. */
export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{([^{}\s]+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));

export type Ctx = { user: SupabaseClient; admin: SupabaseClient | null; who: string; url: string; key: string };

/** Checks the caller (superadmin or registrar, not read-only) and SendWhats settings. Returns a Response on refusal. */
export async function open(req: Request): Promise<Ctx | Response> {
  const url = Deno.env.get("SENDWHATS_API_URL");
  const key = Deno.env.get("SENDWHATS_API_KEY");
  if (!url || !key) return json({ error: "SENDWHATS_API_URL and SENDWHATS_API_KEY are not set for this function" }, 500);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: role, error } = await user.rpc("my_role");
  if (error || (role !== "superadmin" && role !== "registrar")) return json({ error: "forbidden" }, 403);
  const { data: readOnly } = await user.rpc("my_read_only");
  if (readOnly === true) return json({ error: "forbidden" }, 403);
  const { data: u } = await user.auth.getUser();
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = sr ? createClient(Deno.env.get("SUPABASE_URL")!, sr) : null;
  return { user, admin, who: u?.user?.email ?? "", url: url.replace(/\/+$/, ""), key };
}

/** The saved wording of a template, or the fallback when the table or the row is missing. */
export async function template(ctx: Ctx, key: string, fallback: string) {
  const { data } = await ctx.user.from("wa_templates").select("body").eq("key", key).maybeSingle();
  return (data?.body as string | undefined)?.trim() || fallback;
}

export type Out = { externalId: string; phone: string; text: string; studentIds: string[]; names: string };

/**
 * Queues the messages in one SendWhats batch and archives them (also the ones without a phone).
 * Safe to repeat: SendWhats only queues what it has not seen in this batch, and the archive keeps one row per message.
 */
export async function sendBatch(ctx: Ctx, batchId: string, kind: string, title: string, msgs: Out[], noPhone: Out[]) {
  let queued = 0, alreadySent = 0;
  const rejected = new Map<string, string>();
  for (let i = 0; i < msgs.length; i += MAX_PER_REQUEST) {
    const res = await fetch(`${ctx.url}/api/v1/external/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": ctx.key },
      body: JSON.stringify({ batchId, messages: msgs.slice(i, i + MAX_PER_REQUEST).map(({ externalId, phone, text }) => ({ externalId, phone, text })) }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) {
      // every number in this part invalid: SendWhats refuses the request; archive them as rejected and go on
      if (res.status === 400 && /valid phone/i.test(out?.error?.message ?? "")) {
        msgs.slice(i, i + MAX_PER_REQUEST).forEach((m) => rejected.set(m.externalId, "رقم غير صالح"));
        continue;
      }
      await archive(ctx, batchId, kind, title, msgs.slice(0, i), noPhone, rejected);
      return { error: out?.error?.message ?? `SendWhats answered ${res.status}`, queued };
    }
    queued += out.queued;
    alreadySent += out.alreadyKnown;
    for (const r of out.rejected ?? []) rejected.set(r.externalId, r.reason);
  }
  await archive(ctx, batchId, kind, title, msgs, noPhone, rejected);
  return { batchId, queued, alreadySent, rejected: rejected.size, noPhone: noPhone.map((m) => m.names) };
}

async function archive(ctx: Ctx, batchId: string, kind: string, title: string, msgs: Out[], noPhone: Out[], rejected: Map<string, string>) {
  if (!ctx.admin) return;
  const row = (m: Out, status: string, error: string | null) => ({
    batch_id: batchId, external_id: m.externalId, kind, title, student_ids: m.studentIds, names: m.names,
    phone: m.phone, body: m.text, status, error, created_by: ctx.who,
  });
  const rows = msgs.map((m) => rejected.has(m.externalId) ? row(m, "rejected", rejected.get(m.externalId)!) : row(m, "queued", null))
    .concat(noPhone.map((m) => row(m, "nophone", "لا رقم واتساب ولا جوال")));
  // ignoreDuplicates: a repeated press keeps the first row and its status
  for (let i = 0; i < rows.length; i += 500) {
    await ctx.admin.from("wa_messages").upsert(rows.slice(i, i + 500), { onConflict: "batch_id,external_id", ignoreDuplicates: true });
  }
}

/** Asks SendWhats where each message of the batches stands and writes it to the archive. */
export async function refresh(ctx: Ctx, batchIds: string[]) {
  if (!ctx.admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is missing" };
  let updated = 0;
  const failed: string[] = [];
  for (const b of batchIds.slice(0, 60)) {
    const res = await fetch(`${ctx.url}/api/v1/external/batches/${encodeURIComponent(b)}`, { headers: { "X-Api-Key": ctx.key } });
    if (!res.ok) { failed.push(`${b}: ${res.status}`); continue; }
    const out = await res.json().catch(() => null);
    for (const m of out?.messages ?? []) {
      const { error } = await ctx.admin.from("wa_messages")
        .update({ status: m.status, sent_at: m.sentAt, delivered_at: m.deliveredAt, error: m.error ?? null })
        .eq("batch_id", b).eq("external_id", m.externalId).not("status", "in", "(rejected,nophone)");
      if (!error) updated++;
      else failed.push(`${b}/${m.externalId}: ${error.message}`);
    }
  }
  return { updated, failed };
}
// ---- end of shared part ----

const ABSENCE = "السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بغياب الطالب/ـة {الاسم} عن المدرسة اليوم {التاريخ}.\nإدارة المدرسة";
const REPEAT = "السلام عليكم ورحمة الله وبركاته،\nنحيطكم علمًا بتكرر غياب الطالب/ـة {الاسم}، إذ غاب {العدد} أيام خلال الفترة من {من} إلى {إلى}.\nنأمل متابعة انتظامه/ـا في الدوام والتواصل مع إدارة المدرسة عند وجود ظرف.\nإدارة المدرسة";

type St = { full_name: string; whatsapp: string; phone: string; class_name: string | null; guardian_name: string | null };
const SEL = "student_id, students(full_name, whatsapp, phone, class_name, guardian_name)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const ctx = await open(req);
  if (ctx instanceof Response) return ctx;
  const body = await req.json().catch(() => ({}));
  const only = typeof body?.student_id === "string" && body.student_id ? body.student_id : null;
  const vars = (s: St) => ({ "الاسم": s.full_name, "الاسم_الأول": s.full_name.split(/\s+/)[0], "الشعبة": s.class_name ?? "", "ولي_الأمر": s.guardian_name || "ولي الأمر", "الأكاديمية": String(body?.school ?? "").slice(0, 120) });
  const split = (rows: { student_id: string; s: St | null; text: string }[]) => {
    const msgs: Out[] = [], noPhone: Out[] = [];
    for (const r of rows) {
      const ph = (r.s?.phone || "").trim(); // جوال ولي الأمر فقط (الواتساب للطالب)
      const m = { externalId: r.student_id, phone: ph, text: r.text, studentIds: [r.student_id], names: r.s?.full_name ?? r.student_id };
      (ph ? msgs : noPhone).push(m);
    }
    return { msgs, noPhone };
  };

  // Repeated-absence notices: { repeat: { from, to, min }, student_id? }. The counts are taken here from the attendance table,
  // never from the page, and each student gets one notice per period (batch id = the period).
  const rep = body?.repeat;
  if (rep) {
    const from = String(rep.from ?? ""), to = String(rep.to ?? ""), min = Number(rep.min);
    const okDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!okDay(from) || !okDay(to) || from > to || !(min >= 2) || (Date.parse(to) - Date.parse(from)) / 864e5 > 40) return json({ error: "bad period" }, 400);
    let rq = ctx.user.from("attendance").select(SEL).eq("status", "absent").gte("day", from).lte("day", to);
    if (only) rq = rq.eq("student_id", only);
    const { data: ar, error: re } = await rq;
    if (re) return json({ error: re.message }, 502);
    const cnt = new Map<string, { n: number; s: St | null }>();
    for (const r of ar ?? []) {
      const e = cnt.get(r.student_id) ?? { n: 0, s: r.students as unknown as St | null };
      e.n++; cnt.set(r.student_id, e);
    }
    const tpl = await template(ctx, "repeat", REPEAT);
    const rows = [...cnt].filter(([, e]) => e.n >= min && e.s).map(([id, e]) => ({
      student_id: id, s: e.s, text: fill(tpl, { ...vars(e.s!), "العدد": e.n, "من": dmy(from), "إلى": dmy(to), "التاريخ": dmy(cairoToday()) }),
    }));
    const { msgs, noPhone } = split(rows);
    const r = await sendBatch(ctx, `repeat-${from}-${to}`, "repeat", `تكرار الغياب ${dmy(from)} – ${dmy(to)}`, msgs, noPhone);
    return json({ from, to, ...r }, "error" in r ? 502 : 200);
  }

  // Always today: a late notice about an old day would read as a new absence.
  const day = cairoToday();
  let q = ctx.user.from("attendance").select(SEL).eq("day", day).eq("status", "absent");
  if (only) q = q.eq("student_id", only);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 502);
  const tpl = await template(ctx, "absence", ABSENCE);
  const { msgs, noPhone } = split((rows ?? []).map((r) => {
    const s = r.students as unknown as St | null;
    return { student_id: r.student_id, s, text: s ? fill(tpl, { ...vars(s), "التاريخ": dmy(day) }) : "" };
  }));
  if (!msgs.length) return json({ day, queued: 0, alreadySent: 0, rejected: 0, noPhone: noPhone.map((m) => m.names) });
  const r = await sendBatch(ctx, `absence-${day}`, "absence", `غياب ${dmy(day)}`, msgs, noPhone);
  return json({ day, ...r }, "error" in r ? 502 : 200);
});
