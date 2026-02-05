const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

const DEFAULT_EMAIL_SUBJECT = "New Website Message";
const DEFAULT_EMAIL_FROMNAME = "My coaching Website";

function parseAllowedOrigins(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeBody(reqBody) {
  if (!reqBody) return {};

  if (typeof reqBody === "object") return reqBody;

  if (typeof reqBody === "string") {
    try {
      return JSON.parse(reqBody);
    } catch {
      return {};
    }
  }

  return {};
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (!accessKey) {
    console.error("WEB3FORMS_ACCESS_KEY is not set");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const allowedOrigins = parseAllowedOrigins(process.env.CONTACT_ALLOWED_ORIGINS);
  if (allowedOrigins.length) {
    const origin = req.headers?.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "Forbidden origin" });
      return;
    }
  }

  const body = normalizeBody(req.body);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();

  if (!name || !email || !message) {
    res.status(400).json({ error: "Missing name, email, or message" });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const subject = process.env.CONTACT_EMAIL_SUBJECT || DEFAULT_EMAIL_SUBJECT;
  const fromName = process.env.CONTACT_FROM_NAME || DEFAULT_EMAIL_FROMNAME;

  try {
    const upstreamRes = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        access_key: accessKey,
        subject,
        from_name: fromName,
        name,
        email,
        message,
      }),
    });

    const upstreamBody = await upstreamRes.json().catch(() => null);
    const ok = Boolean(upstreamRes.ok && upstreamBody && upstreamBody.success);

    if (!ok) {
      console.error("Web3Forms error:", upstreamRes.status, upstreamBody);
      res
        .status(502)
        .json({ error: upstreamBody?.message || "Upstream email provider error" });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Contact API error:", err?.message || err);
    res.status(500).json({ error: "Server error" });
  }
}

