-- rollback: forward-only because the grants are made by the script after the migrations run (create-hotel and migrate read these markers); remove the marker lines in a new migration to take the rights back
-- Removing the newest accounting year (Pallav Support/Books.php removeLatest) deletes everything dated in it, in one transaction, so the hotel's role may
-- DELETE the three tables that had no such right yet. The attendance entries and the salary lines go with their parents by their own ON DELETE CASCADE.
-- hard-delete-grant: staff_advances (Pallav app/Support/Books.php removeLatest: every row dated in the removed year)
-- hard-delete-grant: attendance_months (Pallav app/Support/Books.php removeLatest: the year's attendance months, entries cascade)
-- hard-delete-grant: accounting_years (Pallav app/Support/Books.php removeLatest: the removed year itself)
SELECT 1;
