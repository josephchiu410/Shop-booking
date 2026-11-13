// Vercel serverless function: Stripe tells us who paid, and we mark them active.
const crypto = require("crypto");
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY, W = process.env.STRIPE_WEBHOOK_SECRET;
const sb = (p, o = {}) => fetch(U + "/rest/v1/" + p, { ...o, headers: { apikey: K, "Content-Type": "application/json", ...o.headers } });
const raw = req => new Promise((res, rej) => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => res(Buffer.concat(c))); req.on("error", rej); });
function verified(body, header) {
  const parts = (header || "").split(",").map(x => x.split("="));
  const t = (parts.find(p => p[0] === "t") || [])[1], sigs = parts.filter(p => p[0] === "v1").map(p => p[1]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const h = crypto.createHmac("sha256", W).update(t + "." + body.toString("utf8")).digest("hex");
  return sigs.some(s => s.length === h.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(h)));
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const body = await raw(req);
  if (!verified(body, req.headers["stripe-signature"])) return res.status(400).send("Bad signature");
  const ev = JSON.parse(body.toString("utf8")), o = ev.data.object, now = new Date().toISOString();
  if (ev.type === "checkout.session.completed") {
    const email = ((o.customer_details && o.customer_details.email) || o.customer_email || "").toLowerCase();
    if (email) await sb("subscribers?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ email, status: "active", stripe_customer: o.customer || null, updated_at: now }) });
  } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
    const active = ev.type !== "customer.subscription.deleted" && ["active", "trialing"].includes(o.status);
    await sb("subscribers?stripe_customer=eq." + encodeURIComponent(o.customer), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: active ? "active" : "inactive", updated_at: now }) });
  }
  res.status(200).json({ received: true });
};
module.exports.config = { api: { bodyParser: false } };
