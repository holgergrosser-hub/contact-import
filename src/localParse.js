// Lokale Erkennung ohne KI – Fallback, wenn die Claude-Function nicht antwortet,
// und Lückenfüller für Felder, die die KI leer gelassen hat.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PRIVATE_MAIL = /@(gmail|googlemail|gmx|web|t-online|outlook|hotmail|yahoo|icloud|freenet|posteo|mailbox)\./i;
const COMPANY = /\b(GmbH|mbH|AG|KG|KGaA|UG|OHG|GbR|SE|e\.\s?K\.|e\.\s?V\.|eG|Ltd\.?|Inc\.?|LLC|S\.?A\.?|B\.?V\.?|Co\.)(?=$|[\s,&)])/;
const STREET = /^[^\d@]*?(stra(ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee|steig|pfad|hof|markt|park|berg|graben|zeile)\s*\d+\s*[a-zA-Z]?(\s*[-–/]\s*\d+\s*[a-zA-Z]?)?$/i;
const PLZ_CITY = /(?:^|\s|D-)(\d{5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .()/-]+)$/;
const PREFIX = /^((?:Prof\.|Dr\.|Dipl\.-\w+\.?|Ing\.|Mag\.|RA)(?:\s+(?:Dr\.|Ing\.|h\.\s?c\.|med\.|rer\.\s?nat\.|jur\.))*)\s+/;
const JOB = /(geschäftsf|inhaber|leiter|leitung|manager|beauftragte|direktor|director|vorstand|prokurist|ceo|cto|cfo|coo|assisten|berater|consultant|vertrieb|einkauf|sales|head of|referent|sachbearbeit|ingenieur|qmb)/i;
const FAX = /fax/i;
const MOBILE_LABEL = /(mobil|handy|cell|mob\.)/i;

export function formatPhone(raw) {
  let s = String(raw).replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (s.startsWith("0")) s = "+49" + s.slice(1);
  // Excel schneidet die führende 0 ab: 1724534315 → 0172 4534315
  else if (!s.startsWith("+") && /^1[5-7]\d{8,9}$/.test(s)) s = "+49" + s;
  else if (!s.startsWith("+")) return String(raw).trim();
  const m = s.match(/^\+49(1[5-7]\d)(\d+)$/);
  if (m) return `+49 ${m[1]} ${m[2]}`;
  const c = s.match(/^\+(\d{2})(\d+)$/);
  return c ? `+${c[1]} ${c[2]}` : s;
}

const isMobile = (p) => /^\+49 ?1[5-7]/.test(p);

export function localParse(input) {
  const out = {
    prefix: "", firstName: "", lastName: "", company: "", jobTitle: "",
    emailWork: "", emailPersonal: "", phoneMobile: "", phoneWork: "", phoneFax: "",
    street: "", postalCode: "", city: "", country: "", notes: "",
  };

  // Zellen/Zeilen: Tabs, Zeilenumbrüche und typische Signatur-Trenner
  const tokens = String(input)
    .replace(/"/g, "")
    .split(/[\t\r\n]+|\s[|·•]\s/)
    .map((t) => t.trim())
    .filter(Boolean);

  const used = new Set();
  const take = (i) => used.add(i);

  // E-Mails
  const mails = [...new Set(String(input).match(EMAIL) || [])];
  for (const m of mails) {
    if (PRIVATE_MAIL.test(m) && !out.emailPersonal) out.emailPersonal = m;
    else if (!out.emailWork) out.emailWork = m;
    else if (!out.emailPersonal) out.emailPersonal = m;
  }

  tokens.forEach((t, i) => {
    if (EMAIL.test(t)) take(i);
    EMAIL.lastIndex = 0;

    // Telefon
    const digits = t.replace(/\D/g, "");
    const phoneLike = /^[^A-Za-z@€]*[\d\s()+/.-]{7,}$/.test(t.replace(/^(tel(efon)?|fon|phone|mobil|handy|mob|cell|fax|t|m|f)\.?\s*:?\s*/i, ""));
    if (phoneLike && digits.length >= 7 && digits.length <= 15 && !/^\d{5}$/.test(digits) && !t.includes("€")) {
      const p = formatPhone(t.replace(/^[^\d+(]*/, ""));
      if (FAX.test(t)) out.phoneFax ||= p;
      else if (MOBILE_LABEL.test(t) || isMobile(p)) out.phoneMobile ||= p;
      else out.phoneWork ||= p;
      take(i);
      return;
    }

    // PLZ + Ort
    const pc = t.match(PLZ_CITY);
    if (pc) {
      out.postalCode ||= pc[1];
      out.city ||= pc[2].trim();
      take(i);
      return;
    }
    if (/^\d{5}$/.test(t)) {
      out.postalCode ||= t;
      take(i);
      return;
    }

    // Straße
    if (STREET.test(t)) {
      out.street ||= t;
      take(i);
      return;
    }

    // Firma
    if (COMPANY.test(t)) {
      if (!out.company) out.company = t;
      take(i);
    }
  });

  // Person: bevorzugt der Token, der zur E-Mail passt
  const local = (out.emailWork || out.emailPersonal).split("@")[0].toLowerCase();
  const norm = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  const nameLike = (t) =>
    /^[A-Za-zÄÖÜäöüßéèáàçñ.'-]+(\s+[A-Za-zÄÖÜäöüßéèáàçñ.'-]+){1,3}$/.test(t) && !JOB.test(t);

  let nameIdx = -1;
  tokens.forEach((t, i) => {
    if (used.has(i) || nameIdx >= 0 && !local) return;
    const bare = t.replace(PREFIX, "");
    if (!nameLike(bare)) return;
    const parts = norm(bare).split(/\s+/);
    const matchesMail = local && parts.some((p) => p.length > 2 && local.includes(p));
    if (matchesMail) nameIdx = i;
    else if (nameIdx < 0 && !local) nameIdx = i;
  });
  if (nameIdx < 0) nameIdx = tokens.findIndex((t, i) => !used.has(i) && nameLike(t.replace(PREFIX, "")) && /^[A-ZÄÖÜ]/.test(t));
  if (nameIdx >= 0) {
    let n = tokens[nameIdx];
    const p = n.match(PREFIX);
    if (p) { out.prefix = p[1]; n = n.slice(p[0].length); }
    const parts = n.split(/\s+/);
    out.lastName = parts.pop();
    out.firstName = parts.join(" ");
    take(nameIdx);
  }

  // Position
  tokens.forEach((t, i) => {
    if (!used.has(i) && !out.jobTitle && JOB.test(t) && t.length < 60) { out.jobTitle = t; take(i); }
  });

  if (out.postalCode && /^\d{5}$/.test(out.postalCode) && !out.country) out.country = "Deutschland";

  // Rest → Notizen (ohne Dubletten wie die wiederholte Adresse)
  const known = norm([out.company, out.street, out.city, out.firstName, out.lastName].join(" ").replace(/str\./gi, "strasse"));
  const rest = tokens.filter((t, i) => {
    if (used.has(i)) return false;
    const n = norm(t.replace(/str\./gi, "strasse"));
    return !n.split(/\s+/).every((w) => known.includes(w));
  });
  out.notes = [...new Set(rest)].join(" · ");

  return out;
}
