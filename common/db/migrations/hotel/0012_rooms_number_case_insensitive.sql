-- rollback: DROP INDEX IF EXISTS pms_rooms_number_key; CREATE UNIQUE INDEX pms_rooms_number_key ON pms_rooms (number);
-- A room number is unique without regard to case ("a1" and "A1" are the same room), as MySQL's collation made it for Pallav.
DROP INDEX pms_rooms_number_key;
CREATE UNIQUE INDEX pms_rooms_number_key ON pms_rooms (lower(number));
