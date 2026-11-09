"""File names for the final pictures: FirstName_LastName_IdName (Rajiv_Sheth_Aadhaar), with _Rare at the end for MJ's RARE case
(Rajiv_Sheth_Aadhaar_Rare: two people in one job with the same full name and full date of birth). The first word of the English name is the
first name, the last word the last name; Unknown_<IdName> when no name was read. Only letters and digits survive, so the name is
always allowed on Windows (no \\ / : * ? " < > |, no trailing dot or space; a reserved device name such as CON cannot occur because
every stem ends in _IdName). A type that is not in the list (unknown, or one a hotel configured) is called Document."""
from __future__ import annotations

import re

ID_NAMES = {"aadhaar": "Aadhaar", "pan": "PAN", "passport": "Passport", "visa": "Visa", "oci": "OCI", "pio": "PIO",
            "driving-licence": "DrivingLicence", "voter-id": "VoterID", "national-id": "NationalID",
            "residence-permit": "ResidencePermit", "employee-card": "EmployeeCard", "unknown": "Document"}
RARE_SUFFIX = "_Rare"


def clean(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", part.title())[:30]


def stem(fields: dict, doc_type: str, rare: bool = False) -> str:
    """FirstName_LastName_IdName without an extension and without the collision number. `rare` (MJ's RARE rule, 4 Nov 2026: another
    person in the job has the same full name and full date of birth) adds _Rare: Rajiv_Sheth_Aadhaar_Rare."""
    words = [w for w in re.split(r"\s+", (fields.get("name", {}).get("value") or "").strip()) if clean(w)]
    first, last = (clean(words[0]), clean(words[-1])) if len(words) >= 2 else (clean(words[0]), "") if words else ("", "")
    id_name = ID_NAMES.get(doc_type, "Document")
    base = "_".join(p for p in (first, last, id_name) if p) if first else f"Unknown_{id_name}"
    return base + RARE_SUFFIX if rare else base


def unique(base: str, ext: str, taken: set[str]) -> str:
    """base.ext, or base_2.ext, base_3.ext ... when the name is taken. `taken` holds names WITHOUT extension, lower case (Windows
    ignores case), so Rajiv_Sheth_Aadhaar.jpg and Rajiv_Sheth_Aadhaar.png never both appear."""
    name, n = base, 1
    while name.lower() in taken:
        n += 1
        name = f"{base}_{n}"
    taken.add(name.lower())
    return f"{name}.{ext}"
