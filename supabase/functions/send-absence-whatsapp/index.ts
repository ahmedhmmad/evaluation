// Sends absence notices to parents on WhatsApp through SendWhats. Called from «الحضور والغياب» by the
// people who record attendance, after they have reviewed the list: nothing here runs on its own.
//
// The wording comes from the templates «absence» and «repeat» (wa_templates, edited from the «رسائل واتساب» screen),
// and every notice is kept in the archive (wa_messages). Without whatsapp_messages.sql the built-in wording is used.
//
// The batch id is the day (or the period) and the message id is the student, so pressing the button again never repeats
// a notice: SendWhats only queues the students it has not seen. Excused students are not notified.
// Secrets: SENDWHATS_API_URL, SENDWHATS_API_KEY.
import { cairoToday, cors, dmy, fill, json, open, sendBatch, template, type Out } from "../_shared/wa.ts";

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
      const ph = (r.s?.whatsapp || r.s?.phone || "").trim();
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
