/**
 * Dublettenschutz für eigene Mittel.
 * Zwei Mittel gelten als dasselbe, wenn Name, Einheit, Methode, Wert und
 * Zulassungsnummer übereinstimmen. Gleicher Name mit anderem Wert (z. B. andere
 * Aufwandmenge für eine andere Kultur) ist ausdrücklich erlaubt.
 */
type MediumLike = {
  name?: unknown;
  unit?: unknown;
  methodId?: unknown;
  method?: unknown;
  value?: unknown;
  zulassungsnummer?: unknown;
  approval?: unknown;
};

const norm = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export function isSameMedium(a: MediumLike, b: MediumLike): boolean {
  return (
    norm(a.name) === norm(b.name) &&
    norm(a.unit) === norm(b.unit) &&
    norm(a.methodId ?? a.method) === norm(b.methodId ?? b.method) &&
    Number(a.value) === Number(b.value) &&
    norm(a.zulassungsnummer ?? a.approval) ===
      norm(b.zulassungsnummer ?? b.approval)
  );
}
