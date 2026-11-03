// Free messages to parents from the «رسائل واتساب» screen (welcome, Facebook page, urgent notices ...), through SendWhats.
//
// { action: "send", batch_id, kind, title, text, student_ids, per: "family" | "student", school }
//   The page sends the wording and the chosen students only; names and phone numbers are read here from the students table.
//   per "family": one message per phone number, naming all its chosen children. batch_id comes from the page and is kept
//   across retries of the same send, so pressing again never repeats a message.
// { action: "refresh", batch_ids }  asks SendWhats where each message stands and updates the archive (wa_messages).
//
// Secrets: SENDWHATS_API_URL, SENDWHATS_API_KEY. Needs supabase/whatsapp_messages.sql.
import { cairoToday, cors, dmy, fill, json, open, refresh, sendBatch, type Out } from "../_shared/wa.ts";

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
  const groups = new Map<string, St[]>();
  const noPhone: Out[] = [];
  for (const s of students.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"))) {
    const ph = (s.whatsapp || s.phone || "").trim();
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
    return { externalId: k, phone: (kids[0].whatsapp || kids[0].phone)!.trim(), text: t, studentIds: kids.map((s) => s.id), names: kids.map((s) => s.full_name).join("، ") };
  });
  noPhone.forEach((m) => (m.text = fill(text, { "الاسم": m.names, "التاريخ": day, "الأكاديمية": school })));
  if (!msgs.length) {
    const r = await sendBatch(ctx, batchId, kind, title, [], noPhone);
    return json({ ...r, queued: 0 });
  }
  const r = await sendBatch(ctx, batchId, kind, title, msgs, noPhone);
  return json(r, "error" in r ? 502 : 200);
});
