-- rollback: DELETE FROM platform.role_permissions WHERE permission_id = (SELECT id FROM platform.permissions WHERE key = 'whatsapp'); DELETE FROM platform.permissions WHERE key = 'whatsapp';
-- WhatsApp as its own right (MJ, 4 Nov 2026: "i want the email and whatsapp separate because in some hotel maybe i will not give the feature"). Until now the Conversations right covered both
-- Email and WhatsApp. Now a hotel's Roles screen lists WhatsApp on its own (View to read, Edit to reply and manage), so a role can have Email without WhatsApp, or the reverse.
-- Nobody loses access: every role (the built-in ones and each hotel's own) that holds Conversations gets WhatsApp at the same level. A grant already set is left as it is.
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
