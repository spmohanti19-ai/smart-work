const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, TOKEN_SECRET, ANTHROPIC_API_KEY, OWNER_CODE } = process.env;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const PLANS = {
  standard: { name: "Standard", price: 50, months: 1 },
  gold: { name: "Gold", price: 200, months: 6 },
  diamond: { name: "Diamond", price: 2000, months: 12 },
};
for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "TOKEN_SECRET"]) {
  if (!process.env[k]) { console.error("Missing env var " + k); process.exit(1); }
}
const rz = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(express.static(__dirname + "/public"));

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (s) => crypto.createHmac("sha256", TOKEN_SECRET).update(s).digest("base64url");
function makeToken(planId, until) {
  const body = b64(JSON.stringify({ p: planId, u: until }));
  return body + "." + sign(body);
}
function readToken(t) {
  if (typeof t !== "string" || !t.includes(".")) return null;
  const [body, sig] = t.split(".");
  const ok = sig && sig.length === sign(body).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)));
  if (!ok) return null;
  try { const d = JSON.parse(Buffer.from(body, "base64url").toString()); return d.u > Date.now() ? d : null; } catch { return null; }
}
function planReply(planId, months) {
  const until = new Date(); until.setMonth(until.getMonth() + months);
  return { name: PLANS[planId].name, until: until.getTime(), token: makeToken(planId, until.getTime()) };
}

// 1. Create a payment order (amount is decided here, never by the browser)
app.post("/api/order", async (req, res) => {
  const plan = PLANS[req.body.plan];
  if (!plan) return res.status(400).json({ error: "Unknown plan" });
  try {
    const order = await rz.orders.create({ amount: plan.price * 100, currency: "INR", receipt: "sw_" + Date.now(), notes: { plan: req.body.plan } });
    res.json({ orderId: order.id, amount: order.amount, keyId: RAZORPAY_KEY_ID });
  } catch (e) { res.status(502).json({ error: "Could not create the payment order" }); }
});

// 2. Verify the payment signature, then issue a signed plan token
const used = new Set();
app.post("/api/verify", async (req, res) => {
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  if (!oid || !pid || !sig) return res.status(400).json({ error: "Missing payment details" });
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(oid + "|" + pid).digest("hex");
  if (expected.length !== String(sig).length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)))) {
    return res.status(400).json({ error: "Payment could not be verified" });
  }
  try {
    const order = await rz.orders.fetch(oid);
    const planId = order.notes && order.notes.plan;
    if (!PLANS[planId] || order.amount !== PLANS[planId].price * 100) return res.status(400).json({ error: "Order does not match a plan" });
    if (used.has(pid)) return res.status(409).json({ error: "This payment was already used" });
    used.add(pid);
    res.json(planReply(planId, PLANS[planId].months));
  } catch (e) { res.status(502).json({ error: "Could not confirm the order" }); }
});

// 3. Owner access code (free Diamond)
app.post("/api/code", (req, res) => {
  if (!OWNER_CODE || req.body.code !== OWNER_CODE) return res.status(403).json({ error: "Invalid code" });
  res.json(planReply("diamond", 120));
});

// 4. AI helper: Homework and Career need a paid token, NCERT is free (rate limited)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  h.push(now); hits.set(ip, h); return h.length > 20;
}
app.post("/api/ask", async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI is not set up yet." });
  const { kind, prompt, token, image } = req.body;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 6000) return res.status(400).json({ error: "Invalid question" });
  let system = "You are Smart Works, a friendly study helper for Indian school students. Explain simply and step by step.";
  if (kind === "ncert") {
    if (limited(req.ip)) return res.status(429).json({ error: "Free limit reached for this hour. Upgrade for more." });
    system += " Only help with school study questions; politely decline anything else.";
  } else if (kind === "homework" || kind === "career") {
    if (!readToken(token)) return res.status(402).json({ error: "Please upgrade to use this feature." });
  } else return res.status(400).json({ error: "Unknown section" });
  const content = [];
  if (image && kind === "homework" && /^image\/(png|jpeg|webp|gif)$/.test(image.media_type)) {
    content.push({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } });
  }
  content.push({ type: "text", text: prompt });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "The AI is busy. Please try again." });
    res.json({ text: j.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") });
  } catch (e) { res.status(502).json({ error: "The AI is busy. Please try again." }); }
});

app.listen(process.env.PORT || 3000, () => console.log("Smart Works running"));
