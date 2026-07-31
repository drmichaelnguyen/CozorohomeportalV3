CREATE TABLE `ChatAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `supportMessageId` VARCHAR(191) NULL,
    `groupMessageId` VARCHAR(191) NULL,
    `storageName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(64) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChatAttachment_storageName_key`(`storageName`),
    INDEX `ChatAttachment_supportMessageId_idx`(`supportMessageId`),
    INDEX `ChatAttachment_groupMessageId_idx`(`groupMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ChatAttachment` ADD CONSTRAINT `ChatAttachment_supportMessageId_fkey` FOREIGN KEY (`supportMessageId`) REFERENCES `SupportMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ChatAttachment` ADD CONSTRAINT `ChatAttachment_groupMessageId_fkey` FOREIGN KEY (`groupMessageId`) REFERENCES `GroupMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
