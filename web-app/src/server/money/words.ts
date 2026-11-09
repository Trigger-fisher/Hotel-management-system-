import "server-only";

// Amount in words, Indian numbering. A port of Pallav's app/Support/NumberToWords.php convert() (golden-tested against the real
// PHP): 123456 rupees -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only", 12500.50 -> "Twelve Thousand Five
// Hundred Rupees and Fifty Paise Only", zero -> "Zero Rupees Only". Takes integer paise.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim());

function rupeeWords(input: number): string {
  let n = input;
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const remainder = n % 100;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${rupeeWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (remainder > 0) parts.push(twoDigits(remainder));
  return parts.join(" ").trim();
}

/** Pallav's limit: 100,000,000,000 paise (1,000,000,000 rupees). Above it (or below zero) the plain number comes back, as in PHP. */
const LIMIT_PAISE = 100_000_000_000;

export function amountInWords(paise: bigint | number): string {
  const total = typeof paise === "bigint" ? Number(paise) : paise;
  if (!Number.isSafeInteger(total)) throw new RangeError("paise must be a safe integer");
  if (total === 0) return "Zero Rupees Only";
  if (total < 0 || total > LIMIT_PAISE) return String(total / 100);
  const rupees = Math.floor(total / 100);
  const rest = total % 100;
  let words = rupees > 0 ? `${rupeeWords(rupees)}${rupees === 1 ? " Rupee" : " Rupees"}` : "";
  if (rest > 0) words += `${words !== "" ? " and " : ""}${twoDigits(rest)} Paise`;
  return `${words} Only`;
}
