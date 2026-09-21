import Anthropic from "@anthropic-ai/sdk";

const FIELDS = [
  "prefix", "firstName", "lastName", "company", "jobTitle",
  "emailWork", "emailPersonal", "phoneMobile", "phoneWork", "phoneFax",
  "street", "postalCode", "city", "country", "notes",
];

const SCHEMA = {
  type: "object",
  properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "string" }])),
  required: FIELDS,
  additionalProperties: false,
};

const SYSTEM = `Du extrahierst Kontaktdaten aus beliebigem Text: E-Mail-Signaturen, Visitenkarten, Fließtext oder aus Excel/CRM kopierte Tabellenzeilen (Tab-getrennt, ohne Spaltenüberschriften, teils mit doppelten oder verrutschten Spalten).

Regeln:
- Unbekannte Felder bleiben ein leerer String "". Nichts erfinden.
- Tabellenzeilen: Ordne jede Zelle nach ihrem Inhalt zu, nicht nach ihrer Position. Doppelte Angaben (z. B. Adresse zweimal) nur einmal übernehmen.
- company: vollständiger Firmenname inkl. Rechtsform (GmbH, mbH, AG, KG …).
- Ansprechpartner in firstName/lastName trennen; Titel (Dr., Prof.) nach prefix.
- street: Straße mit Hausnummer. postalCode: nur die PLZ. city: nur der Ort ohne PLZ.
- country: nur wenn genannt oder eindeutig (deutsche PLZ + deutscher Ort → "Deutschland").
- Telefonnummern im Format +49 … . Eine Ziffernfolge ohne führende 0, die mit 15, 16 oder 17 beginnt (z. B. 1724534315), ist eine deutsche Mobilnummer, bei der Excel die führende 0 entfernt hat → +49 172 4534315. Mobilnummern nach phoneMobile, Festnetz nach phoneWork.
- Geschäftliche E-Mail (Firmendomain) nach emailWork, private (gmail, gmx, web.de …) nach emailPersonal.
- notes: übrige nützliche Angaben aus dem Text kurz mit " · " getrennt (z. B. Branche, Norm wie ISO 9001, Mitarbeiterzahl, Preis/Angebotssumme, Website). Keine Felder wiederholen, die schon zugeordnet sind.`;

const json = (body, status = 200) => Response.json(body, { status });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt" }, 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY ist in Netlify nicht gesetzt" }, 500);
  }

  let text = "";
  try {
    text = String((await req.json())?.text ?? "").trim();
  } catch {
    return json({ error: "Ungültige Anfrage" }, 400);
  }
  if (!text) return json({ error: "Kein Text übergeben" }, 400);
  if (text.length > 20000) return json({ error: "Text ist zu lang (max. 20.000 Zeichen)" }, 413);

  // Netlify beendet synchrone Functions nach 10 s – daher knappes Timeout und nur ein Retry.
  const client = new Anthropic({ timeout: 8000, maxRetries: 1 });

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      // Thinking aus: reine Extraktion, und die Antwort muss ins 10-s-Limit passen.
      thinking: { type: "disabled" },
      system: SYSTEM,
      messages: [{ role: "user", content: `<text>\n${text}\n</text>` }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
    });

    if (msg.stop_reason === "refusal") return json({ error: "Anfrage wurde abgelehnt" }, 422);
    if (msg.stop_reason === "max_tokens") return json({ error: "Antwort war zu lang" }, 502);

    const out = msg.content.find((b) => b.type === "text")?.text;
    if (!out) return json({ error: "Leere Antwort von Claude" }, 502);

    const parsed = JSON.parse(out);
    const clean = {};
    for (const f of FIELDS) clean[f] = typeof parsed[f] === "string" ? parsed[f].trim() : "";
    return json(clean);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "API-Key ungültig" }, 500);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Rate-Limit erreicht – kurz warten" }, 429);
    if (err instanceof Anthropic.APIConnectionError) return json({ error: "Claude nicht erreichbar (Timeout)" }, 504);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude-API: ${err.status} ${err.message}` }, 502);
    return json({ error: err.message || "Unbekannter Fehler" }, 500);
  }
};

export const config = { path: "/api/parse-contact" };
