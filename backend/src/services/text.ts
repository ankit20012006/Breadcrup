/** Small text helpers shared by Chat Guard and the demo heuristics. */

export const STOPWORDS = new Set(
  (
    "a an the and or but if then so to of in on at by for with from into onto over under behind near up down out off " +
    "is are was were be been being am do does did done have has had having it its it's this that these those there here " +
    "i me my we our you your he she they them their his her him what which who whom when where why how all any some " +
    "no not just only very really too also can could should would will might may must shall need maybe probably " +
    "try check look go get got use see find think thing stuff like lol yeah yes ok okay pls please bro dude chat " +
    "im i'm dont don't cant can't its youre you're thats that's gonna wanna gotta one two already again still even " +
    "about around than more most much many other inspect examine search hit press interact " +
    // chat filler that would otherwise dominate topics
    "first time stream streamer streaming today tonight hello hey hii guys everyone catching love"
  ).split(/\s+/),
);

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|net|org|gg|tv|io|ly|me|co|xyz|ru|info|biz|live|shop|store|app|link|click)(?:\/[^\s]*)?)/gi;

/** Lowercase, strip punctuation/emote noise, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s:/.\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text: string): string[] {
  return normalize(text)
    .replace(URL_RE, " ")
    .split(/[\s:/.\-]+/)
    .filter(Boolean);
}

export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

export function extractDomains(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const host = match[1]!.replace(/^https?:\/\//i, "").split("/")[0]!.toLowerCase().replace(/^www\./, "");
    out.push(host);
  }
  return out;
}

/** Character trigram shingles — robust to small edits like added emotes or punctuation. */
export function shingles(text: string, n = 3): Set<string> {
  const s = normalize(text).replace(/\s+/g, " ");
  const set = new Set<string>();
  if (s.length <= n) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
  return set;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function sentenceCase(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  const capped = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`;
}
