// Shared by send-whatsapp and send-absence-whatsapp: SendWhats calls, templates from wa_templates, and the wa_messages archive.
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
  for (const b of batchIds.slice(0, 30)) {
    const res = await fetch(`${ctx.url}/api/v1/external/batches/${encodeURIComponent(b)}`, { headers: { "X-Api-Key": ctx.key } });
    if (!res.ok) continue;
    const out = await res.json().catch(() => null);
    for (const m of out?.messages ?? []) {
      const { error } = await ctx.admin.from("wa_messages")
        .update({ status: m.status, sent_at: m.sentAt, delivered_at: m.deliveredAt, error: m.error ?? null })
        .eq("batch_id", b).eq("external_id", m.externalId).not("status", "in", "(rejected,nophone)");
      if (!error) updated++;
    }
  }
  return { updated };
}
