ALTER TABLE IF EXISTS processed_operations
  DROP CONSTRAINT IF EXISTS processed_operations_pkey;

ALTER TABLE IF EXISTS processed_operations
  ADD CONSTRAINT processed_operations_pkey
  PRIMARY KEY (operation_id, workspace_id, task_id);
