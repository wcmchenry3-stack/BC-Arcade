/**
 * Marks that end a sentence; a screen reader already pauses on them, so no ". " is added.
 * Includes the Devanagari danda (।) and the Arabic question mark (؟).
 */
const ASCII_END = /[.!?…।؟]$/;
/** Full-width / CJK marks. CJK text is written without a space after them. */
const FULL_WIDTH_END = /[。！？｡]$/;

/**
 * Join two spoken phrases into one accessibility label (#3796). Adds ". " between them only when
 * the first does not already end in a sentence mark, so "You Win!" + "Won: 2" reads
 * "You Win! Won: 2", not "You Win!. Won: 2". After such a mark (also with a space before it, "Gagné !") the
 * join is one space; after a full-width mark (。！？｡) there is no space, as CJK is written.
 */
export function joinSentence(first: string, second: string): string {
  const head = first.trimEnd();
  if (FULL_WIDTH_END.test(head)) return `${head}${second}`;
  if (ASCII_END.test(head)) return `${head} ${second}`;
  return `${head}. ${second}`;
}
