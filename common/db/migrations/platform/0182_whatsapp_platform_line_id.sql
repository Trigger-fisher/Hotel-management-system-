-- rollback: ALTER TABLE platform.conv_messages DROP COLUMN IF EXISTS line_id;
-- The platform's own Conversations (platform.conv_*) carry WhatsApp messages of the platform line the same way a hotel's do (hotel migration 0057 added conv_messages.line_id): which number carried the message
-- (platform.whatsapp_lines.id; no foreign key, a message outlives a disconnected line). Messages of the group and personal hubs are not WhatsApp and do not get it.
ALTER TABLE platform.conv_messages ADD COLUMN line_id uuid;
