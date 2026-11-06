import { createHash } from "node:crypto";

/**
 * The READMEs install writes only once (the decisions ledger's, the knowledge
 * store's, the custom overlay's) belong to the human after that. A README still
 * exactly as an earlier Mahler version wrote it was never edited, so reinstall
 * may bring it up to date. These are the sha256 hashes of those earlier texts.
 *
 * When you change one of these templates, add the hash of its previous text
 * here (the readme-versions test fails until you do).
 */
export const EARLIER_README_HASHES: Record<string, string[]> = {
  "decisions-readme": [
    "ef83a88e01e2119468d004ef75e1ca74a8063a5a52d177e166ea272ab0e13d42",
    "f23a49412e4d1e77e700b8e8937429aa1570ecd4bdabab45712504fa862e6a04",
    "1da5fdb3a56161c45605ba186e6a075581b86bd580b4c8fbd5ed9e935327ad22",
    "bd6ce2991958131945bbdbab33d6443e0fcc0c96cb6f28b55a14dbf90a58b03d",
    "234f155d8bc1a3067168f2c307ab7ffffadf151f8966644c4a8a7d8e988df5c4",
  ],
  "knowledge-readme": [
    "66cc5f918dbac7f29146d25cb6e325507232a2ff5731c3fe1b6ab093397ecea0",
    "0e7fbea476985bdd6ea621fab0537fafef2d93e965deb030c3d9caee250cd551",
    "51d0382fe6683c31d7424d5fbec243fbc1ffe8975e8fa9e0f0e3305db88dbdbc",
    "cdaf96a2fe311ff74bff7195aa22c11f0bc079a82479cffba68c6eab425f507a",
  ],
  "custom-readme": [],
};

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Whether `text` is exactly what an earlier Mahler version installed as `template`. */
export function isEarlierReadme(template: string, text: string): boolean {
  return (EARLIER_README_HASHES[template] ?? []).includes(sha256(text));
}
