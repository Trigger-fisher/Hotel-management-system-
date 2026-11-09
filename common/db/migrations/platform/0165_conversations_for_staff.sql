-- rollback: DELETE FROM platform.role_permissions WHERE permission_id = (SELECT id FROM platform.permissions WHERE key = 'conversations') AND role_id IN (SELECT id FROM platform.roles WHERE hotel_id IS NULL AND key IN ('editor', 'viewer'));
-- Email for every hotel user (MJ, 2 Nov 2026: "super admin, platform admin, hotel admin, group admin and hotel user will have the email services"). Until now only the built-in Admin and
-- SuperAdmin roles had Conversations (0139, seed 0003_hms_permissions); Editor and Viewer had nothing, so a Hotel User with those roles saw no Email page. Now Editor reads and replies
-- (Edit) and Viewer reads (View). A hotel can still take the right away from one person in Roles; a grant already set is left as it is.
INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id, CASE r.key WHEN 'editor' THEN 'edit' ELSE 'view' END
  FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.hotel_id IS NULL AND r.key IN ('editor', 'viewer') AND p.key = 'conversations'
ON CONFLICT (role_id, permission_id) DO NOTHING;
