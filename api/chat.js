// Vercel serverless function: the AI receptionist. Works with any OpenAI-compatible API.
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_ANON_KEY;
const sb = (p, o = {}) => fetch(U + "/rest/v1/" + p, { ...o, headers: { apikey: K, "Content-Type": "application/json", ...o.headers } });
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

module.exports = async (req, res) => {
  try {
    const { slug, messages } = req.body || {};
    const shop = (await (await sb("shops?select=*&slug=eq." + encodeURIComponent(slug))).json())[0];
    if (!shop) return res.status(404).json({ reply: "Shop not found." });
    const taken = await (await sb("rpc/taken_slots", { method: "POST", body: JSON.stringify({ s: slug }) })).json();
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: shop.tz }));
    const step = Math.min(...shop.services.map(s => s.m || 30));
    let open = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(now); d.setDate(now.getDate() + i);
      if (shop.closed.includes(d.getDay())) continue;
      const ts = [];
      for (let m = shop.open * 60; m + step <= shop.close * 60; m += step) {
        const t = pad(Math.floor(m / 60)) + ":" + pad(m % 60);
        if (i === 0 && m <= now.getHours() * 60 + now.getMinutes()) continue;
        if (taken.some(x => x.date === ymd(d) && x.time === t)) continue;
        ts.push(t);
      }
      open += `${d.toDateString()} (${ymd(d)}): ${ts.join(", ") || "full"}\n`;
    }
    const system = `You are the text receptionist for ${shop.name}. Reply like a friendly human in 1-3 short sentences, no markdown.
Today is ${now.toDateString()}. Services:\n${shop.services.map(s => `${s.n}: $${s.p}, ${s.m} min`).join("\n")}
Policies: ${shop.faq}
OPEN TIMES (24h, the only times you may offer):\n${open}
Never invent prices, services, or policies; if unsure, say the owner will follow up. To book you need service, day, time, and customer name. Ask for missing items one at a time. After the customer clearly confirms, reply with a short confirmation and add a final line exactly: [BOOKED: service | YYYY-MM-DD | HH:MM | name | phone]. If asked, say you are an automated assistant.`;
    const r = await fetch(process.env.AI_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.AI_API_KEY },
      body: JSON.stringify({ model: process.env.AI_MODEL, messages: [{ role: "system", content: system }, ...(messages || []).slice(-12).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content).slice(0, 500) }))] })
    });
    let text = ((await r.json()).choices?.[0]?.message?.content || "").trim();
    let booked = false;
    const m = text.match(/\[BOOKED:([^\]]+)\]/);
    text = text.replace(/\[BOOKED:[^\]]*\]/g, "").trim();
    if (m) {
      const [service, date, time, name, phone] = m[1].split("|").map(s => s.trim());
      const ins = await sb("bookings", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ shop_id: shop.id, date, time, service, name, phone: phone || "" }) });
      if (ins.ok) booked = true; else text = "Sorry, that time was just taken. Want to pick another one?";
    }
    res.json({ reply: text || "Sorry, something went wrong. The owner will follow up.", booked });
  } catch (e) { res.status(500).json({ reply: "Sorry, something went wrong." }); }
};
