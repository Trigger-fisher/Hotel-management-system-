-- rollback: ALTER TABLE platform.group_history DROP CONSTRAINT IF EXISTS group_history_event_known; ALTER TABLE platform.group_history ADD CONSTRAINT group_history_event_check CHECK (event IN ('created', 'submitted', 'approved', 'rejected', 'suspended', 'reactivated', 'archived', 'restored', 'hotel_linked', 'hotel_unlinked', 'admin_set', 'admin_cleared')) NOT VALID; ALTER TABLE platform.hotel_groups DROP COLUMN IF EXISTS max_hotels;
-- The most hotels one group may have (MJ, 18 Oct 2026). A group's primary Group Hotel Admin can now create hotels inside the group (POST /api/v1/group/hotels, live at once);
-- the Super Admin and Platform Admin can cap how many. NULL = no limit. The cap counts the group's hotels that are waiting, active or suspended (archived, rejected and
-- deleted ones do not count). It is never set below what the group already has (the service refuses that), and adding a hotel at the cap is refused inside the same
-- transaction that locks the group row, so two quick requests cannot both pass. Every change of the cap is kept in group_history ('max_hotels_set').
ALTER TABLE platform.hotel_groups ADD COLUMN IF NOT EXISTS max_hotels integer CHECK (max_hotels IS NULL OR max_hotels BETWEEN 0 AND 10000);

-- group_history learns the event 'max_hotels_set' (the reason column says "from N to M"); applied migrations are never edited, so the check of 0103 is replaced here
ALTER TABLE platform.group_history DROP CONSTRAINT IF EXISTS group_history_event_check;
ALTER TABLE platform.group_history DROP CONSTRAINT IF EXISTS group_history_event_known;
ALTER TABLE platform.group_history ADD CONSTRAINT group_history_event_known CHECK (event IN (
  'created', 'submitted', 'approved', 'rejected', 'suspended', 'reactivated', 'archived', 'restored',
  'hotel_linked', 'hotel_unlinked', 'admin_set', 'admin_cleared', 'max_hotels_set'
));