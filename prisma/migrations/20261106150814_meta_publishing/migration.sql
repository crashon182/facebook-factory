-- AlterTable
ALTER TABLE `PublicationSchedule` ADD COLUMN `lastError` TEXT NULL,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `SocialPage` ADD COLUMN `facebookPageName` VARCHAR(191) NULL,
    ADD COLUMN `lastCheckedAt` DATETIME(3) NULL;
