// Staff documents (CVs, degrees, ...) kept in Cloudflare R2; the staff_files table holds one small row per file.
// The page never sees the R2 keys: it asks here for short-lived signed links and uploads or opens the file with them.
//
// { action: "upload", staff_id, name, size, mime, kind, note }  -> { id, url }   (PUT the file to url, then it is listed)
// { action: "open", id, download? }                             -> { url }       (valid 5 minutes)
// { action: "delete", id }                                      -> { ok }
//
// Who may do what is decided by the staff_files row-level security (superadmin and manager), through the caller's own token.
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. Needs supabase/staff_files.sql.
import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_SIZE = 50 * 1024 * 1024;
const KINDS = ["cv", "cv_all", "degree", "experience", "course", "id", "contract", "other"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const account = Deno.env.get("R2_ACCOUNT_ID"), bucket = Deno.env.get("R2_BUCKET");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID"), secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  if (!account || !bucket || !accessKeyId || !secretAccessKey) return json({ error: "R2 secrets are not set for this function" }, 500);
  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const objUrl = (key: string) => `https://${account}.r2.cloudflarestorage.com/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const presign = async (method: string, key: string, extra: Record<string, string> = {}) => {
    const u = new URL(objUrl(key));
    u.searchParams.set("X-Amz-Expires", "300");
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return (await r2.sign(new Request(u, { method }), { aws: { signQuery: true } })).url;
  };

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await db.auth.getUser();
  if (!u?.user) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));

  // Files of a ready-made worksheet or exam (papers.mode = 'scan'): the owner uploads and deletes, and whoever may read
  // the paper (its owner, colleagues when it is shared, the management) opens them. papers' row-level security decides.
  if (typeof body?.action === "string" && body.action.startsWith("paper_")) {
    const { data: paper } = await db.from("papers").select("id, teacher_id, files").eq("id", String(body.paper_id ?? "")).maybeSingle();
    if (!paper) return json({ error: "not found" }, 404);
    const { data: me } = await db.rpc("my_teacher_id");
    const { data: role } = await db.rpc("my_role");
    const owner = paper.teacher_id === me || role === "superadmin";
    if (body.action === "paper_upload") {
      if (!owner) return json({ error: "forbidden" }, 403);
      const name = String(body.name ?? "").trim().slice(0, 200), size = Number(body.size);
      if (!name || !(size > 0) || size > MAX_SIZE) return json({ error: "الملف فارغ أو أكبر من 50 ميجابايت" }, 400);
      const ext = (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? "bin").toLowerCase();
      const key = `papers/${paper.id}/${crypto.randomUUID()}.${ext}`;
      return json({ key, url: await presign("PUT", key) });
    }
    const key = String(body.key ?? "");
    if (!key.startsWith(`papers/${paper.id}/`)) return json({ error: "bad key" }, 400);
    if (body.action === "paper_open") return json({ url: await presign("GET", key) });
    if (body.action === "paper_delete") {
      if (!owner) return json({ error: "forbidden" }, 403);
      const res = await r2.fetch(objUrl(key), { method: "DELETE" });
      return res.ok || res.status === 404 ? json({ ok: true }) : json({ error: `R2 answered ${res.status}` }, 502);
    }
    return json({ error: "unknown action" }, 400);
  }

  if (body?.action === "upload") {
    const name = String(body.name ?? "").trim().slice(0, 200), size = Number(body.size);
    if (!name || !(size > 0) || size > MAX_SIZE) return json({ error: "الملف فارغ أو أكبر من 50 ميجابايت" }, 400);
    const id = crypto.randomUUID(), ext = (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? "bin").toLowerCase();
    const key = `staff/${String(body.staff_id)}/${id}.${ext}`;
    // the row first: row-level security refuses it for anyone who may not add files, and then no link is given
    const { error } = await db.from("staff_files").insert({
      id, staff_id: body.staff_id, kind: KINDS.includes(body.kind) ? body.kind : "other", name, object_key: key, size,
      mime: String(body.mime ?? "").slice(0, 120) || null, note: String(body.note ?? "").slice(0, 300) || null, uploaded_by: u.user.email ?? "",
    });
    if (error) return json({ error: error.message }, 403);
    return json({ id, url: await presign("PUT", key) });
  }

  const { data: row, error } = await db.from("staff_files").select("id, name, object_key, mime").eq("id", String(body?.id ?? "")).maybeSingle();
  if (error || !row) return json({ error: "not found" }, 404);

  if (body.action === "open") {
    const disp = `${body.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`;
    return json({ url: await presign("GET", row.object_key, { "response-content-disposition": disp, ...(row.mime ? { "response-content-type": row.mime } : {}) }) });
  }
  if (body.action === "delete") {
    const res = await r2.fetch(objUrl(row.object_key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) return json({ error: `R2 answered ${res.status}` }, 502);
    const { error: de } = await db.from("staff_files").delete().eq("id", row.id);
    if (de) return json({ error: de.message }, 403);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
