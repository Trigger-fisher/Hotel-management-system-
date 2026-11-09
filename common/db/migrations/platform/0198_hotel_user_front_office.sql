-- rollback: DELETE FROM platform.role_permissions WHERE role_id IN (SELECT id FROM platform.roles WHERE hotel_id IS NULL AND key IN ('editor', 'viewer')) AND permission_id IN (SELECT id FROM platform.permissions WHERE key IN ('pms', 'pms.board', 'pms.reservations', 'pms.stays', 'pms.rooms'));
-- Front Office (Reception) for every Hotel User by default (MJ, 6 Nov 2026). The hotel menu hides a module the role has no level in, and every hotel.fo.* page belongs to pms, so a Hotel User
-- (Viewer, or Editor when the hotel picks it) saw no Front desk and no Guest services. Viewer and Editor are built-in roles shared by every hotel, so this one change reaches every hotel.
-- Level is Edit, capped at what each part offers: pms view, Room board view (offers View only), Reservations edit, In-house guests edit and Rooms edit (both offer Full, not given). A Hotel User
-- therefore takes reservations, checks in and runs rooms but never reaches Full. The dining cancel window stays Hotel Admin only (account role check, then pms.stays Full) and the
-- Overview payroll stays hidden for a Hotel User (account role check). A grant already set (including one a hotel lowered in Roles) is left as it is. Nothing is updated or deleted.
INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id,
       CASE p.key WHEN 'pms' THEN 'view' WHEN 'pms.board' THEN 'view' ELSE 'edit' END
  FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.hotel_id IS NULL AND r.key IN ('editor', 'viewer')
   AND p.key IN ('pms', 'pms.board', 'pms.reservations', 'pms.stays', 'pms.rooms')
ON CONFLICT (role_id, permission_id) DO NOTHING;
