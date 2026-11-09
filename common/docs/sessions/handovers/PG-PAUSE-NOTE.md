# DB work paused on the Lead's order
- Done: PG instance (5433) + roles hms_owner/hms_app + databases hms, hms_test; platform migrations (8 files) and seeds applied on hms_test; hotel template regenerated for PG without encryption; create-hotel in ONE transaction created a real hotel on hms_test.
- Deleted: MySQL scripts/migrations/seeds in db/ replaced by PG ones (copies kept in ..\hms-mysql-archive); env names MYSQL_*, HMS_TENANT_KEY, HMS_DATA_KEYS, HMS_BLIND_INDEX_KEY and the old MySQL DATABASE_URL removed from the env files. NOT deleted: the HMS MySQL instance/data (3307), Pallav dumps, mysql2, MySQL tests, web-app/src/db.
- Not done: PG db layer in web-app/src/db, PG tests, lint, docs, encryption removal in code.
