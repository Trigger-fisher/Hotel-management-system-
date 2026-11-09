// pms-money.js: an amount written out in words, in the Indian numbering Pallav's receipts use ("Twelve Thousand Five Hundred Rupees and Fifty Paise Only").
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigits = (n: number): string => (n < 20 ? (ONES[n] ?? '') : `${TENS[Math.floor(n / 10)] ?? ''} ${ONES[n % 10] ?? ''}`.trim());

function rupeeWords(number: number): string {
  let n = number;
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (crore) parts.push(`${rupeeWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred] ?? ''} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ').trim();
}

/** `toWords` of pms-money.js, for an amount in paise. */
export function wordsOf(paise: number): string {
  const total = Math.round(paise || 0);
  if (total === 0) return 'Zero Rupees Only';
  if (total < 0 || total > 100_000_000_000) return String(total / 100);
  const rupees = Math.floor(total / 100);
  const p = total % 100;
  let words = rupees > 0 ? rupeeWords(rupees) + (rupees === 1 ? ' Rupee' : ' Rupees') : '';
  if (p > 0) words += `${words ? ' and ' : ''}${twoDigits(p)} Paise`;
  return `${words} Only`;
}
