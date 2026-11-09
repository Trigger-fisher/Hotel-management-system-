-- rollback: forward-only because the grant is made by the script after the migrations run (create-hotel and migrate read this marker); remove the marker line in a new migration to take the right back
-- A re-generate of a month removes that month's salary rows and their lines (Pallav SalaryProcessor::reverse, called from Books and the salary run), so the
-- hotel's role may DELETE from salary_processings. The lines go with them by their own ON DELETE CASCADE. Nothing else changes: the table keeps its
-- version trigger, and the app deletes only through the run's removeMonth.
-- hard-delete-grant: salary_processings (Pallav app/Support/SalaryProcessor.php:145 reverse; re-generate of a month)
SELECT 1;
