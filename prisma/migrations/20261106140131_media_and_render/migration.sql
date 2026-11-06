-- AlterTable
ALTER TABLE `ContentPost` ADD COLUMN `imageText` TEXT NULL;

-- AlterTable
ALTER TABLE `MediaAsset` ADD COLUMN `keywords` JSON NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    ADD COLUMN `sizeBytes` INTEGER NULL,
    ADD COLUMN `thumbPath` VARCHAR(1024) NULL,
    ADD COLUMN `title` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `VideoRenderJob` ADD COLUMN `options` JSON NULL,
    ADD COLUMN `stage` VARCHAR(191) NULL;
