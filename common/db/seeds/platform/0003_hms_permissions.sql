-- seed: HMS's own permissions (not in Pallav's list): Conversations (decision 66) and WhatsApp (its own right since platform migration 0186, MJ, 4 Nov 2026)
-- The same two statements as platform migration 0139 (which does this on a live database, where the roles already exist). Seeds run after every migration, so on a fresh
-- database 0139 finds no roles yet and this file gives the built-in Admin and SuperAdmin roles Edit on Conversations; since 0165 (MJ, 2 Nov 2026) Editor gets Edit and Viewer View.

INSERT INTO platform.permissions (key, kind, label, about, group_name, section, icon, sensitive, sort_order)
VALUES ('conversations', 'module', 'Conversations', 'Email and WhatsApp messages in one inbox: read (View), reply, assign and add notes (Edit).', 'Front Office', NULL, 'bi-chat-left-text', false, 450)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id, 'edit' FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.hotel_id IS NULL AND r.key IN ('super_admin', 'admin') AND p.key = 'conversations'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT r.id, p.id, CASE r.key WHEN 'editor' THEN 'edit' ELSE 'view' END FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.hotel_id IS NULL AND r.key IN ('editor', 'viewer') AND p.key = 'conversations'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- WhatsApp as its own right (platform 0186): every role that holds Conversations holds WhatsApp at the same level, so a hotel can later take one away without the other.
INSERT INTO platform.permissions (key, kind, label, about, group_name, section, icon, sensitive, sort_order)
VALUES ('whatsapp', 'module', 'WhatsApp', 'WhatsApp chats with guests: read (View), reply and manage messages, campaigns and agreement (Edit). Email is the separate Conversations right.', 'Front Office', NULL, 'bi-whatsapp', false, 451)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform.role_permissions (role_id, permission_id, level)
SELECT rp.role_id, w.id, rp.level
  FROM platform.role_permissions rp
  JOIN platform.permissions c ON c.id = rp.permission_id AND c.key = 'conversations'
  CROSS JOIN platform.permissions w
 WHERE w.key = 'whatsapp'
ON CONFLICT (role_id, permission_id) DO NOTHING;