/**
 * Short random ids: a prefix + 8 chars of [a-z0-9]. Minted in the browser (the editors, so a save
 * never waits for the server) and on the server alike.
 */

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

/** Fills the array with random bytes and returns it. */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;

/** crypto.getRandomValues, NOT randomUUID: the app is served over plain http, an insecure context
 *  in which browsers leave randomUUID undefined. */
const cryptoRandom: RandomSource = (bytes) => globalThis.crypto.getRandomValues(bytes);

function randomSuffix(random: RandomSource): string {
  let out = "";
  for (let round = 0; out.length < ID_LENGTH; round++) {
    if (round >= 64) throw new Error("random source produced no usable bytes");
    for (const b of random(new Uint8Array(16))) {
      if (b >= 252) continue;   // 252 = 7 × 36: dropping 252..255 keeps every character equally likely
      out += ID_ALPHABET[b % 36];
      if (out.length === ID_LENGTH) break;
    }
  }
  return out;
}

export const newPrefixedId = (prefix: string, random: RandomSource = cryptoRandom): string => prefix + randomSuffix(random);

/** A minted id that is in none of `taken`; `what` names it in the error when 100 tries all collide. */
export function mintFree(mint: () => string, taken: ReadonlySet<string>, what: string): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = mint();
    if (!taken.has(id)) return id;
  }
  throw new Error(`could not mint a free ${what}`);
}
