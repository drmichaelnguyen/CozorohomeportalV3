-- CreateTable
CREATE TABLE `SupportConversation` (
    `id` VARCHAR(191) NOT NULL,
    `residentEmail` VARCHAR(191) NOT NULL,
    `residentName` VARCHAR(191) NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupportConversation_residentEmail_key`(`residentEmail`),
    INDEX `SupportConversation_status_lastMessageAt_idx`(`status`, `lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderEmail` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NULL,
    `senderRole` ENUM('RESIDENT', 'MANAGER', 'OWNER') NOT NULL,
    `body` TEXT NOT NULL,
    `pagePath` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupportMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `SupportMessage_senderEmail_createdAt_idx`(`senderEmail`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportMessage` ADD CONSTRAINT `SupportMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `SupportConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
