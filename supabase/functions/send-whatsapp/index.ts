// Free messages to parents from the «رسائل واتساب» screen (welcome, Facebook page, urgent notices ...), through SendWhats.
//
// { action: "send", batch_id, kind, title, text, student_ids, per: "family" | "student", school }
//   The page sends the wording and the chosen students only; names and phone numbers are read here from the students table.
//   per "family": one message per phone number, naming all its chosen children. batch_id comes from the page and is kept
//   across retries of the same send, so pressing again never repeats a message.
// { action: "refresh", batch_ids }  asks SendWhats where each message stands and updates the archive (wa_messages).
//
// Secrets: SENDWHATS_API_URL, SENDWHATS_API_KEY. Needs supabase/whatsapp_messages.sql.
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

type St = { id: string; full_name: string; guardian_name: string | null; class_name: string | null; whatsapp: string | null; phone: string | null };

const digits = (p: string) => {
  const t = p.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, "");
  return /^0\d{10}$/.test(t) ? "2" + t : /^00/.test(t) ? t.slice(2) : t;
};
const join = (a: string[]) => [...new Set(a.filter(Boolean))].join(" و");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const ctx = await open(req);
  if (ctx instanceof Response) return ctx;
  const body = await req.json().catch(() => ({}));

  if (body?.action === "refresh") {
    const ids = Array.isArray(body.batch_ids) ? body.batch_ids.filter((x: unknown) => typeof x === "string") : [];
    return json(await refresh(ctx, ids));
  }
  if (body?.action !== "send") return json({ error: "unknown action" }, 400);

  const batchId = String(body.batch_id ?? "").trim(), text = String(body.text ?? "").trim();
  const kind = String(body.kind ?? "custom").slice(0, 40), title = String(body.title ?? "").slice(0, 120);
  const ids: string[] = Array.isArray(body.student_ids) ? body.student_ids.filter((x: unknown) => typeof x === "string") : [];
  if (!/^[\w-]{6,100}$/.test(batchId) || !text || text.length > 3500 || !ids.length || ids.length > 3000) return json({ error: "bad request" }, 400);

  const students: St[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await ctx.user.from("students").select("id, full_name, guardian_name, class_name, whatsapp, phone").in("id", ids.slice(i, i + 300));
    if (error) return json({ error: error.message }, 502);
    students.push(...(data as St[]));
  }
  const day = dmy(cairoToday()), school = String(body.school ?? "").slice(0, 120);
  // الرقم: واتساب ولي الأمر ثم جواله؛ وعند إعادة الإرسال (use: "phone") جوال ولي الأمر أولًا
  const pick = (s: St) => (body.use === "phone" ? (s.phone || s.whatsapp || "") : (s.whatsapp || s.phone || "")).trim();
  const groups = new Map<string, St[]>();
  const noPhone: Out[] = [];
  for (const s of students.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"))) {
    const ph = pick(s);
    if (!ph) { noPhone.push({ externalId: s.id, phone: "", text: "", studentIds: [s.id], names: s.full_name }); continue; }
    const k = body.per === "student" ? s.id : "tel" + digits(ph);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const msgs: Out[] = [...groups.entries()].map(([k, kids]) => {
    const t = fill(text, {
      "الاسم": join(kids.map((s) => s.full_name)),
      "الاسم_الأول": join(kids.map((s) => s.full_name.split(/\s+/)[0])),
      "ولي_الأمر": kids.map((s) => s.guardian_name).find(Boolean) ?? "ولي الأمر",
      "الشعبة": join(kids.map((s) => s.class_name ?? "")),
      "التاريخ": day,
      "الأكاديمية": school,
    });
    return { externalId: k, phone: pick(kids[0]), text: t, studentIds: kids.map((s) => s.id), names: kids.map((s) => s.full_name).join("، ") };
  });
  noPhone.forEach((m) => (m.text = fill(text, { "الاسم": m.names, "التاريخ": day, "الأكاديمية": school })));
  if (!msgs.length) {
    const r = await sendBatch(ctx, batchId, kind, title, [], noPhone);
    return json({ ...r, queued: 0 });
  }
  const r = await sendBatch(ctx, batchId, kind, title, msgs, noPhone);
  return json(r, "error" in r ? 502 : 200);
});
