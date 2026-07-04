ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS message_scope varchar(40) NOT NULL DEFAULT 'customer';

CREATE INDEX IF NOT EXISTS chat_messages_order_scope_idx
ON chat_messages(order_id, message_scope, created_at);

UPDATE chat_messages
SET message_scope = 'customer'
WHERE message_scope IS NULL OR message_scope = '';
