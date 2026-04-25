-- CreateTable
CREATE TABLE `SupportReadState` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `viewerEmail` VARCHAR(191) NOT NULL,
    `viewerRole` ENUM('RESIDENT', 'STAFF') NOT NULL,
    `lastReadAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SupportReadState_conversationId_viewerEmail_viewerRole_key`(`conversationId`, `viewerEmail`, `viewerRole`),
    INDEX `SupportReadState_viewerEmail_viewerRole_updatedAt_idx`(`viewerEmail`, `viewerRole`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportReadState` ADD CONSTRAINT `SupportReadState_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `SupportConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
