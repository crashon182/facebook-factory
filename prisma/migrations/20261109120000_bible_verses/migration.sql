-- AlterTable
ALTER TABLE `ContentPost` ADD COLUMN `verseReference` VARCHAR(160) NULL,
    ADD COLUMN `verseText` TEXT NULL;

-- AlterTable
ALTER TABLE `SocialPage` ADD COLUMN `bibleVerses` BOOLEAN NOT NULL DEFAULT false;
