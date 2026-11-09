# copied from reader on 2026-11-04
from app.readcore import ids, mrz


def verhoeff_append(digits: str) -> str:
    for check in "0123456789":
        if ids.verhoeff_valid(digits + check):
            return digits + check
    raise AssertionError



def make_td3(number="L898902C3", dob="740812", sex="F", expiry="120415", nationality="UTO",
             surname="ERIKSSON", given="ANNA MARIA", personal="ZE184226B"):
    """An INVENTED passport MRZ with correct check digits (the ICAO specimen pattern, not a person)."""
    cd = mrz.check_digit
    l1 = ("P<" + nationality + surname + "<<" + given.replace(" ", "<")).ljust(44, "<")
    n, p = number.ljust(9, "<"), personal.ljust(14, "<")
    body = n + cd(n) + nationality + dob + cd(dob) + sex + expiry + cd(expiry) + p + cd(p)
    composite = cd(body[0:10] + body[13:20] + body[21:43])
    return [l1, body + composite]


