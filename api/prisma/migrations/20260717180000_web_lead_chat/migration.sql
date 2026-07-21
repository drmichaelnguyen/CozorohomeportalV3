-- CreateTable
CREATE TABLE `WebLeadConversation` (
    `id` VARCHAR(191) NOT NULL,
    `conversationKey` VARCHAR(191) NOT NULL,
    `guestName` VARCHAR(191) NULL,
    `phone` VARCHAR(48) NULL,
    `facebook` VARCHAR(191) NULL,
    `otherContact` VARCHAR(255) NULL,
    `preferredBranch` VARCHAR(8) NULL,
    `stayMonths` INTEGER NULL,
    `moveInHint` VARCHAR(120) NULL,
    `occupationHint` VARCHAR(64) NULL,
    `lastQuoteVnd` INTEGER NULL,
    `summary` TEXT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WebLeadConversation_conversationKey_key`(`conversationKey`),
    INDEX `WebLeadConversation_status_lastMessageAt_idx`(`status`, `lastMessageAt`),
    INDEX `WebLeadConversation_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebLeadMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` ENUM('GUEST', 'BOT', 'STAFF') NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebLeadMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebLeadMessage` ADD CONSTRAINT `WebLeadMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `WebLeadConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
