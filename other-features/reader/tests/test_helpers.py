"""Pure helpers: scripts by Unicode block, MRZ with check digits, Aadhaar (Verhoeff) and PAN."""
import pytest

from app import ids, mrz
from app.scripts import dominant_script, histogram, hint_scripts, is_rtl, script_of


# ---- scripts ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,script", [
    ("Hello world", "Latin"), ("नमस्ते दुनिया", "Devanagari"), ("નમસ્તે દુનિયા", "Gujarati"),
    ("مرحبا بالعالم", "Arabic"), ("שלום עולם", "Hebrew"), ("สวัสดีชาวโลก", "Thai"),
    ("Привет мир", "Cyrillic"), ("Γειά σου κόσμε", "Greek"), ("你好世界", "CJK"),
    ("こんにちは世界", "Japanese"), ("안녕하세요", "Hangul"), ("வணக்கம்", "Tamil"),
    ("నమస్కారం", "Telugu"), ("ನಮಸ್ಕಾರ", "Kannada"), ("നമസ്കാരം", "Malayalam"),
    ("নমস্কার", "Bengali"), ("ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "Gurmukhi"),
])
def test_dominant_script_by_unicode_block(text, script):
    assert dominant_script(text)[0] == script


def test_mixed_line_counts_letters_per_block():
    counts = histogram("Name: रमेश Ramesh 12345 નામ")
    assert counts["Latin"] > 0 and counts["Devanagari"] > 0 and counts["Gujarati"] > 0
    script, share = dominant_script("123 456 - / .")
    assert script is None and share == 0.0


def test_digits_and_punctuation_have_no_script():
    assert script_of("7") is None and script_of(" ") is None and script_of("-") is None


def test_direction_and_hints():
    assert is_rtl("Arabic") and is_rtl("Hebrew") and not is_rtl("Latin")
    scripts, extra = hint_scripts(["hi", "gu", "fr", "xx"])
    assert scripts == ["Devanagari", "Gujarati", "Latin"] and extra["Latin"] == ["fra"]


# ---- MRZ -------------------------------------------------------------------------------------

def make_td3(number="L898902C3", dob="740812", sex="F", expiry="120415", nationality="UTO",
             surname="ERIKSSON", given="ANNA MARIA", personal="ZE184226B"):
    """An INVENTED passport MRZ with correct check digits (the ICAO specimen pattern, not a person)."""
    cd = mrz.check_digit
    l1 = ("P<" + nationality + surname + "<<" + given.replace(" ", "<")).ljust(44, "<")
    n, p = number.ljust(9, "<"), personal.ljust(14, "<")
    body = n + cd(n) + nationality + dob + cd(dob) + sex + expiry + cd(expiry) + p + cd(p)
    composite = cd(body[0:10] + body[13:20] + body[21:43])
    return [l1, body + composite]


def make_td1():
    cd = mrz.check_digit
    number = "D23145890"
    l1 = ("I<UTO" + number + cd(number) + "<<<<<<<<<<<<<<<")
    dob, exp = "740812", "120415"
    l2 = dob + cd(dob) + "F" + exp + cd(exp) + "UTO" + "<<<<<<<<<<<"
    comp = cd(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29])
    l2 += comp
    l3 = "ERIKSSON<<ANNA<MARIA".ljust(30, "<")
    return [l1, l2, l3]


def make_td2():
    cd = mrz.check_digit
    number, dob, exp = "D23145890", "740812", "120415"
    l1 = ("I<UTOERIKSSON<<ANNA<MARIA").ljust(36, "<")
    body = number + cd(number) + "UTO" + dob + cd(dob) + "F" + exp + cd(exp) + "<<<<<<<"
    return [l1, body + cd(body[0:10] + body[13:20] + body[21:35])]


def test_check_digit_known_value():
    assert mrz.check_digit("740812") == "2" and mrz.check_digit("120415") == "9"
    assert mrz.check_digit("L898902C3") == "6"  # the well-known ICAO specimen number


@pytest.mark.parametrize("lines,fmt", [(make_td3(), "TD3"), (make_td2(), "TD2"), (make_td1(), "TD1")])
def test_valid_mrz_is_parsed_and_verified(lines, fmt):
    result = mrz.parse_mrz(["noise before"] + lines + ["noise after"])
    assert result["format"] == fmt and result["valid"] is True
    assert all(f["valid"] for f in result["fields"].values())
    assert result["fields"]["dateOfBirth"]["value"] == "740812"


def test_td3_fields_and_names():
    f = mrz.parse_mrz(make_td3())["fields"]
    assert f["surname"]["value"] == "ERIKSSON" and f["givenNames"]["value"] == "ANNA MARIA"
    assert f["documentNumber"]["value"] == "L898902C3" and f["sex"]["value"] == "F"


def test_one_wrong_character_fails_only_its_field():
    l1, l2 = make_td3()
    bad = l2[:1] + "X" + l2[2:]  # damage the document number
    result = mrz.parse_mrz([l1, bad])
    assert result["valid"] is False
    assert result["fields"]["documentNumber"]["valid"] is False
    assert result["fields"]["dateOfBirth"]["valid"] is True  # nothing is "repaired" or guessed
    assert result["fields"]["documentNumber"]["value"] == "LX98902C3"  # the value is reported as read


def test_ocr_spaces_are_ignored_but_wrong_length_is_not_an_mrz():
    l1, l2 = make_td3()
    spaced = " ".join(l2[i:i + 11] for i in range(0, 44, 11))
    assert mrz.parse_mrz([l1, spaced])["valid"] is True
    assert mrz.parse_mrz([l1, l2[:-1]]) is None
    assert mrz.parse_mrz(["just a line of text"]) is None


# ---- Aadhaar / PAN ----------------------------------------------------------------------------

def verhoeff_append(digits: str) -> str:
    for check in "0123456789":
        if ids.verhoeff_valid(digits + check):
            return digits + check
    raise AssertionError


def test_verhoeff_known_values_and_generated_numbers():
    assert ids.verhoeff_valid("2363") is True  # classic textbook example: 236 -> check digit 3
    assert ids.verhoeff_valid("2364") is False
    number = verhoeff_append("23456789012")
    assert len(number) == 12 and ids.aadhaar_valid(number)
    assert ids.aadhaar_valid(number[:4] + " " + number[4:8] + " " + number[8:])
    wrong = number[:-1] + str((int(number[-1]) + 1) % 10)
    assert not ids.aadhaar_valid(wrong)
    assert not ids.aadhaar_valid("123456789012")  # may not start with 0 or 1


def test_pan_pattern():
    assert ids.pan_valid("ABCPE1234F") and not ids.pan_valid("ABCXE1234F") and not ids.pan_valid("ABCPE12345")
    assert not ids.pan_valid("abcpe1234")


def test_find_identifiers_reports_invalid_ones_without_fixing():
    good = verhoeff_append("34567890123")
    found = ids.find_identifiers(f"Aadhaar {good[:4]} {good[4:8]} {good[8:]} PAN ABCPE1234F other 999988887777")
    kinds = {(f["type"], f["valid"]) for f in found}
    assert ("aadhaar", True) in kinds and ("pan", True) in kinds and ("aadhaar", False) in kinds
