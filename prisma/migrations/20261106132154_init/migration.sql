-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialPage` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `topic` VARCHAR(191) NOT NULL,
    `targetAudience` TEXT NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'es',
    `targetCountry` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    `tone` VARCHAR(191) NULL,
    `growthGoals` TEXT NULL,
    `profileImageUrl` VARCHAR(1024) NULL,
    `visualIdentity` TEXT NULL,
    `primaryColor` VARCHAR(9) NULL,
    `secondaryColor` VARCHAR(9) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `facebookPageId` VARCHAR(191) NULL,
    `connectionStatus` ENUM('NOT_CONNECTED', 'CONNECTED', 'EXPIRED', 'ERROR') NOT NULL DEFAULT 'NOT_CONNECTED',
    `accessTokenEnc` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SocialPage_slug_key`(`slug`),
    UNIQUE INDEX `SocialPage_facebookPageId_key`(`facebookPageId`),
    INDEX `SocialPage_isActive_idx`(`isActive`),
    INDEX `SocialPage_connectionStatus_idx`(`connectionStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageStrategy` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `source` ENUM('AI', 'MANUAL') NOT NULL DEFAULT 'AI',
    `data` JSON NOT NULL,
    `model` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PageStrategy_pageId_status_idx`(`pageId`, `status`),
    UNIQUE INDEX `PageStrategy_pageId_version_key`(`pageId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentPillar` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `keywords` JSON NULL,
    `weight` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ContentPillar_pageId_name_key`(`pageId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentIdea` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `pillarId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `format` ENUM('TEXT', 'IMAGE', 'QUOTE_IMAGE', 'REEL', 'REFLECTION', 'EDUCATIONAL', 'INSPIRATIONAL', 'SHORT_STORY') NOT NULL DEFAULT 'TEXT',
    `status` ENUM('NEW', 'USED', 'DISCARDED') NOT NULL DEFAULT 'NEW',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContentIdea_pageId_status_idx`(`pageId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentPost` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `ideaId` VARCHAR(191) NULL,
    `pillarId` VARCHAR(191) NULL,
    `internalTitle` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(191) NULL,
    `format` ENUM('TEXT', 'IMAGE', 'QUOTE_IMAGE', 'REEL', 'REFLECTION', 'EDUCATIONAL', 'INSPIRATIONAL', 'SHORT_STORY') NOT NULL,
    `body` TEXT NULL,
    `facebookCaption` TEXT NULL,
    `script` TEXT NULL,
    `hashtags` JSON NULL,
    `status` ENUM('DRAFT', 'GENERATING', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `scheduledAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `facebookPostId` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `contentHash` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentPost_pageId_status_idx`(`pageId`, `status`),
    INDEX `ContentPost_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `ContentPost_pageId_contentHash_idx`(`pageId`, `contentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContentScene` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `sceneOrder` INTEGER NOT NULL,
    `narration` TEXT NOT NULL,
    `visualKeywords` JSON NULL,
    `durationMs` INTEGER NULL,
    `mediaAssetId` VARCHAR(191) NULL,

    UNIQUE INDEX `ContentScene_postId_sceneOrder_key`(`postId`, `sceneOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MediaAsset` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NULL,
    `postId` VARCHAR(191) NULL,
    `type` ENUM('PHOTO', 'VIDEO', 'AUDIO', 'RENDERED_IMAGE', 'RENDERED_VIDEO', 'THUMBNAIL') NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(1024) NULL,
    `localPath` VARCHAR(1024) NULL,
    `author` VARCHAR(191) NULL,
    `authorUrl` VARCHAR(1024) NULL,
    `license` TEXT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `checksum` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MediaAsset_checksum_idx`(`checksum`),
    UNIQUE INDEX `MediaAsset_provider_externalId_type_key`(`provider`, `externalId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VideoRenderJob` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `durationSec` INTEGER NOT NULL DEFAULT 30,
    `outputPath` VARCHAR(1024) NULL,
    `thumbnailPath` VARCHAR(1024) NULL,
    `logs` LONGTEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VideoRenderJob_postId_idx`(`postId`),
    INDEX `VideoRenderJob_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicationSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `status` ENUM('DRAFT', 'GENERATING', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PublicationSchedule_postId_key`(`postId`),
    UNIQUE INDEX `PublicationSchedule_idempotencyKey_key`(`idempotencyKey`),
    INDEX `PublicationSchedule_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `PublicationSchedule_pageId_scheduledAt_idx`(`pageId`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublicationAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `status` ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'RECONCILING') NOT NULL DEFAULT 'STARTED',
    `facebookObjectId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `response` JSON NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PublicationAttempt_scheduleId_attemptNo_key`(`scheduleId`, `attemptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostMetric` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reach` INTEGER NULL,
    `impressions` INTEGER NULL,
    `views` INTEGER NULL,
    `watchTimeSec` INTEGER NULL,
    `retention` DOUBLE NULL,
    `reactions` INTEGER NULL,
    `comments` INTEGER NULL,
    `shares` INTEGER NULL,
    `engagements` INTEGER NULL,
    `raw` JSON NULL,

    INDEX `PostMetric_postId_capturedAt_idx`(`postId`, `capturedAt`),
    INDEX `PostMetric_pageId_capturedAt_idx`(`pageId`, `capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PageMetric` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `followers` INTEGER NULL,
    `reach` INTEGER NULL,
    `impressions` INTEGER NULL,
    `engagements` INTEGER NULL,
    `raw` JSON NULL,

    INDEX `PageMetric_pageId_capturedAt_idx`(`pageId`, `capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AIAnalysisReport` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NULL,
    `type` ENUM('WEEKLY', 'PAGE_ANALYSIS', 'STRATEGY_REVIEW') NOT NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `summary` TEXT NOT NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AIAnalysisReport_pageId_type_createdAt_idx`(`pageId`, `type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OptimizationExperiment` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `hypothesis` TEXT NOT NULL,
    `variable` VARCHAR(191) NOT NULL,
    `status` ENUM('PROPOSED', 'RUNNING', 'COMPLETED', 'REVERTED', 'REJECTED') NOT NULL DEFAULT 'PROPOSED',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `result` JSON NULL,
    `revertedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OptimizationExperiment_pageId_status_idx`(`pageId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRule` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `maxPostsPerDay` INTEGER NOT NULL DEFAULT 1,
    `allowedFormats` JSON NULL,
    `publishDays` JSON NULL,
    `windowStart` VARCHAR(5) NOT NULL DEFAULT '09:00',
    `windowEnd` VARCHAR(5) NOT NULL DEFAULT '21:00',
    `generationFrequency` VARCHAR(16) NOT NULL DEFAULT 'DAILY',
    `requireApproval` BOOLEAN NOT NULL DEFAULT true,
    `autoPublish` BOOLEAN NOT NULL DEFAULT false,
    `autoOptimizeTimes` BOOLEAN NOT NULL DEFAULT false,
    `daysAhead` INTEGER NOT NULL DEFAULT 3,
    `dailyBudgetUsd` DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    `editorialRestrictions` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AutomationRule_pageId_key`(`pageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `APIUsageLog` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `costUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `APIUsageLog_provider_createdAt_idx`(`provider`, `createdAt`),
    INDEX `APIUsageLog_pageId_createdAt_idx`(`pageId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NULL,
    `level` ENUM('INFO', 'WARN', 'ERROR') NOT NULL DEFAULT 'INFO',
    `action` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `entity` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityLog_createdAt_idx`(`createdAt`),
    INDEX `ActivityLog_pageId_createdAt_idx`(`pageId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PageStrategy` ADD CONSTRAINT `PageStrategy_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentPillar` ADD CONSTRAINT `ContentPillar_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentIdea` ADD CONSTRAINT `ContentIdea_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentIdea` ADD CONSTRAINT `ContentIdea_pillarId_fkey` FOREIGN KEY (`pillarId`) REFERENCES `ContentPillar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentPost` ADD CONSTRAINT `ContentPost_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentPost` ADD CONSTRAINT `ContentPost_ideaId_fkey` FOREIGN KEY (`ideaId`) REFERENCES `ContentIdea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentPost` ADD CONSTRAINT `ContentPost_pillarId_fkey` FOREIGN KEY (`pillarId`) REFERENCES `ContentPillar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentScene` ADD CONSTRAINT `ContentScene_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContentScene` ADD CONSTRAINT `ContentScene_mediaAssetId_fkey` FOREIGN KEY (`mediaAssetId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaAsset` ADD CONSTRAINT `MediaAsset_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VideoRenderJob` ADD CONSTRAINT `VideoRenderJob_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationSchedule` ADD CONSTRAINT `PublicationSchedule_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationSchedule` ADD CONSTRAINT `PublicationSchedule_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublicationAttempt` ADD CONSTRAINT `PublicationAttempt_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `PublicationSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMetric` ADD CONSTRAINT `PostMetric_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `ContentPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMetric` ADD CONSTRAINT `PostMetric_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PageMetric` ADD CONSTRAINT `PageMetric_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AIAnalysisReport` ADD CONSTRAINT `AIAnalysisReport_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OptimizationExperiment` ADD CONSTRAINT `OptimizationExperiment_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRule` ADD CONSTRAINT `AutomationRule_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `APIUsageLog` ADD CONSTRAINT `APIUsageLog_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `SocialPage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
