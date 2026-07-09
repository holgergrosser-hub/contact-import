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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { text } = await req.json();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Extrahiere Kontaktdaten aus folgendem Text. Antworte NUR mit einem JSON-Objekt, keine Erklärung, kein Markdown.

Die Felder sind:
- prefix (Titel wie Dr., Prof.)
- firstName
- lastName
- company
- jobTitle
- emailWork
- emailPersonal
- phoneMobile
- phoneWork
- phoneFax
- street
- postalCode
- city
- country
- notes

Lasse unbekannte Felder als leeren String "".
Formatiere Telefonnummern im internationalen Format +49 ... wenn möglich.

Text:
${text}`,
          },
        ],
      }),
    });

    const data = await res.json();
    const content = data.content?.[0]?.text || "{}";

    // Parse JSON from response, stripping markdown fences if present
    const clean = content.replace(/```json\s*|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config = { path: "/api/parse-contact" };
