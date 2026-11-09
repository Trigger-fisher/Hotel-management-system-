-- seed: the first accounting year of a hotel that has none (Pallav Support/Books.php: a year runs 1 April to 31 March, labelled 2026-27; the year menu in the header and the Books page need one)
-- Opens the year the hotel is in TODAY (India time): from 1 April of this year, or of last year before April. A hotel that already has any year is left exactly as it is,
-- so running it again (or on every hotel with `db:cli seed`) changes nothing. Dates before the first year stay unlocked (history), as the year lock already treats them.
INSERT INTO accounting_years (label, starts_on, ends_on)
SELECT y.start_year || '-' || right((y.start_year + 1)::text, 2), make_date(y.start_year, 4, 1), make_date(y.start_year + 1, 3, 31)
  FROM (SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int >= 4 THEN extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int
                    ELSE extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int - 1 END AS start_year) y
 WHERE NOT EXISTS (SELECT 1 FROM accounting_years)
ON CONFLICT DO NOTHING;
