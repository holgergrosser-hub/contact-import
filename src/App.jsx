import { useState } from "react";
import { localParse, formatPhone } from "./localParse.js";

const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxcV-wb52T-ju4301RxBwXlZL2w0p3Uw1DxYplDuZbAXNoIRIUGg2XIvHzcd_UEfg8vSw/exec";

const empty = {
  prefix: "", firstName: "", lastName: "",
  company: "", jobTitle: "",
  emailWork: "", emailPersonal: "",
  phoneMobile: "", phoneWork: "", phoneFax: "",
  street: "", postalCode: "", city: "", country: "",
  notes: "",
};

const sections = [
  { title: "Person", fields: [
    { key: "prefix", label: "Titel", ph: "Dr. / Prof." },
    { key: "firstName", label: "Vorname" },
    { key: "lastName", label: "Nachname" },
  ]},
  { title: "Firma", fields: [
    { key: "company", label: "Firma" },
    { key: "jobTitle", label: "Position" },
  ]},
  { title: "Kontakt", fields: [
    { key: "emailWork", label: "E-Mail gesch." },
    { key: "emailPersonal", label: "E-Mail privat" },
    { key: "phoneMobile", label: "Mobil" },
    { key: "phoneWork", label: "Telefon" },
    { key: "phoneFax", label: "Fax" },
  ]},
  { title: "Adresse", fields: [
    { key: "street", label: "Straße" },
    { key: "postalCode", label: "PLZ", width: "30%" },
    { key: "city", label: "Ort", width: "66%" },
    { key: "country", label: "Land" },
  ]},
  { title: "Sonstiges", fields: [
    { key: "notes", label: "Notizen", multi: true },
  ]},
];

const font = "'DM Sans', sans-serif";

