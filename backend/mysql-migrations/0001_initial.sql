-- Initial production MySQL schema. Epoch dates remain integer milliseconds.
CREATE TABLE `accounts` (
	`id` varchar(255) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` longtext NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`access_token` longtext,
	`refresh_token` longtext,
	`id_token` longtext,
	`access_token_expires_at` bigint,
	`refresh_token_expires_at` bigint,
	`scope` longtext,
	`password` longtext,
	`created_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	`updated_at` bigint NOT NULL,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_categories` (
	`artifact_id` varchar(255) NOT NULL,
	`category_id` varchar(255) NOT NULL,
	CONSTRAINT `artifact_categories_artifact_id_category_id_pk` PRIMARY KEY(`artifact_id`,`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_metrics` (
	`artifact_id` varchar(255) NOT NULL,
	`stars` bigint NOT NULL,
	`downloads` bigint NOT NULL,
	`installs` bigint NOT NULL,
	`captured_at` bigint NOT NULL,
	CONSTRAINT `artifact_metrics_artifact_id_captured_at_pk` PRIMARY KEY(`artifact_id`,`captured_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_readme_translation_chunks` (
	`artifact_id` varchar(255) NOT NULL,
	`locale` varchar(32) NOT NULL,
	`source_hash` varchar(96) NOT NULL,
	`chunk_index` bigint NOT NULL,
	`chunk_count` bigint NOT NULL,
	`text` longtext NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `artifact_readme_translation_chunks_artifact_id_l_daab0c49` PRIMARY KEY(`artifact_id`,`locale`,`source_hash`,`chunk_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_readme_translations` (
	`artifact_id` varchar(255) NOT NULL,
	`locale` varchar(32) NOT NULL,
	`source_hash` varchar(96) NOT NULL,
	`status` varchar(255) NOT NULL,
	`markdown` longtext,
	`error` longtext,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `artifact_readme_translations_artifact_id_locale_pk` PRIMARY KEY(`artifact_id`,`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_reviews` (
	`artifact_id` varchar(255) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`author_name` longtext NOT NULL,
	`author_avatar_url` longtext,
	`rating` bigint NOT NULL,
	`comment` longtext,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `artifact_reviews_artifact_id_account_id_pk` PRIMARY KEY(`artifact_id`,`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_search` (
	`artifact_id` varchar(255) NOT NULL,
	`haystack` longtext NOT NULL,
	CONSTRAINT `artifact_search_artifact_id` PRIMARY KEY(`artifact_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_search_documents` (
	`rowid` bigint AUTO_INCREMENT NOT NULL,
	`artifact_id` varchar(255) NOT NULL,
	`locale` varchar(32) NOT NULL,
	`display_name` longtext NOT NULL,
	`summary` longtext NOT NULL,
	`keywords` longtext NOT NULL,
	`topics` longtext NOT NULL,
	`summary_hash` longtext NOT NULL,
	`readme_hash` longtext,
	CONSTRAINT `artifact_search_documents_rowid` PRIMARY KEY(`rowid`),
	CONSTRAINT `artifact_search_documents_artifact_locale_idx` UNIQUE(`artifact_id`,`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_summary_translations` (
	`artifact_id` varchar(255) NOT NULL,
	`locale` varchar(32) NOT NULL,
	`source_hash` varchar(96) NOT NULL,
	`status` varchar(255) NOT NULL,
	`text` longtext,
	`error` longtext,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `artifact_summary_translations_artifact_id_locale_pk` PRIMARY KEY(`artifact_id`,`locale`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifact_topics` (
	`artifact_id` varchar(255) NOT NULL,
	`topic_id` varchar(255) NOT NULL,
	CONSTRAINT `artifact_topics_artifact_id_topic_id_pk` PRIMARY KEY(`artifact_id`,`topic_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `artifacts` (
	`id` varchar(255) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`display_name` longtext NOT NULL,
	`summary` longtext NOT NULL,
	`summary_hash` longtext,
	`readme_hash` longtext,
	`source` json NOT NULL,
	`source_origin` varchar(32) NOT NULL,
	`source_commit_sha` longtext,
	`payload` json NOT NULL,
	`keywords` json NOT NULL,
	`categories` json NOT NULL,
	`license` longtext,
	`author_name` longtext,
	`author_url` longtext,
	`readme_markdown` longtext,
	`og_image_url` longtext,
	`stars` bigint NOT NULL DEFAULT 0,
	`downloads` bigint NOT NULL DEFAULT 0,
	`installs` bigint NOT NULL DEFAULT 0,
	`star_velocity_7d` bigint NOT NULL DEFAULT 0,
	`star_velocity_30d` bigint NOT NULL DEFAULT 0,
	`popularity` double NOT NULL DEFAULT 0,
	`owner_account_id` varchar(255),
	`deprecated` boolean NOT NULL DEFAULT false,
	`published_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`indexed_at` bigint NOT NULL,
	CONSTRAINT `artifacts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `catalog_facet_counts` (
	`dimension` varchar(32) NOT NULL,
	`facet_id` varchar(191) NOT NULL,
	`count` bigint NOT NULL,
	`refreshed_at` bigint NOT NULL,
	CONSTRAINT `catalog_facet_counts_dimension_facet_id_pk` PRIMARY KEY(`dimension`,`facet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `device_codes` (
	`id` varchar(255) NOT NULL,
	`device_code` longtext NOT NULL,
	`user_code` longtext NOT NULL,
	`user_id` varchar(255),
	`expires_at` bigint NOT NULL,
	`status` varchar(255) NOT NULL,
	`last_polled_at` bigint,
	`polling_interval` bigint,
	`client_id` longtext,
	`scope` longtext,
	CONSTRAINT `device_codes_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `sessions` (
	`id` varchar(255) NOT NULL,
	`expires_at` bigint NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	`updated_at` bigint NOT NULL,
	`ip_address` longtext,
	`user_agent` longtext,
	`user_id` varchar(255) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_unique` UNIQUE(`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `submissions` (
	`id` varchar(255) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`source` json NOT NULL,
	`source_key` longtext NOT NULL,
	`note` longtext,
	`status` varchar(255) NOT NULL,
	`reviewer_note` longtext,
	`artifact_id` varchar(255),
	`created_at` bigint NOT NULL,
	`decided_at` bigint,
	CONSTRAINT `submissions_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `users` (
	`id` varchar(255) NOT NULL,
	`name` longtext NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` longtext,
	`created_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	`updated_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE `verifications` (
	`id` varchar(255) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` longtext NOT NULL,
	`expires_at` bigint NOT NULL,
	`created_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	`updated_at` bigint NOT NULL DEFAULT (unix_timestamp(current_timestamp(3)) * 1000),
	CONSTRAINT `verifications_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_categories` ADD CONSTRAINT `artifact_categories_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_metrics` ADD CONSTRAINT `artifact_metrics_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_readme_translation_chunks` ADD CONSTRAINT `artifact_readme_translation_chunks_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_readme_translations` ADD CONSTRAINT `artifact_readme_translations_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_reviews` ADD CONSTRAINT `artifact_reviews_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_search_documents` ADD CONSTRAINT `artifact_search_documents_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_summary_translations` ADD CONSTRAINT `artifact_summary_translations_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `artifact_topics` ADD CONSTRAINT `artifact_topics_artifact_id_artifacts_id_fk` FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
CREATE INDEX `accounts_userId_idx` ON `accounts` (`user_id`);
CREATE INDEX `artifact_categories_category_idx` ON `artifact_categories` (`category_id`);
CREATE INDEX `artifact_readme_translations_status_idx` ON `artifact_readme_translations` (`status`);
CREATE INDEX `artifact_reviews_account_idx` ON `artifact_reviews` (`account_id`);
CREATE INDEX `artifact_search_documents_locale_idx` ON `artifact_search_documents` (`locale`);
CREATE INDEX `artifact_summary_translations_status_idx` ON `artifact_summary_translations` (`status`);
CREATE INDEX `artifact_topics_topic_idx` ON `artifact_topics` (`topic_id`);
CREATE INDEX `artifacts_kind_idx` ON `artifacts` (`kind`);
CREATE INDEX `artifacts_origin_idx` ON `artifacts` (`source_origin`);
CREATE INDEX `artifacts_owner_idx` ON `artifacts` (`owner_account_id`);
CREATE INDEX `artifacts_updated_idx` ON `artifacts` (`updated_at`);
CREATE INDEX `artifacts_popularity_idx` ON `artifacts` (`deprecated`,`popularity`);
CREATE INDEX `artifacts_popularity_tiebreak_idx` ON `artifacts` (`deprecated`,`popularity`,`updated_at`,`id`);
CREATE INDEX `artifacts_kind_popularity_idx` ON `artifacts` (`kind`,`deprecated`,`popularity`);
CREATE INDEX `artifacts_rising_idx` ON `artifacts` (`deprecated`,`star_velocity_7d`,`popularity`);
CREATE INDEX `artifacts_deprecated_kind_idx` ON `artifacts` (`deprecated`,`kind`);
CREATE INDEX `artifacts_deprecated_id_idx` ON `artifacts` (`deprecated`,`id`);
CREATE INDEX `artifacts_deprecated_updated_idx` ON `artifacts` (`deprecated`,`updated_at`);
CREATE INDEX `artifacts_deprecated_stats_idx` ON `artifacts` (`deprecated`,`updated_at`,`installs`,`stars`,`downloads`);
CREATE INDEX `sessions_userId_idx` ON `sessions` (`user_id`);
CREATE INDEX `submissions_account_idx` ON `submissions` (`account_id`);
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);
CREATE INDEX `submissions_source_key_idx` ON `submissions` (`source_key`(191));
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);

-- MySQL ngram index replaces the derived SQLite FTS5 virtual tables.
ALTER TABLE `artifact_search_documents` ADD FULLTEXT INDEX `artifact_search_documents_ft` (`display_name`,`summary`,`keywords`,`topics`) WITH PARSER ngram;

