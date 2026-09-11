CREATE TABLE `artifact_readme_translation_chunks` (
	`artifact_id` text NOT NULL,
	`locale` text NOT NULL,
	`source_hash` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`artifact_id`, `locale`, `source_hash`, `chunk_index`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
