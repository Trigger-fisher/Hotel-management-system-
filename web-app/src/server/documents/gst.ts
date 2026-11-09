import "server-only";

// GST facts a tax invoice prints that the bill does not store: the state of a GSTIN (its first two digits) and, for an older
// bill without a stored rate, the rate when its GST is exactly one of the GST slabs.

const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

/** "Gujarat (24)" from a GSTIN, or null when the GSTIN does not start with a known state code. */
export function stateOfGstin(gstin: string | null | undefined): string | null {
  const code = (gstin ?? "").trim().slice(0, 2);
  const name = STATES[code];
  return name ? `${name} (${code})` : null;
}

const SLABS = [5, 12, 18, 28];

/** The GST rate in percent when `gstPaise` is a GST slab of `taxablePaise` to within one rupee; null otherwise. Only for an older bill that stored no rate. */
export function slabRate(taxablePaise: number, gstPaise: number): number | null {
  if (taxablePaise <= 0 || gstPaise <= 0) return null;
  return SLABS.find((s) => Math.abs((taxablePaise * s) / 100 - gstPaise) <= 100) ?? null;
}

/** "6%", "2.5%" or "1.25%" (half of a stored 2.5%). */
export const percent = (n: number): string => `${Number(n.toFixed(2))}%`;
