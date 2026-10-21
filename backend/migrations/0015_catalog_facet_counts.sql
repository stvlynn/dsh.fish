CREATE TABLE `catalog_facet_counts` (
	`dimension` text NOT NULL,
	`facet_id` text NOT NULL,
	`count` integer NOT NULL,
	`refreshed_at` integer NOT NULL,
	PRIMARY KEY(`dimension`, `facet_id`)
);
--> statement-breakpoint
INSERT INTO `catalog_facet_counts` (`dimension`, `facet_id`, `count`, `refreshed_at`)
SELECT 'kind', `kind`, count(*), unixepoch() * 1000 FROM `artifacts` WHERE `deprecated` = 0 GROUP BY `kind`;
--> statement-breakpoint
INSERT INTO `catalog_facet_counts` (`dimension`, `facet_id`, `count`, `refreshed_at`)
SELECT 'category', c.`category_id`, count(*), unixepoch() * 1000
FROM `artifact_categories` c JOIN `artifacts` a ON a.`id` = c.`artifact_id` WHERE a.`deprecated` = 0 GROUP BY c.`category_id`;
--> statement-breakpoint
INSERT INTO `catalog_facet_counts` (`dimension`, `facet_id`, `count`, `refreshed_at`)
SELECT 'topic', t.`topic_id`, count(*), unixepoch() * 1000
FROM `artifact_topics` t JOIN `artifacts` a ON a.`id` = t.`artifact_id` WHERE a.`deprecated` = 0 GROUP BY t.`topic_id`;
--> statement-breakpoint
INSERT INTO `catalog_facet_counts` (`dimension`, `facet_id`, `count`, `refreshed_at`)
SELECT 'meta', 'live', count(*), unixepoch() * 1000 FROM `artifacts` WHERE `deprecated` = 0;
