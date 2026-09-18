-- ARU IT Ticketing V5 MySQL
-- Import via phpMyAdmin / MySQL client.
-- Default database name is aligned with .env: aru_ticketing

CREATE DATABASE IF NOT EXISTS `aru_ticketing`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `aru_ticketing`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `username` VARCHAR(80) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(80) NOT NULL DEFAULT '-',
  `department` VARCHAR(160) NOT NULL,
  `label` VARCHAR(160) NOT NULL DEFAULT 'User',
  `role` ENUM('user','admin','root_admin') NOT NULL DEFAULT 'user',
  `status` ENUM('active','pending_verification','pending_approval','rejected','disabled') NOT NULL DEFAULT 'pending_approval',
  `email_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `email_verified_at` DATETIME(3) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `registration_method` VARCHAR(80) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `approved_at` DATETIME(3) NULL,
  `approved_by` VARCHAR(64) NULL,
  `created_by_root` VARCHAR(64) NULL,
  `updated_at` DATETIME(3) NULL,
  `updated_by` VARCHAR(64) NULL,
  `rejection_reason` TEXT NULL,
  `rejected_at` DATETIME(3) NULL,
  `rejected_by` VARCHAR(64) NULL,
  `password_changed_at` DATETIME(3) NULL,
  `password_changed_by` VARCHAR(64) NULL,
  `email_changed_by` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_status` (`role`,`status`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `pics` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `contact` VARCHAR(190) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `created_by_user_id` VARCHAR(64) NULL,
  `created_by_name` VARCHAR(160) NULL,
  `updated_at` DATETIME(3) NULL,
  `updated_by_user_id` VARCHAR(64) NULL,
  `updated_by_name` VARCHAR(160) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pics_name` (`name`),
  CONSTRAINT `fk_pics_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pics_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `ticket_sequences` (
  `seq_date` DATE NOT NULL,
  `last_value` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`seq_date`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `tickets` (
  `id` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `category` VARCHAR(100) NOT NULL DEFAULT 'Other',
  `priority` ENUM('Unassigned','Critical','High','Medium','Low') NOT NULL DEFAULT 'Unassigned',
  `description` TEXT NOT NULL,
  `location` VARCHAR(255) NOT NULL DEFAULT '',
  `asset` VARCHAR(255) NOT NULL DEFAULT '',
  `impact` VARCHAR(255) NOT NULL DEFAULT '',

  `requester_user_id` VARCHAR(64) NULL,
  `requester_name` VARCHAR(160) NOT NULL,
  `requester_email` VARCHAR(190) NOT NULL DEFAULT '',
  `requester_phone` VARCHAR(80) NOT NULL DEFAULT '',
  `requester_department` VARCHAR(160) NOT NULL DEFAULT '',
  `requester_guest` TINYINT(1) NOT NULL DEFAULT 0,
  `requester_account_deleted` TINYINT(1) NOT NULL DEFAULT 0,

  `created_by_user_id` VARCHAR(64) NULL,
  `created_by_key` VARCHAR(96) NOT NULL,
  `created_by_name` VARCHAR(160) NOT NULL,
  `created_by_role` VARCHAR(40) NOT NULL,
  `created_by_department` VARCHAR(160) NOT NULL DEFAULT '',

  `status` ENUM('Open','In Progress','Waiting User','Reopened','Resolved - Awaiting Confirmation','Finished') NOT NULL DEFAULT 'Open',
  `estimated_processing` VARCHAR(255) NOT NULL DEFAULT 'TBA',
  `estimated_completion` VARCHAR(255) NOT NULL DEFAULT 'TBA',

  `assigned_pic_key` VARCHAR(128) NULL,
  `assigned_pic_type` ENUM('admin','external') NULL,
  `assigned_admin_user_id` VARCHAR(64) NULL,
  `assigned_external_pic_id` VARCHAR(64) NULL,
  `assigned_pic_name` VARCHAR(160) NULL,
  `assigned_pic_contact` VARCHAR(190) NULL,
  `assigned_pic_email` VARCHAR(190) NULL,
  `assigned_pic_department` VARCHAR(160) NULL,
  `assigned_pic_label` VARCHAR(160) NULL,
  `assigned_pic_account_deleted` TINYINT(1) NOT NULL DEFAULT 0,

  `resolved_by_user_id` VARCHAR(64) NULL,
  `resolved_by_key` VARCHAR(96) NULL,
  `resolved_by_name` VARCHAR(160) NULL,
  `resolved_by_department` VARCHAR(160) NULL,
  `resolved_by_label` VARCHAR(160) NULL,
  `resolved_at` DATETIME(3) NULL,
  `resolution_note` TEXT NULL,

  `user_confirmation_state` ENUM('confirmed','reopened') NULL,
  `user_confirmation_at` DATETIME(3) NULL,
  `user_confirmation_by` VARCHAR(160) NULL,
  `user_confirmation_note` TEXT NULL,

  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  KEY `idx_tickets_created_at` (`created_at`),
  KEY `idx_tickets_updated_at` (`updated_at`),
  KEY `idx_tickets_status` (`status`),
  KEY `idx_tickets_priority` (`priority`),
  KEY `idx_tickets_category` (`category`),
  KEY `idx_tickets_requester_user` (`requester_user_id`),
  KEY `idx_tickets_created_by_key` (`created_by_key`),
  KEY `idx_tickets_pic_key` (`assigned_pic_key`),
  KEY `idx_tickets_solver_key` (`resolved_by_key`),
  CONSTRAINT `fk_tickets_requester_user` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tickets_created_by_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tickets_assigned_admin` FOREIGN KEY (`assigned_admin_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tickets_assigned_external` FOREIGN KEY (`assigned_external_pic_id`) REFERENCES `pics` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_tickets_resolved_by_user` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `ticket_evidence` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` VARCHAR(32) NOT NULL,
  `kind` ENUM('initial','resolution') NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `original_size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `saved_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `mimetype` VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
  `compressed` TINYINT(1) NOT NULL DEFAULT 0,
  `url` VARCHAR(500) NOT NULL,
  `uploaded_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_evidence_ticket_kind` (`ticket_id`,`kind`),
  CONSTRAINT `fk_evidence_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `ticket_timeline` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_id` VARCHAR(32) NOT NULL,
  `at` DATETIME(3) NOT NULL,
  `type` VARCHAR(60) NOT NULL,
  `by_user_id` VARCHAR(64) NULL,
  `by_name` VARCHAR(160) NOT NULL DEFAULT 'System',
  `note` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_timeline_ticket_at` (`ticket_id`,`at`),
  CONSTRAINT `fk_timeline_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_timeline_user` FOREIGN KEY (`by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `email_tokens` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `purpose` ENUM('registration','password_reset') NOT NULL,
  `code_hash` VARCHAR(128) NOT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `created_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `invalidated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tokens_user_purpose_created` (`user_id`,`purpose`,`created_at`),
  KEY `idx_tokens_expiry` (`expires_at`),
  CONSTRAINT `fk_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- express-mysql-session compatible session table.
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `expires` INT UNSIGNED NOT NULL,
  `data` MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `app_meta` (
  `meta_key` VARCHAR(100) NOT NULL,
  `meta_value` VARCHAR(255) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`meta_key`)
) ENGINE=InnoDB;

INSERT INTO `app_meta` (`meta_key`,`meta_value`,`updated_at`)
VALUES ('schema_version','5.0.0',UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `meta_value`=VALUES(`meta_value`), `updated_at`=VALUES(`updated_at`);

SET FOREIGN_KEY_CHECKS = 1;