export default function App() {
  const [d, setD] = useState(empty);
  const [status, setStatus] = useState("idle");
  const [open, setOpen] = useState({
    Person: true, Firma: true, Kontakt: true, Adresse: true, Sonstiges: false,
  });

  // AI parse state
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseNote, setParseNote] = useState("");
  const [sendError, setSendError] = useState("");
  const [showPaste, setShowPaste] = useState(true);

  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const fullName = [d.prefix, d.firstName, d.lastName].filter(Boolean).join(" ");
  const initials = [d.firstName, d.lastName].map((n) => n?.[0] || "").join("").toUpperCase();
  const toggle = (t) => setOpen((p) => ({ ...p, [t]: !p[t] }));

  /* ── Claude AI Parse ── */
  const parseWithClaude = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setParseError("");
    setParseNote("");

    // Lokale Erkennung läuft immer mit: füllt Lücken der KI und ersetzt sie bei Ausfall.
    const local = localParse(rawText);
    let ai = null;
    let aiError = "";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/parse-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) {
        throw new Error(body?.error || `Server-Fehler ${res.status}`);
      }
      ai = body;
    } catch (e) {
      aiError = e.name === "AbortError" ? "Zeitüberschreitung" : e.message || "nicht erreichbar";
    } finally {
      clearTimeout(timer);
    }

    const result = { ...empty };
    for (const key of Object.keys(empty)) {
      const v = typeof ai?.[key] === "string" ? ai[key].trim() : "";
      result[key] = v || local[key] || "";
    }
    for (const k of ["phoneMobile", "phoneWork", "phoneFax"]) {
      if (result[k] && !result[k].startsWith("+")) result[k] = formatPhone(result[k]);
    }

    const found = Object.keys(empty).some((k) => k !== "notes" && result[k]);
    if (!found) {
      setParseError(
        aiError
          ? `Nichts erkannt (KI: ${aiError}). Bitte Text prüfen oder manuell eingeben.`
          : "Im Text wurden keine Kontaktdaten gefunden."
      );
    } else {
      setD(result);
      setOpen((p) => ({ ...p, Sonstiges: p.Sonstiges || !!result.notes }));
      if (aiError) setParseNote(`KI nicht verfügbar (${aiError}) – lokal erkannt, bitte Felder prüfen.`);
      setShowPaste(false);
    }
    setParsing(false);
  };

  /* ── Send to Google Contacts ── */
  const send = async () => {
    if (!fullName && !d.company) {
      setSendError("Bitte mindestens Name oder Firma angeben.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    setSendError("");
    try {
      const formData = new FormData();
      // Firmenkontakt ohne Ansprechpartner: Firma als Anzeigename
      const payload = { ...d, fullName: fullName || d.company };
      Object.keys(payload).forEach((k) => formData.append(k, String(payload[k] ?? "").trim()));
      const res = await fetch(SCRIPT_URL, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Google Apps Script antwortet mit ${res.status}`);
      // Meldet das Script einen Fehler im Body, nicht als Erfolg anzeigen
      const text = await res.text().catch(() => "");
      try {
        const j = JSON.parse(text);
        if (j && (j.error || j.success === false || j.status === "error")) {
          throw new Error(j.error || j.message || "Script meldet einen Fehler");
        }
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
      setStatus("done");
    } catch (e) {
      setSendError(e.message === "Failed to fetch" ? "" : e.message || "");
      setStatus("error");
    }
  };

  const reset = () => {
    setD(empty);
    setStatus("idle");
    setRawText("");
    setShowPaste(true);
    setParseError("");
    setParseNote("");
    setSendError("");
  };

  const pills = [
    d.emailWork && { i: "✉", v: d.emailWork },
    d.phoneMobile && { i: "📱", v: d.phoneMobile },
    d.phoneWork && { i: "☎", v: d.phoneWork },
    d.city && { i: "📍", v: `${d.postalCode} ${d.city}`.trim() },
  ].filter(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: "#f0f0ee", fontFamily: font, padding: "24px 16px" }}>

      {/* ── AI Paste Card ── */}
      {showPaste && (
        <div style={{
          maxWidth: 460, margin: "0 auto 12px",
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
          borderRadius: 20, padding: "22px 22px 20px", color: "#fff",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>✨</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>KI-Import</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>Signatur, Visitenkarte oder Text einfügen</div>
            </div>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"Max Mustermann\nGeschäftsführer · Muster GmbH\nmax@muster.de\n+49 171 9876543"}
            rows={4}
            style={{
              width: "100%", padding: "12px 14px", fontSize: 13, fontFamily: font,
              border: "1.5px solid rgba(255,255,255,0.2)", borderRadius: 12,
              background: "rgba(255,255,255,0.12)", color: "#fff",
              outline: "none", resize: "vertical", boxSizing: "border-box",
              lineHeight: 1.5,
            }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.5)")}
            onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.2)")}
          />
          {parseError && (
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 8 }}>{parseError}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={parseWithClaude}
              disabled={parsing || !rawText.trim()}
              style={{
                flex: 1, padding: "10px 0", border: "none", borderRadius: 10,
                background: parsing ? "rgba(255,255,255,0.15)" : "#fff",
                color: parsing ? "#fff" : "#4f46e5",
                fontSize: 13, fontWeight: 700, fontFamily: font,
                cursor: parsing ? "wait" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {parsing ? "Wird analysiert …" : "Mit Claude erkennen →"}
            </button>
            <button
              onClick={() => setShowPaste(false)}
              style={{
                padding: "10px 16px", border: "1.5px solid rgba(255,255,255,0.25)",
                borderRadius: 10, background: "none", color: "rgba(255,255,255,0.7)",
                fontSize: 13, fontWeight: 600, fontFamily: font, cursor: "pointer",
              }}
            >Manuell</button>
          </div>
        </div>
      )}

      {parseNote && (
        <div style={{
          maxWidth: 460, margin: "0 auto 12px", boxSizing: "border-box",
          background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 12,
          padding: "10px 14px", fontSize: 12, color: "#92400e", lineHeight: 1.4,
        }}>⚠ {parseNote}</div>
      )}

      {/* ── Header Card ── */}
      <div style={{
        maxWidth: 460, margin: "0 auto 14px", background: "#1a1a1a", borderRadius: 20,
        padding: "28px 24px", color: "#fff", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -50, right: -50, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 54, height: 54, borderRadius: 16, flexShrink: 0,
            background: "linear-gradient(135deg,#6366f1,#a78bfa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 19, fontWeight: 700, letterSpacing: 1,
          }}>{initials || "?"}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {fullName || "Neuer Kontakt"}
            </div>
            {(d.company || d.jobTitle) && (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
                {[d.jobTitle, d.company].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
        {pills.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 18 }}>
            {pills.map((p, i) => (
              <span key={i} style={{
                background: "rgba(255,255,255,0.07)", borderRadius: 10, padding: "4px 10px",
                fontSize: 11, color: "rgba(255,255,255,0.6)", display: "inline-flex", alignItems: "center", gap: 5,
              }}><span style={{ fontSize: 11 }}>{p.i}</span>{p.v}</span>
            ))}
          </div>
        )}
        {!showPaste && (
          <button
            onClick={() => setShowPaste(true)}
            style={{
              position: "absolute", top: 16, right: 16,
              background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8,
              padding: "5px 10px", fontSize: 14, cursor: "pointer", color: "rgba(255,255,255,0.5)",
            }}
          >✨</button>
        )}
      </div>

      {/* ── Editable Sections ── */}
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {sections.map((sec) => (
          <div key={sec.title} style={{
            background: "#fff", borderRadius: 16, marginBottom: 8, overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}>
            <button onClick={() => toggle(sec.title)} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 18px", border: "none", background: "none", cursor: "pointer",
              fontFamily: font, fontSize: 11, fontWeight: 700, color: "#1a1a1a",
              letterSpacing: 1.2, textTransform: "uppercase",
            }}>
              {sec.title}
              <span style={{
                fontSize: 16, color: "#bbb", display: "inline-block",
                transition: "transform 0.2s",
                transform: open[sec.title] ? "rotate(0)" : "rotate(-90deg)",
              }}>▾</span>
            </button>
            {open[sec.title] && (
              <div style={{ padding: "0 18px 16px", display: "flex", flexWrap: "wrap", gap: 10 }}>
                {sec.fields.map((f) => (
                  <div key={f.key} style={{ width: f.width || "100%", flexShrink: 0, minWidth: 0 }}>
                    <label style={{
                      display: "block", fontSize: 9.5, fontWeight: 700, color: "#aaa",
                      textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 2,
                    }}>{f.label}</label>
                    {f.multi ? (
                      <textarea rows={2} value={d[f.key]} onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.ph || ""}
                        style={{
                          width: "100%", padding: "8px 12px", fontSize: 14, fontFamily: font,
                          border: "1.5px solid #ebebea", borderRadius: 10, background: "#fafaf9",
                          outline: "none", resize: "vertical", color: "#1a1a1a", boxSizing: "border-box",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
                        onBlur={(e) => (e.target.style.borderColor = "#ebebea")}
                      />
                    ) : (
                      <input value={d[f.key]} onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.ph || ""}
                        style={{
                          width: "100%", padding: "8px 12px", fontSize: 14, fontFamily: font,
                          border: `1.5px solid ${d[f.key] ? "#ebebea" : "#e2e2e0"}`,
                          borderRadius: 10, background: d[f.key] ? "#fafaf9" : "#fff",
                          outline: "none", color: "#1a1a1a", boxSizing: "border-box",
                        }}
                        onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
                        onBlur={(e) => (e.target.style.borderColor = "#ebebea")}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* ── Action Area ── */}
        {status === "done" ? (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "28px 24px", textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)", marginTop: 4,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%", margin: "0 auto 12px",
              background: "linear-gradient(135deg,#22c55e,#4ade80)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, color: "#fff",
            }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a" }}>Kontakt gesendet</div>
            <div style={{ fontSize: 13, color: "#999", marginTop: 4, lineHeight: 1.4 }}>
              {fullName} wurde an Google Kontakte übermittelt.
            </div>
            <button onClick={reset} style={{
              marginTop: 16, padding: "8px 28px", border: "1.5px solid #e8e8e6",
              borderRadius: 10, background: "none", fontFamily: font, fontSize: 13,
              fontWeight: 600, cursor: "pointer", color: "#666",
            }}>Weiteren Kontakt senden</button>
          </div>
        ) : status === "error" ? (
          <div style={{
            background: "#fff", borderRadius: 16, padding: "28px 24px", textAlign: "center",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)", marginTop: 4,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%", margin: "0 auto 12px",
              background: "linear-gradient(135deg,#ef4444,#f87171)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, color: "#fff",
            }}>✕</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a" }}>Fehler beim Senden</div>
            <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>{sendError || "Bitte Verbindung prüfen und erneut versuchen."}</div>
            <button onClick={() => setStatus("idle")} style={{
              marginTop: 16, padding: "8px 28px", border: "1.5px solid #e8e8e6",
              borderRadius: 10, background: "none", fontFamily: font, fontSize: 13,
              fontWeight: 600, cursor: "pointer", color: "#666",
            }}>Erneut versuchen</button>
          </div>
        ) : (
          <button onClick={send} disabled={status === "sending"} style={{
            width: "100%", padding: "16px 0", border: "none", borderRadius: 16,
            background: status === "sending" ? "#4f46e5" : "#1a1a1a",
            color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: font,
            cursor: status === "sending" ? "wait" : "pointer",
            marginTop: 4, letterSpacing: 0.3,
            boxShadow: "0 4px 20px rgba(0,0,0,0.10)",
            transition: "background 0.2s",
          }}>
            {status === "sending" ? "Wird gesendet …" : "In Google Kontakte importieren →"}
          </button>
        )}
      </div>
    </div>
  );
}
