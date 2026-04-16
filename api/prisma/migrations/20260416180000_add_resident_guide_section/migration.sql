-- CreateTable
CREATE TABLE `ResidentGuideSection` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `titleVi` VARCHAR(200) NOT NULL,
    `titleEn` VARCHAR(200) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `contentType` ENUM('STEPS', 'VIDEO') NOT NULL,
    `videoUrl` VARCHAR(2000) NULL,
    `stepsJson` JSON NULL,
    `updatedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ResidentGuideSection_slug_key`(`slug`),
    INDEX `ResidentGuideSection_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
